import { z } from "zod";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await authorized(true);
    const id = z.string().uuid().parse(params.id);
    const order = await prisma.order.findUniqueOrThrow({
      where: { clientUuid: id },
      include: { lines: true, payments: true },
    });
    return Response.json(order);
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const id = z.string().uuid().parse(params.id);
    const v = z
      .object({
        reason: z.string().trim().min(3).max(200),
        confirmed: z.literal(true),
      })
      .parse(await body(req));
    await serializable(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { clientUuid: id },
      });
      if (order.status === "VOIDED") return;
      const movements = await tx.stockMovement.findMany({
        where: { refType: "Order", refId: id, type: "SALE" },
        orderBy: { ingredientId: "asc" },
      });
      for (const m of movements) {
        const amount = new Decimal(m.qtyDelta.toString()).negated();
        await tx.ingredient.update({
          where: { id: m.ingredientId },
          data: { currentQty: { increment: amount.toString() } },
        });
        const allocations = z
          .array(z.object({ id: z.string(), qty: z.string() }))
          .parse(m.batchAllocations);
        for (const b of allocations)
          await tx.stockBatch.update({
            where: { id: b.id },
            data: { remainingQty: { increment: b.qty } },
          });
        await tx.stockMovement.create({
          data: {
            ingredientId: m.ingredientId,
            type: "REVERSAL",
            qtyDelta: amount.toString(),
            costAtTime: m.costAtTime,
            refType: "Order",
            refId: id,
            reason: v.reason,
            createdBy: user.id,
            reversalOfId: m.id,
            batchAllocations: m.batchAllocations ?? [],
          },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: "VOIDED", voidedAt: new Date(), voidReason: v.reason },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: { reversedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "VOID_ORDER",
          entity: "Order",
          entityId: order.id,
          beforeJson: { status: "PAID" },
          afterJson: { status: "VOIDED", reason: v.reason },
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
