import { z } from "zod";
import { positiveDecimal } from "./admin";
import { moneySchema, quantitySchema } from "./schema";
export const receiveSchema = z.object({
  kind: z.literal("receive"),
  id: z.string().uuid(),
  supplierId: z.string().min(1),
  lines: z
    .array(
      z.object({
        ingredientId: z.string(),
        purchaseQty: positiveDecimal,
        unitPrice: moneySchema,
        expiresAt: z.string().datetime().nullable(),
      }),
    )
    .min(1)
    .max(100),
});
export const countSchema = z.object({
  kind: z.literal("count"),
  id: z.string().uuid(),
  confirmed: z.literal(true),
  lines: z
    .array(
      z.object({
        ingredientId: z.string(),
        systemQty: z.string().regex(/^-?\d+(\.\d+)?$/),
        actualQty: quantitySchema,
      }),
    )
    .min(1)
    .max(200),
});
export const wasteSchema = z.object({
  kind: z.literal("waste"),
  id: z.string().uuid(),
  ingredientId: z.string(),
  qty: positiveDecimal,
  reason: z.enum(["หมดอายุ", "ทำเสีย", "ลูกค้าคืน", "ของตกพื้น"]),
  confirmed: z.literal(true),
});
export const stockMutation = z.discriminatedUnion("kind", [
  receiveSchema,
  countSchema,
  wasteSchema,
  z.object({ kind: z.literal("purchaseOrder"), id: z.string().uuid() }),
]);
export const stockViewSchema = z.object({
  ingredients: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      usageUnit: z.string(),
      purchaseUnit: z.string(),
      currentQty: z.string(),
      avgCost: z.string(),
      parLevel: z.string(),
      reorderPoint: z.string(),
      supplierId: z.string().nullable(),
    }),
  ),
  batches: z.array(
    z.object({
      id: z.string(),
      ingredientId: z.string(),
      remainingQty: z.string(),
      expiresAt: z.string().nullable(),
    }),
  ),
  suppliers: z.array(z.object({ id: z.string(), name: z.string() })),
  movements: z.array(
    z.object({
      id: z.string(),
      ingredientId: z.string(),
      type: z.string(),
      qtyDelta: z.string(),
      costAtTime: z.string(),
      refType: z.string(),
      refId: z.string(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  purchaseOrders: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      lines: z.array(
        z.object({
          ingredientId: z.string(),
          name: z.string(),
          supplierId: z.string().nullable(),
          purchaseUnit: z.string(),
          purchaseQty: z.string(),
          averageDailyUsage: z.string(),
          targetQty: z.string(),
        }),
      ),
    }),
  ),
});
