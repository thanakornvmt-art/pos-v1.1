import { z } from "zod";
import { adminSchema, recipeLineSchema, packagingLineSchema } from "./admin";
import { channels, channelSchema, moneySchema } from "./schema";

export const menuCreateSchema = z
  .object({
    id: z.string().uuid(),
    name: z
      .string()
      .trim()
      .min(1, "กรุณาใส่ชื่อเมนู")
      .max(100, "ชื่อเมนูยาวเกิน 100 ตัวอักษร"),
    categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
    prices: z
      .array(z.object({ channel: channelSchema, price: moneySchema }))
      .length(channels.length)
      .refine(
        (v) => new Set(v.map((p) => p.channel)).size === channels.length,
        "กรุณากำหนดราคาให้ครบทุกช่องทาง",
      ),
    lines: z
      .array(recipeLineSchema)
      .min(1, "กรุณาเพิ่มวัตถุดิบหรือสูตรย่อยอย่างน้อย 1 รายการ")
      .max(100),
    packaging: z.array(packagingLineSchema).max(100).default([]),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const keys = v.packaging.map((p) => `${p.channel}:${p.ingredientId}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        path: ["packaging"],
        message: "บรรจุภัณฑ์ซ้ำในช่องทางเดียวกัน",
      });
  });
export const menuCreateDataSchema = adminSchema
  .pick({ ingredients: true, recipes: true })
  .extend({
    categories: z.array(z.object({ id: z.string(), name: z.string() })),
  });
export type MenuCreate = z.infer<typeof menuCreateSchema>;

export function bahtPrice(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("ราคาต้องเป็นจำนวนตั้งแต่ 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  const satang = Math.round(Number(value) * 100);
  if (!moneySchema.safeParse(satang).success)
    throw new Error("ราคาต้องไม่เกิน 1,000,000 บาท");
  return satang;
}
