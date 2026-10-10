import { z } from "zod";

export const ingredientCategories = ["FOOD", "SEASONING", "PACKAGING"] as const;
export const ingredientCategorySchema = z.enum(ingredientCategories);
export type IngredientCategory = z.infer<typeof ingredientCategorySchema>;
export const ingredientCategoryNames: Record<IngredientCategory, string> = {
  FOOD: "วัตถุดิบอาหาร",
  SEASONING: "เครื่องปรุง",
  PACKAGING: "บรรจุภัณฑ์และวัสดุสิ้นเปลือง",
};
export function ingredientCategoryLabel(category: IngredientCategory | null) {
  return category ? ingredientCategoryNames[category] : "ยังไม่ระบุหมวด";
}
