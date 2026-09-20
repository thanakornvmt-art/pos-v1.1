import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    await prisma.menuItem.findMany({
      where: { isActive: true },
      select: { id: true, soldOut: true },
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
