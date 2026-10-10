import {
  categoryCreateSchema,
  categoryNameKey,
} from "@/domain/category-create";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { canonical } from "@/lib/canonical";
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof authorized>>;
  try {
    sameOrigin(req);
    user = await authorized(true);
  } catch (e) {
    return fail(e, 403);
  }
  try {
    const parsed = categoryCreateSchema.safeParse(await body(req));
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const v = parsed.data;
    const category = await serializable(async (tx) => {
      const existing = await tx.category.findUnique({ where: { id: v.id } });
      if (existing) {
        const audit = await tx.auditLog.findFirst({
          where: {
            entity: "Category",
            entityId: v.id,
            action: "CREATE_CATEGORY",
            userId: user.id,
          },
        });
        if (audit && canonical(audit.afterJson) === canonical(v))
          return existing;
        throw new Error("รายการนี้ถูกบันทึกแล้ว กรุณาตรวจชื่อหมวดหมู่");
      }
      // Serializable predicate reads protect concurrent duplicate names without a schema change.
      const all = await tx.category.findMany({
        select: { name: true, sortOrder: true },
      });
      if (all.some((c) => categoryNameKey(c.name) === categoryNameKey(v.name)))
        throw new Error(
          "มีหมวดหมู่ชื่อนี้แล้ว กรุณาเลือกหมวดหมู่เดิมหรือใช้ชื่ออื่น",
        );
      const last = all.reduce((n, c) => Math.max(n, c.sortOrder), 0);
      const result = await tx.category.create({
        data: { id: v.id, name: v.name, sortOrder: last + 1, color: "#eddda5" },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "CREATE_CATEGORY",
          entity: "Category",
          entityId: v.id,
          beforeJson: {},
          afterJson: v,
        },
      });
      return result;
    });
    return Response.json(
      { category },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
