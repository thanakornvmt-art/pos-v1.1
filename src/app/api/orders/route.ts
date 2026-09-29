import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorized, fail } from "@/lib/http";
import { businessDateSchema, dateBounds } from "@/domain/reports";
const querySchema = z.object({
  q: z.string().trim().max(80).default(""),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  cursor: z.string().uuid().optional(),
});
export async function GET(req: Request) {
  try {
    await authorized();
  } catch (e) {
    return fail(e, 403);
  }
  try {
    const q = querySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (Boolean(q.from) !== Boolean(q.to) || (q.from && q.to && q.from > q.to))
      throw new Error("ช่วงวันที่ไม่ถูกต้อง");
    const rows = await prisma.order.findMany({
      where: {
        ...(q.from && q.to ? { createdAt: dateBounds(q.from, q.to) } : {}),
        ...(q.q
          ? {
              OR: [
                { orderNo: { contains: q.q, mode: "insensitive" } },
                { queueNo: { contains: q.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        clientUuid: true,
        orderNo: true,
        queueNo: true,
        total: true,
        status: true,
        createdAt: true,
        channel: true,
      },
    });
    return Response.json(
      {
        orders: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
