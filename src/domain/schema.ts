import { z } from "zod";
export const channels = [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
  "GRAB",
  "LINEMAN",
  "SHOPEE",
] as const;
export const channelSchema = z.enum(channels);
export type Channel = z.infer<typeof channelSchema>;
export const channelNames: Record<Channel, string> = {
  DINE_IN: "ทานที่ร้าน",
  TAKEAWAY: "กลับบ้าน",
  DELIVERY: "เดลิเวอรี่",
  GRAB: "Grab",
  LINEMAN: "LINE MAN",
  SHOPEE: "Shopee",
};
export const moneySchema = z.number().int().min(0).max(100_000_000);
export const quantitySchema = z.string().regex(/^\d+(\.\d{1,8})?$/);
export const ingredientUseSchema = z.object({
  ingredientId: z.string(),
  qty: quantitySchema,
});
const optionSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceDelta: moneySchema,
  ingredientId: z.string().nullable(),
  qtyDelta: quantitySchema.nullable(),
});
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().positive(),
  isRequired: z.boolean(),
  items: z.array(optionSchema),
});
export const menuSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  categoryId: z.string(),
  imageUrl: z.string(),
  prices: z.array(z.object({ channel: channelSchema, price: moneySchema })),
  groups: z.array(groupSchema),
  ingredients: z.array(ingredientUseSchema),
  packaging: z.array(
    z.object({
      channel: channelSchema,
      ingredientId: z.string(),
      qty: quantitySchema,
    }),
  ),
});
export const catalogSchema = z.object({
  settings: z.object({
    shopName: z.string(),
    taxBps: z.number().int().min(0).max(10000),
    offlineHours: z.number().int().positive(),
    syncGraceDays: z.number().int().positive(),
    promptpayId: z.string().nullable(),
    qrExpirySeconds: z.number().int().positive(),
  }),
  fees: z.array(
    z.object({
      channel: channelSchema,
      feeBps: z.number().int().min(0).max(9999),
    }),
  ),
  categories: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() }),
  ),
  menus: z.array(menuSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
export type Menu = z.infer<typeof menuSchema>;
export const lineSchema = z
  .object({
    id: z.string().uuid(),
    menuItemId: z.string(),
    qty: z.number().int().min(1).max(99),
    optionIds: z.array(z.string()).max(30),
    note: z.string().trim().max(200),
  })
  .strict();
export type CartLine = z.infer<typeof lineSchema>;
export const discountSchema = z
  .object({
    kind: z.enum(["BAHT", "PERCENT"]),
    value: moneySchema,
    reason: z
      .string()
      .trim()
      .min(3, "กรุณาใส่เหตุผลอย่างน้อย 3 ตัวอักษร")
      .max(200),
  })
  .strict()
  .refine(
    (d) => d.kind !== "PERCENT" || d.value <= 10000,
    "ส่วนลดต้องไม่เกิน 100%",
  );
export type Discount = z.infer<typeof discountSchema>;
export const paymentSchema = z
  .object({
    method: z.enum(["CASH", "PROMPTPAY", "CARD", "COD"]),
    tendered: moneySchema,
    refNo: z.string().trim().max(100),
    verified: z.boolean(),
  })
  .strict();
export const orderInputSchema = z
  .object({
    clientUuid: z.string().uuid(),
    deviceId: z.string().uuid(),
    localSequence: z.number().int().positive(),
    orderNo: z.string().min(3).max(80),
    queueNo: z.string().max(80),
    catalogId: z.string().length(64),
    createdBy: z.string(),
    createdAt: z.string().datetime(),
    channel: channelSchema,
    lines: z.array(lineSchema).min(1).max(100),
    discount: discountSchema.nullable(),
    total: moneySchema,
    payment: paymentSchema,
    deliveryId: z.string().uuid().optional(),
  })
  .strict();
export type OrderInput = z.infer<typeof orderInputSchema>;
export const grantSchema = z.object({
  sub: z.string(),
  deviceId: z.string().uuid(),
  catalogId: z.string(),
  prefix: z.string(),
  role: z.enum(["OWNER", "CASHIER"]),
  iat: z.number(),
  exp: z.number(),
});
export const bootstrapSchema = z.object({
  catalog: catalogSchema,
  catalogId: z.string(),
  permit: z.string(),
  expiresAt: z.number(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(["OWNER", "CASHIER"]),
  }),
  device: z.object({ id: z.string().uuid(), prefix: z.string() }),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export const auditInputSchema = z
  .object({
    clientUuid: z.string().uuid(),
    action: z.enum(["REMOVE_LINE", "CLEAR_CART", "SPLIT_BILL", "MERGE_BILL"]),
    entityId: z.string().uuid(),
    before: z.array(lineSchema),
    after: z.array(lineSchema),
    createdAt: z.string().datetime(),
  })
  .strict();
export const loginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
});
