import { prisma } from "./db";
import { adminSchema } from "@/domain/admin";
import { recipeVersion } from "./recipe-version";
export async function adminData() {
  const [ingredients, recipes, menus, suppliers, settings, fees, categories] =
    await Promise.all([
      prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
      prisma.subRecipe.findMany({ include: { lines: true } }),
      prisma.menuItem.findMany({
        include: {
          prices: true,
          bom: true,
          packaging: true,
          optionGroups: {
            include: { optionGroup: { include: { items: true } } },
          },
        },
        orderBy: { sku: "asc" },
      }),
      prisma.supplier.findMany(),
      prisma.settings.findUniqueOrThrow({ where: { id: "store" } }),
      prisma.channelSetting.findMany(),
      prisma.category.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);
  return adminSchema.parse({
    categories,
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
      recipeVersion: recipeVersion(m),
      groups: m.optionGroups.map(({ optionGroup: g }) => ({
        ...g,
        items: g.items.map((o) => ({
          ...o,
          qtyDelta: o.qtyDelta?.toString() ?? null,
        })),
      })),
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
