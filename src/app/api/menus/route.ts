import { prisma } from "@/lib/db";
import { adminData } from "@/lib/admin-data";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { menuCreateSchema } from "@/domain/menu-create";
import { explodeBom } from "@/domain/inventory";
import { canonical } from "@/lib/canonical";

export async function GET() {
  try {
    await authorized(true);
    const [data, categories] = await Promise.all([
      adminData(),
      prisma.category.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return Response.json(
      { ingredients: data.ingredients, recipes: data.recipes, categories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e, 403);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const input = menuCreateSchema.safeParse(await body(req));
    if (!input.success) throw new Error(input.error.issues[0].message);
    const v = input.data;
    await serializable(async (tx) => {
      // A stable client id lets a retry recover from a lost response without creating another menu.
      const existing = await tx.menuItem.findUnique({ where: { id: v.id } });
      if (existing) {
        const audit = await tx.auditLog.findFirst({
          where: {
            entity: "MenuItem",
            entityId: v.id,
            action: "CREATE_MENU",
            userId: user.id,
          },
        });
        if (audit && canonical(audit.afterJson) === canonical(v)) return;
        throw new Error("รายการนี้ถูกบันทึกแล้ว กรุณาปิดหน้าต่างและตรวจเมนู");
      }
      if (!(await tx.category.findUnique({ where: { id: v.categoryId } })))
        throw new Error("ไม่พบหมวดหมู่ กรุณาเปิดฟอร์มใหม่");
      const recipes = await tx.subRecipe.findMany({ include: { lines: true } });
      const uses = explodeBom(
        v.lines,
        recipes.map((r) => ({
          id: r.id,
          outputQty: r.outputQty.toString(),
          lines: r.lines.map((l) => ({
            ingredientId: l.ingredientId,
            subRecipeId: l.childRecipeId,
            qty: l.qty.toString(),
          })),
        })),
      );
      if (!uses.size)
        throw new Error("สูตรที่เลือกยังไม่มีวัตถุดิบ กรุณาตรวจสอบสูตร");
      const ids = [
        ...new Set([...uses.keys(), ...v.packaging.map((p) => p.ingredientId)]),
      ];
      const ingredients = await tx.ingredient.findMany({
        where: { id: { in: ids }, active: true },
      });
      if (ingredients.length !== ids.length)
        throw new Error(
          "วัตถุดิบในสูตรหรือบรรจุภัณฑ์ถูกปิดใช้งานหรือไม่พบ กรุณาตรวจสอบ",
        );
      await tx.menuItem.create({
        data: {
          id: v.id,
          sku: `MENU-${v.id}`,
          name: v.name,
          categoryId: v.categoryId,
          imageUrl: "",
          prepSeconds: 180,
          isActive: true,
          prices: { create: v.prices },
          bom: {
            create: v.lines.map((l) => ({
              ...l,
              unit: l.ingredientId
                ? ingredients.find((i) => i.id === l.ingredientId)!.usageUnit
                : recipes.find((r) => r.id === l.subRecipeId)!.outputUnit,
            })),
          },
          packaging: { create: v.packaging },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "CREATE_MENU",
          entity: "MenuItem",
          entityId: v.id,
          beforeJson: {},
          afterJson: JSON.parse(JSON.stringify(v)),
        },
      });
    });
    return Response.json({ ok: true, id: v.id });
  } catch (e) {
    return fail(e);
  }
}
