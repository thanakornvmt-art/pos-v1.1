import { createHash } from "node:crypto";
import { prisma } from "./db";
import { catalogSchema } from "@/domain/schema";
import { explodeBom } from "@/domain/inventory";
export async function snapshotCatalog() {
  const [settings, fees, categories, menus, recipes] = await Promise.all([
    prisma.settings.findUniqueOrThrow({ where: { id: "store" } }),
    prisma.channelSetting.findMany(),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.menuItem.findMany({
      where: { isActive: true },
      include: {
        prices: true,
        optionGroups: {
          include: { optionGroup: { include: { items: true } } },
        },
        bom: true,
        packaging: true,
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { sku: "asc" }],
    }),
    prisma.subRecipe.findMany({ include: { lines: true } }),
  ]);
  const recipeData = recipes.map((r) => ({
    id: r.id,
    outputQty: r.outputQty.toString(),
    lines: r.lines.map((l) => ({
      ingredientId: l.ingredientId,
      subRecipeId: l.childRecipeId,
      qty: l.qty.toString(),
    })),
  }));
  const data = catalogSchema.parse({
    settings,
    fees,
    categories,
    menus: menus.map((m) => ({
      ...m,
      groups: m.optionGroups.map((g) => ({
        ...g.optionGroup,
        items: g.optionGroup.items.map((o) => ({
          ...o,
          qtyDelta: o.qtyDelta?.toString() ?? null,
        })),
      })),
      ingredients: [
        ...explodeBom(
          m.bom.map((l) => ({
            ingredientId: l.ingredientId,
            subRecipeId: l.subRecipeId,
            qty: l.qty.toString(),
          })),
          recipeData,
        ),
      ].map(([ingredientId, qty]) => ({ ingredientId, qty: qty.toFixed(6) })),
      packaging: m.packaging.map((p) => ({ ...p, qty: p.qty.toString() })),
    })),
  });
  const id = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  await prisma.catalogSnapshot.upsert({
    where: { id },
    update: {},
    create: { id, data },
  });
  return { id, data };
}
