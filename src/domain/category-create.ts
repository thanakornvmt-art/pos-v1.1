import { z } from "zod";
export function normalizeCategoryName(name: string) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}
export const categoryNameSchema = z
  .string()
  .transform(normalizeCategoryName)
  .pipe(
    z
      .string()
      .min(1, "กรุณาใส่ชื่อหมวดหมู่")
      .max(100, "ชื่อหมวดหมู่ยาวเกิน 100 ตัวอักษร"),
  );
export const categoryCreateSchema = z
  .object({
    id: z.string().uuid(),
    name: categoryNameSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const categoryCreatedSchema = z.object({
  category: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    sortOrder: z.number().int(),
  }),
});
export type CreatedCategory = z.infer<typeof categoryCreatedSchema>["category"];
export function categoryNameKey(name: string) {
  return normalizeCategoryName(name)
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH");
}
