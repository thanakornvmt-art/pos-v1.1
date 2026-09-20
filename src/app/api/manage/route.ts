import { z } from "zod";
import {
  ingredientSchema,
  recipeSchema,
  recipeLineSchema,
  settingsSchema,
} from "@/domain/admin";
import { channelSchema, moneySchema } from "@/domain/schema";
import { adminData } from "@/lib/admin-data";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { explodeBom } from "@/domain/inventory";
const mutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ingredient"), data: ingredientSchema }),
  z.object({
    kind: z.literal("archiveIngredient"),
    id: z.string(),
    confirmed: z.literal(true),
  }),
  z.object({ kind: z.literal("recipe"), data: recipeSchema }),
  z.object({
    kind: z.literal("bom"),
    id: z.string(),
    lines: z.array(recipeLineSchema).min(1),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("settings"),
    data: settingsSchema,
    fees: z
      .array(
        z.object({
          channel: channelSchema,
          feeBps: z.number().int().min(0).max(9999),
        }),
      )
      .length(6),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("price"),
    id: z.string(),
    channel: channelSchema,
    price: moneySchema,
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("supplier"),
    data: z.object({
      id: z.string(),
      name: z.string().trim().min(1).max(100),
      phone: z.string().max(30),
      lineId: z.string().max(100),
    }),
  }),
]);
export async function GET() {
  try {
    await authorized(true);
    return Response.json(await adminData(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const v = mutation.parse(await body(req));
    await serializable(async (tx) => {
      let before: unknown = {};
      let entityId = "";
      if (v.kind === "ingredient") {
        const old = await tx.ingredient.findUnique({
          where: { id: v.data.id },
        });
        before = old ?? {};
        entityId = v.data.id;
        if (
          old &&
          (old.usageUnit !== v.data.usageUnit ||
            old.conversionRate.toString() !== v.data.conversionRate)
        )
          throw new Error(
            "หน่วยและ conversion ของวัตถุดิบที่สร้างแล้วเปลี่ยนไม่ได้ ให้สร้างวัตถุดิบใหม่",
          );
        await tx.ingredient.upsert({
          where: { id: v.data.id },
          update: v.data,
          create: { ...v.data, avgCost: 0, currentQty: 0 },
        });
      }
      if (v.kind === "archiveIngredient") {
        entityId = v.id;
        before = await tx.ingredient.findUniqueOrThrow({ where: { id: v.id } });
        const used = await tx.ingredient.findUniqueOrThrow({
          where: { id: v.id },
          include: {
            _count: {
              select: {
                bomLines: true,
                recipeLines: true,
                packaging: true,
                options: true,
              },
            },
          },
        });
        if (Object.values(used._count).some((n) => n > 0))
          throw new Error("วัตถุดิบยังถูกใช้ในสูตร กรุณาถอดออกจากสูตรก่อน");
        await tx.ingredient.update({
          where: { id: v.id },
          data: { active: false },
        });
      }
      if (v.kind === "recipe") {
        entityId = v.data.id;
        const all = await tx.subRecipe.findMany({ include: { lines: true } });
        before = all.find((r) => r.id === v.data.id) ?? {};
        const graph = all
          .filter((r) => r.id !== v.data.id)
          .map((r) => ({
            id: r.id,
            outputQty: r.outputQty.toString(),
            lines: r.lines.map((l) => ({
              ingredientId: l.ingredientId,
              subRecipeId: l.childRecipeId,
              qty: l.qty.toString(),
            })),
          }));
        graph.push(v.data);
        for (const r of graph) explodeBom(r.lines, graph, undefined, [r.id]);
        const { lines, ...data } = v.data;
        await tx.subRecipe.upsert({
          where: { id: data.id },
          update: data,
          create: data,
        });
        await tx.subRecipeLine.deleteMany({ where: { subRecipeId: data.id } });
        await tx.subRecipeLine.createMany({
          data: lines.map((l) => ({
            subRecipeId: data.id,
            ingredientId: l.ingredientId,
            childRecipeId: l.subRecipeId,
            qty: l.qty,
          })),
        });
      }
      if (v.kind === "bom") {
        entityId = v.id;
        before = await tx.bomLine.findMany({ where: { menuItemId: v.id } });
        const recipes = await tx.subRecipe.findMany({
          include: { lines: true },
        });
        explodeBom(
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
        await tx.bomLine.deleteMany({ where: { menuItemId: v.id } });
        for (const l of v.lines) {
          const unit = l.ingredientId
            ? (
                await tx.ingredient.findUniqueOrThrow({
                  where: { id: l.ingredientId },
                })
              ).usageUnit
            : (
                await tx.subRecipe.findUniqueOrThrow({
                  where: { id: l.subRecipeId ?? "" },
                })
              ).outputUnit;
          await tx.bomLine.create({ data: { menuItemId: v.id, ...l, unit } });
        }
      }
      if (v.kind === "settings") {
        entityId = "store";
        before = await tx.settings.findUniqueOrThrow({
          where: { id: "store" },
        });
        if (new Set(v.fees.map((f) => f.channel)).size !== 6)
          throw new Error("ช่องทางซ้ำ");
        await tx.settings.update({ where: { id: "store" }, data: v.data });
        for (const f of v.fees)
          await tx.channelSetting.upsert({
            where: { channel: f.channel },
            update: { feeBps: f.feeBps },
            create: f,
          });
      }
      if (v.kind === "price") {
        entityId = v.id;
        before = await tx.menuPrice.findUnique({
          where: {
            menuItemId_channel: { menuItemId: v.id, channel: v.channel },
          },
        });
        await tx.menuPrice.upsert({
          where: {
            menuItemId_channel: { menuItemId: v.id, channel: v.channel },
          },
          update: { price: v.price },
          create: { menuItemId: v.id, channel: v.channel, price: v.price },
        });
      }
      if (v.kind === "supplier") {
        entityId = v.data.id;
        before =
          (await tx.supplier.findUnique({ where: { id: v.data.id } })) ?? {};
        await tx.supplier.upsert({
          where: { id: v.data.id },
          update: v.data,
          create: v.data,
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: v.kind.toUpperCase(),
          entity: "Management",
          entityId,
          beforeJson: JSON.parse(JSON.stringify(before)) as object,
          afterJson: JSON.parse(JSON.stringify(v)) as object,
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
