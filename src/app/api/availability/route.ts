import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    await prisma.menuItem.findMany({
      select: { id: true, isActive: true, soldOut: true },
      orderBy: { id: "asc" },
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
