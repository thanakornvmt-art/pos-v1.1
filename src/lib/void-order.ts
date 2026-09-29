import { z } from "zod";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
export async function voidOrder(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  reason: string,
) {
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
        reason: reason,
        createdBy: userId,
        reversalOfId: m.id,
        batchAllocations: m.batchAllocations ?? [],
      },
    });
  }
  await tx.order.update({
    where: { id: order.id },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason },
  });
  await tx.payment.updateMany({
    where: { orderId: order.id },
    data: { reversedAt: new Date() },
  });
  await tx.auditLog.create({
    data: {
      userId: userId,
      action: "VOID_ORDER",
      entity: "Order",
      entityId: order.id,
      beforeJson: { status: "PAID" },
      afterJson: { status: "VOIDED", reason: reason },
    },
  });
}
