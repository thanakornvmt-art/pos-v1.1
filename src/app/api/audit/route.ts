import { prisma } from "@/lib/db";
import { authorized, fail } from "@/lib/http";
import { auditQuerySchema, redactAudit } from "@/domain/audit";
import { dateBounds } from "@/domain/reports";
export async function GET(req: Request) {
  try {
    await authorized(true);
    const query = auditQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const rows = await prisma.auditLog.findMany({
      where: {
        createdAt: dateBounds(query.from, query.to),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: 51,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        createdAt: true,
        user: { select: { name: true } },
        beforeJson: true,
        afterJson: true,
      },
    });
    return Response.json(
      {
        rows: rows
          .slice(0, 50)
          .map((row) => ({
            ...row,
            beforeJson: redactAudit(row.beforeJson),
            afterJson: redactAudit(row.afterJson),
          })),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error, 403);
  }
}
