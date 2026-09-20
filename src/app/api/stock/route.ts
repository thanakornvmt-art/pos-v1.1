import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { stockMutation } from "@/domain/stock";
import { receiveCost } from "@/domain/inventory";
import { roundMoney } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { serializable } from "@/lib/transaction";
import { consumeBatches } from "@/lib/batches";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
export async function GET() {
  try {
    await authorized(true);
    const [ingredients, batches, suppliers, movements, purchaseOrders] =
      await Promise.all([
        prisma.ingredient.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
        }),
        prisma.stockBatch.findMany({ where: { remainingQty: { gt: 0 } } }),
        prisma.supplier.findMany(),
        prisma.stockMovement.findMany({
          orderBy: { createdAt: "desc" },
          take: 1000,
        }),
        prisma.purchaseOrder.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);
    return Response.json({
      ingredients,
      batches,
      suppliers,
      movements,
      purchaseOrders,
    });
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const v = stockMutation.parse(await body(req));
    const hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
    const result = await serializable(async (tx) => {
      const old = await tx.stockOperation.findUnique({ where: { id: v.id } });
      if (old) {
        if (old.payloadHash !== hash)
          throw new Error("เลขรายการซ้ำแต่ข้อมูลไม่ตรง");
        return { id: v.id, replayed: true };
      }
      await tx.stockOperation.create({
        data: { id: v.id, kind: v.kind, payloadHash: hash },
      });
      if (v.kind === "receive") {
        if (new Set(v.lines.map((l) => l.ingredientId)).size !== v.lines.length)
          throw new Error("วัตถุดิบซ้ำ");
        await tx.stockReceipt.create({
          data: { id: v.id, supplierId: v.supplierId, createdBy: user.id },
        });
        for (const l of [...v.lines].sort((a, b) =>
          a.ingredientId.localeCompare(b.ingredientId),
        )) {
          const i = await tx.ingredient.findUniqueOrThrow({
            where: { id: l.ingredientId },
          });
          if (!i.active) throw new Error("วัตถุดิบถูกปิดใช้งาน");
          if (i.isPerishable && !l.expiresAt)
            throw new Error(`กรุณาระบุวันหมดอายุ ${i.name}`);
          if (l.expiresAt && new Date(l.expiresAt) <= new Date())
            throw new Error("วันหมดอายุต้องอยู่ในอนาคต");
          const cost = roundMoney(new Decimal(l.purchaseQty).mul(l.unitPrice));
          const calc = receiveCost(
            i.currentQty.toString(),
            i.avgCost.toString(),
            l.purchaseQty,
            cost,
            i.conversionRate.toString(),
            i.yieldPercent.toString(),
          );
          await tx.ingredient.update({
            where: { id: i.id },
            data: {
              currentQty: { increment: calc.receivedQty.toFixed(6) },
              avgCost: calc.avgCost.toFixed(8),
              supplierId: v.supplierId,
            },
          });
          await tx.stockBatch.create({
            data: {
              ingredientId: i.id,
              receiptId: v.id,
              receivedQty: calc.receivedQty.toFixed(6),
              remainingQty: calc.receivedQty.toFixed(6),
              expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
            },
          });
          await tx.stockMovement.create({
            data: {
              ingredientId: i.id,
              type: "RECEIVE",
              qtyDelta: calc.receivedQty.toFixed(6),
              costAtTime: calc.unitCost.toFixed(8),
              refType: "Receipt",
              refId: v.id,
              reason: "รับของเข้า",
              createdBy: user.id,
            },
          });
        }
      }
      if (v.kind === "waste") {
        const i = await tx.ingredient.findUniqueOrThrow({
          where: { id: v.ingredientId },
        });
        if (new Decimal(v.qty).gt(i.currentQty.toString()))
          throw new Error("ของเสียมากกว่าสต็อกที่มี");
        const allocations = await consumeBatches(tx, i.id, new Decimal(v.qty));
        await tx.ingredient.update({
          where: { id: i.id },
          data: { currentQty: { decrement: v.qty } },
        });
        await tx.stockMovement.create({
          data: {
            ingredientId: i.id,
            type: "WASTE",
            qtyDelta: new Decimal(v.qty).negated().toString(),
            costAtTime: i.avgCost,
            refType: "Waste",
            refId: v.id,
            reason: v.reason,
            createdBy: user.id,
            batchAllocations: allocations,
          },
        });
      }
      if (v.kind === "count") {
        if (new Set(v.lines.map((l) => l.ingredientId)).size !== v.lines.length)
          throw new Error("วัตถุดิบซ้ำ");
        await tx.stockCount.create({
          data: {
            id: v.id,
            countedAt: new Date(),
            countedBy: user.id,
            status: "POSTED",
          },
        });
        for (const l of [...v.lines].sort((a, b) =>
          a.ingredientId.localeCompare(b.ingredientId),
        )) {
          const i = await tx.ingredient.findUniqueOrThrow({
            where: { id: l.ingredientId },
          });
          if (!new Decimal(l.systemQty).eq(i.currentQty.toString()))
            throw new Error(`สต็อก ${i.name} เปลี่ยนระหว่างนับ กรุณาโหลดใหม่`);
          const variance = new Decimal(l.actualQty).minus(
            i.currentQty.toString(),
          );
          const allocations = variance.lt(0)
            ? await consumeBatches(tx, i.id, variance.abs())
            : [];
          await tx.stockCountLine.create({
            data: {
              countId: v.id,
              ingredientId: i.id,
              systemQty: i.currentQty,
              actualQty: l.actualQty,
              variance: variance.toString(),
            },
          });
          await tx.ingredient.update({
            where: { id: i.id },
            data: { currentQty: l.actualQty },
          });
          await tx.stockMovement.create({
            data: {
              ingredientId: i.id,
              type: "COUNT",
              qtyDelta: variance.toString(),
              costAtTime: i.avgCost,
              refType: "StockCount",
              refId: v.id,
              reason: "ตรวจนับสต็อก",
              createdBy: user.id,
              batchAllocations: allocations,
            },
          });
        }
      }
      if (v.kind === "purchaseOrder") {
        const settings = await tx.settings.findUniqueOrThrow({
          where: { id: "store" },
        });
        if (settings.safetyDays === null || settings.leadTimeDays === null)
          throw new Error("เจ้าของต้องตั้งวันเผื่อสต็อกและวันรอส่งก่อน");
        const to = new Date();
        to.setUTCHours(17, 0, 0, 0);
        if (to > new Date()) to.setUTCDate(to.getUTCDate() - 1);
        const from = new Date(to.getTime() - 7 * 86400000);
        const usage = await tx.stockMovement.findMany({
          where: {
            type: { in: ["SALE", "REVERSAL"] },
            createdAt: { gte: from, lt: to },
          },
        });
        const ingredients = await tx.ingredient.findMany({
          where: { active: true },
        });
        const lines = ingredients
          .map((i) => {
            const sold = usage
              .filter((m) => m.ingredientId === i.id)
              .reduce(
                (sum, m) => sum.minus(m.qtyDelta.toString()),
                new Decimal(0),
              );
            const daily = Decimal.max(0, sold).div(7);
            const target = Decimal.max(
              i.parLevel.toString(),
              daily.mul(settings.safetyDays! + settings.leadTimeDays!),
            );
            const needed = Decimal.max(
              0,
              target.minus(i.currentQty.toString()),
            );
            const purchase = needed
              .div(i.conversionRate.toString())
              .div(new Decimal(i.yieldPercent.toString()).div(100))
              .ceil();
            return {
              ingredientId: i.id,
              name: i.name,
              supplierId: i.supplierId,
              purchaseUnit: i.purchaseUnit,
              purchaseQty: purchase.toString(),
              averageDailyUsage: daily.toFixed(6),
              targetQty: target.toFixed(6),
            };
          })
          .filter((l) => new Decimal(l.purchaseQty).gt(0));
        await tx.purchaseOrder.create({
          data: {
            id: v.id,
            lines,
            parameters: {
              from: from.toISOString(),
              to: to.toISOString(),
              safetyDays: settings.safetyDays,
              leadTimeDays: settings.leadTimeDays,
            },
            createdBy: user.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: v.kind.toUpperCase(),
          entity: "Stock",
          entityId: v.id,
          beforeJson: {},
          afterJson: JSON.parse(JSON.stringify(v)) as object,
        },
      });
      return { id: v.id };
    });
    return Response.json(result);
  } catch (e) {
    return fail(e, 409);
  }
}
