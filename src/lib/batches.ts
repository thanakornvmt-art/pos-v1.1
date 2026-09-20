import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
export async function consumeBatches(
  tx: Prisma.TransactionClient,
  ingredientId: string,
  quantity: Decimal,
) {
  let left = quantity;
  const allocations: { id: string; qty: string }[] = [];
  const batches = await tx.stockBatch.findMany({
    where: { ingredientId, remainingQty: { gt: 0 } },
    orderBy: [
      { expiresAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });
  for (const b of batches) {
    if (left.lte(0)) break;
    const qty = Decimal.min(left, b.remainingQty.toString());
    await tx.stockBatch.update({
      where: { id: b.id },
      data: { remainingQty: { decrement: qty.toString() } },
    });
    allocations.push({ id: b.id, qty: qty.toString() });
    left = left.minus(qty);
  }
  return allocations;
}
