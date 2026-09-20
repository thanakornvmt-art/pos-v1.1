import { prisma } from "./db";
import { adminSchema } from "@/domain/admin";
export async function adminData() {
  const [ingredients, recipes, menus, suppliers, settings, fees] =
    await Promise.all([
      prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
      prisma.subRecipe.findMany({ include: { lines: true } }),
      prisma.menuItem.findMany({
        include: { prices: true, bom: true, packaging: true },
        orderBy: { sku: "asc" },
      }),
      prisma.supplier.findMany(),
      prisma.settings.findUniqueOrThrow({ where: { id: "store" } }),
      prisma.channelSetting.findMany(),
    ]);
  return adminSchema.parse({
    ingredients: ingredients.map((i) => ({
      ...i,
      conversionRate: i.conversionRate.toString(),
      yieldPercent: i.yieldPercent.toString(),
      avgCost: i.avgCost.toString(),
      currentQty: i.currentQty.toString(),
      parLevel: i.parLevel.toString(),
      reorderPoint: i.reorderPoint.toString(),
    })),
    recipes: recipes.map((r) => ({
      ...r,
      outputQty: r.outputQty.toString(),
      lines: r.lines.map((l) => ({
        ingredientId: l.ingredientId,
        subRecipeId: l.childRecipeId,
        qty: l.qty.toString(),
      })),
    })),
    menus: menus.map((m) => ({
      ...m,
      bom: m.bom.map((l) => ({
        ingredientId: l.ingredientId,
        subRecipeId: l.subRecipeId,
        qty: l.qty.toString(),
      })),
      packaging: m.packaging.map((p) => ({ ...p, qty: p.qty.toString() })),
    })),
    suppliers,
    settings,
    fees,
  });
}
