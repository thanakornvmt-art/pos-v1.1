import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return Response.json(users, { headers: { "Cache-Control": "no-store" } });
}
