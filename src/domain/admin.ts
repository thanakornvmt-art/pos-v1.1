import { z } from "zod";
import Decimal from "decimal.js";
import { channelSchema, channels, quantitySchema, moneySchema } from "./schema";
import { explodeBom } from "./inventory";
import { roundMoney, suggestedDeliveryPrice } from "./pricing";
export const positiveDecimal = quantitySchema.refine(
  (v) => new Decimal(v).gt(0),
  "ต้องมากกว่า 0",
);
export const ingredientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    purchaseUnit: z.string().min(1).max(30),
    usageUnit: z.string().min(1).max(30),
    conversionRate: positiveDecimal,
    yieldPercent: positiveDecimal.refine(
      (v) => new Decimal(v).lte(100),
      "yield ต้องไม่เกิน 100",
    ),
    parLevel: quantitySchema,
    reorderPoint: quantitySchema,
    isPerishable: z.boolean(),
    shelfLifeDays: z.number().int().min(1).max(3650).nullable(),
    supplierId: z.string().nullable(),
  })
  .strict();
export const recipeLineSchema = z
  .object({
    ingredientId: z.string().nullable(),
    subRecipeId: z.string().nullable(),
    qty: positiveDecimal,
  })
  .strict()
  .refine(
    (v) => Boolean(v.ingredientId) !== Boolean(v.subRecipeId),
    "เลือกวัตถุดิบหรือสูตรย่อยอย่างใดอย่างหนึ่ง",
  );
export const recipeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    outputQty: positiveDecimal,
    outputUnit: z.string().min(1).max(30),
    lines: z.array(recipeLineSchema).min(1).max(100),
  })
  .strict();
export const settingsSchema = z.object({
  shopName: z.string().trim().min(1).max(100),
  taxBps: z.number().int().min(0).max(10000),
  offlineHours: z.number().int().min(1).max(24),
  syncGraceDays: z.number().int().min(1).max(30),
  promptpayId: z
    .string()
    .regex(/^(0\d{9}|\d{13})$/)
    .nullable(),
  qrExpirySeconds: z.number().int().min(30).max(1800),
  safetyDays: z.number().int().min(0).max(90).nullable(),
  leadTimeDays: z.number().int().min(0).max(90).nullable(),
});
export const adminSchema = z.object({
  ingredients: z.array(
    ingredientSchema.extend({
      avgCost: quantitySchema,
      currentQty: z.string(),
      active: z.boolean(),
    }),
  ),
  recipes: z.array(recipeSchema),
  menus: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isActive: z.boolean(),
      soldOut: z.boolean(),
      imageUrl: z.string(),
      prices: z.array(z.object({ channel: channelSchema, price: moneySchema })),
      bom: z.array(recipeLineSchema),
      packaging: z.array(
        z.object({
          channel: channelSchema,
          ingredientId: z.string(),
          qty: quantitySchema,
        }),
      ),
    }),
  ),
  suppliers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string(),
      lineId: z.string(),
    }),
  ),
  settings: settingsSchema,
  fees: z.array(
    z.object({
      channel: channelSchema,
      feeBps: z.number().int().min(0).max(9999),
    }),
  ),
});
export type AdminData = z.infer<typeof adminSchema>;
export type IngredientInput = z.infer<typeof ingredientSchema>;
export type RecipeInput = z.infer<typeof recipeSchema>;
export function costs(data: AdminData, menu: AdminData["menus"][number]) {
  const uses = explodeBom(menu.bom, data.recipes);
  let food = new Decimal(0);
  for (const [id, qty] of uses) {
    const i = data.ingredients.find((i) => i.id === id);
    if (!i) throw new Error("ไม่พบวัตถุดิบในสูตร");
    food = food.plus(qty.mul(i.avgCost));
  }
  return channels.map((channel) => {
    const price = menu.prices.find((p) => p.channel === channel)?.price ?? 0;
    const feeBps = data.fees.find((f) => f.channel === channel)?.feeBps ?? 0;
    const packaging = menu.packaging
      .filter((p) => p.channel === channel)
      .reduce(
        (n, p) =>
          n.plus(
            new Decimal(p.qty).mul(
              data.ingredients.find((i) => i.id === p.ingredientId)?.avgCost ??
                0,
            ),
          ),
        new Decimal(0),
      );
    const net = price - roundMoney(new Decimal(price).mul(feeBps).div(10000));
    const cost = food.plus(packaging);
    return {
      menuId: menu.id,
      name: menu.name,
      channel,
      price,
      food: roundMoney(food),
      packaging: roundMoney(packaging),
      net,
      profit: roundMoney(new Decimal(net).minus(cost)),
      foodCostBps: price ? roundMoney(food.div(price).mul(10000)) : null,
      suggested35: roundMoney(food.div("0.35")),
      suggestedDelivery: suggestedDeliveryPrice(
        menu.prices.find((p) => p.channel === "DINE_IN")?.price ?? 0,
        feeBps,
      ),
    };
  });
}
