import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { verifyOrderPermit } from "./permit";
import {
  catalogSchema,
  orderInputSchema,
  type OrderInput,
} from "@/domain/schema";
import { priceOrder, roundMoney, allocateMoney } from "@/domain/pricing";
import { consumeBatches } from "./batches";
import { canonical } from "./canonical";
export async function postOrder(raw: OrderInput, permit: string) {
  const order = orderInputSchema.parse(raw);
  const grant = await verifyOrderPermit(permit, order);
  const hash = createHash("sha256").update(JSON.stringify(order)).digest("hex");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.order.findUnique({
            where: { clientUuid: order.clientUuid },
          });
          if (existing) {
            if (existing.payloadHash !== hash)
              throw new Error("บิล UUID เดิมมีข้อมูลไม่ตรงกัน");
            return existing;
          }
          const user = await tx.user.findUnique({ where: { id: grant.sub } });
          const device = await tx.device.findUnique({
            where: { id: grant.deviceId },
          });
          if (!user?.active || user.role === "KITCHEN" || !device?.active)
            throw new Error("ผู้ใช้หรืออุปกรณ์ถูกระงับ");
          const snapshot = await tx.catalogSnapshot.findUniqueOrThrow({
            where: { id: grant.catalogId },
          });
          const catalog = catalogSchema.parse(snapshot.data);
          if (
            Date.now() >
            grant.exp * 1000 + catalog.settings.syncGraceDays * 86400000
          )
            throw new Error("เกินกำหนดส่งบิล กรุณาติดต่อเจ้าของ");
          const priced = priceOrder(
            catalog,
            order.channel,
            order.lines,
            order.discount,
          );
          let fulfillmentStage = "RECEIVED";
          if (order.deliveryId) {
            const ticket = await tx.deliveryTicket.findUniqueOrThrow({
              where: { id: order.deliveryId },
            });
            fulfillmentStage = ticket.stage;
            if (
              ticket.paidOrderUuid &&
              ticket.paidOrderUuid !== order.clientUuid
            )
              throw new Error("ออเดอร์แพลตฟอร์มนี้ชำระแล้ว");
            if (
              ticket.channel !== order.channel ||
              ticket.catalogId !== order.catalogId ||
              canonical(ticket.lines) !== canonical(order.lines)
            )
              throw new Error("รายการไม่ตรงกับออเดอร์แพลตฟอร์ม");
            await tx.deliveryTicket.update({
              where: { id: ticket.id },
              data: {
                paidOrderUuid: order.clientUuid,
                total: priced.total,
                netPayout: priced.netPayout,
              },
            });
          }
          if (
            priced.total !== order.total ||
            order.payment.tendered < priced.total ||
            !order.payment.verified
          )
            throw new Error("ยอดชำระไม่ถูกต้องหรือยังไม่ได้ยืนยันรับเงิน");
          if (order.payment.method !== "CASH" && !order.payment.refNo)
            throw new Error("กรุณาระบุเลขอ้างอิงการรับเงิน");
          const uses = new Map<string, { food: Decimal; packaging: Decimal }>();
          const add = (id: string, qty: Decimal, packaging = false) => {
            const current = uses.get(id) ?? {
              food: new Decimal(0),
              packaging: new Decimal(0),
            };
            if (packaging) current.packaging = current.packaging.plus(qty);
            else current.food = current.food.plus(qty);
            uses.set(id, current);
          };
          for (const line of priced.lines) {
            for (const i of line.menu.ingredients)
              add(i.ingredientId, new Decimal(i.qty).mul(line.qty));
            for (const o of line.options)
              if (o.ingredientId && o.qtyDelta)
                add(o.ingredientId, new Decimal(o.qtyDelta).mul(line.qty));
            for (const p of line.menu.packaging.filter(
              (p) => p.channel === order.channel,
            ))
              add(p.ingredientId, new Decimal(p.qty).mul(line.qty), true);
          }
          let foodCost = new Decimal(0);
          let packCost = new Decimal(0);
          const ingredientCosts = new Map<string, string>();
          const stockRows = [];
          for (const [id, use] of [...uses].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const i = await tx.ingredient.findUniqueOrThrow({ where: { id } });
            ingredientCosts.set(id, i.avgCost.toString());
            foodCost = foodCost.plus(use.food.mul(i.avgCost.toString()));
            packCost = packCost.plus(use.packaging.mul(i.avgCost.toString()));
            const qty = use.food.plus(use.packaging).toFixed(6);
            await tx.ingredient.update({
              where: { id },
              data: { currentQty: { decrement: qty } },
            });
            const batchAllocations = await consumeBatches(
              tx,
              id,
              new Decimal(qty),
            );
            stockRows.push({
              ingredientId: id,
              qtyDelta: new Decimal(qty).negated().toString(),
              costAtTime: i.avgCost,
              type: "SALE" as const,
              refType: "Order",
              refId: order.clientUuid,
              reason: "ชำระเงินสำเร็จ",
              createdBy: order.createdBy,
              batchAllocations,
            });
          }
          const ingredientCost = roundMoney(foodCost);
          const packagingCost = roundMoney(packCost);
          const rawCosts = priced.lines.map((l) => ({
            food: l.menu.ingredients
              .reduce(
                (n, i) =>
                  n.plus(
                    new Decimal(i.qty).mul(
                      ingredientCosts.get(i.ingredientId) ?? 0,
                    ),
                  ),
                new Decimal(0),
              )
              .plus(
                l.options.reduce(
                  (n, o) =>
                    n.plus(
                      o.ingredientId && o.qtyDelta
                        ? new Decimal(o.qtyDelta).mul(
                            ingredientCosts.get(o.ingredientId) ?? 0,
                          )
                        : 0,
                    ),
                  new Decimal(0),
                ),
              )
              .mul(l.qty),
            pack: l.menu.packaging
              .filter((p) => p.channel === order.channel)
              .reduce(
                (n, p) =>
                  n.plus(
                    new Decimal(p.qty).mul(
                      ingredientCosts.get(p.ingredientId) ?? 0,
                    ),
                  ),
                new Decimal(0),
              )
              .mul(l.qty),
          }));
          const lineFood = allocateMoney(
            ingredientCost,
            rawCosts.map((c) => c.food.mul(1000000).toNumber()),
          );
          const linePack = allocateMoney(
            packagingCost,
            rawCosts.map((c) => c.pack.mul(1000000).toNumber()),
          );
          const lineNet = allocateMoney(
            priced.netPayout,
            priced.lines.map((l) => l.lineTotal),
          );
          const saved = await tx.order.create({
            data: {
              fulfillmentStage,
              clientUuid: order.clientUuid,
              payloadHash: hash,
              deviceId: order.deviceId,
              catalogId: order.catalogId,
              orderNo: order.orderNo,
              localSequence: order.localSequence,
              queueNo: order.queueNo,
              channel: order.channel,
              subtotal: priced.subtotal,
              discount: priced.discount,
              tax: priced.tax,
              total: priced.total,
              platformFeePercent: new Decimal(priced.feeBps)
                .div(100)
                .toString(),
              platformFee: priced.platformFee,
              netPayout: priced.netPayout,
              ingredientCost,
              packagingCost,
              grossProfit: priced.netPayout - ingredientCost - packagingCost,
              createdBy: order.createdBy,
              createdAt: new Date(order.createdAt),
              lines: {
                create: priced.lines.map((l, index) => ({
                  ingredientCost: lineFood[index],
                  packagingCost: linePack[index],
                  netPayout: lineNet[index],
                  menuItemId: l.menuItemId,
                  menuName: l.menu.name,
                  qty: l.qty,
                  unitPrice: l.unitPrice,
                  optionsJson: l.options,
                  lineTotal: l.lineTotal,
                  note: l.note,
                })),
              },
              payments: {
                create: {
                  method: order.payment.method,
                  amount: priced.total,
                  tendered: order.payment.tendered,
                  change: order.payment.tendered - priced.total,
                  refNo: order.payment.refNo || null,
                },
              },
            },
          });
          await tx.stockMovement.createMany({ data: stockRows });
          await tx.auditLog.create({
            data: {
              userId: order.createdBy,
              action: "PAY_ORDER",
              entity: "Order",
              entityId: saved.id,
              beforeJson: {},
              afterJson: {
                clientUuid: order.clientUuid,
                total: priced.total,
                method: order.payment.method,
              },
            },
          });
          if (order.discount)
            await tx.auditLog.create({
              data: {
                userId: order.createdBy,
                action: "DISCOUNT",
                entity: "Order",
                entityId: saved.id,
                beforeJson: { subtotal: priced.subtotal },
                afterJson: { ...order.discount, amount: priced.discount },
              },
            });
          return saved;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code) &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
  throw new Error("ระบบไม่ว่าง กรุณาลอง sync ใหม่");
}
