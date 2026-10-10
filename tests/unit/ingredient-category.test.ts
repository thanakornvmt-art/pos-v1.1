import { expect, it } from "vitest";
import { ingredientSchema } from "../../src/domain/admin";
import { ingredientCategorySchema } from "../../src/domain/ingredient-category";
const legacy = {
  id: "rice",
  name: "ข้าว",
  purchaseUnit: "kg",
  usageUnit: "g",
  conversionRate: "1000",
  yieldPercent: "100",
  parLevel: "0",
  reorderPoint: "0",
  isPerishable: false,
  shelfLifeDays: null,
  supplierId: null,
};
it("accepts legacy omission without inventing a category and permits explicit unclassification", () => {
  expect(ingredientSchema.parse(legacy)).not.toHaveProperty("category");
  expect(
    ingredientSchema.parse({ ...legacy, category: null }).category,
  ).toBeNull();
});
it("validates only the three supported categories", () => {
  for (const category of ["FOOD", "SEASONING", "PACKAGING"])
    expect(ingredientSchema.parse({ ...legacy, category }).category).toBe(
      category,
    );
  for (const category of ["food", "OTHER", "", 1, {}])
    expect(ingredientCategorySchema.safeParse(category).success).toBe(false);
});
