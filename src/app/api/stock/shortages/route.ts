import { prisma } from "@/lib/db";
import { authorized, fail } from "@/lib/http";
export async function GET() {
  try {
    await authorized(true);
    const rows = await prisma.ingredient.findMany({
      where: { currentQty: { lt: 0 } },
      select: { id: true, name: true, currentQty: true, usageUnit: true },
      orderBy: { name: "asc" },
    });
    return Response.json(
      rows.map((row) => ({ ...row, currentQty: row.currentQty.toString() })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error, 403);
  }
}
