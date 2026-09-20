import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./db";
import { ZodError } from "zod";
export async function authorized(ownerOnly = false) {
  const session = await getServerSession(authOptions);
  const user = session?.user.id
    ? await prisma.user.findUnique({ where: { id: session.user.id } })
    : null;
  if (
    !user?.active ||
    user.authVersion !== session?.user.authVersion ||
    user.role === "KITCHEN" ||
    (ownerOnly && user.role !== "OWNER")
  )
    throw new Error("ไม่มีสิทธิ์ทำรายการ");
  return user;
}
export function sameOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    throw new Error("ต้นทางคำขอไม่ถูกต้อง");
}
export async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 200000) throw new Error("ข้อมูลใหญ่เกินกำหนด");
  return JSON.parse(text) as unknown;
}
export function fail(error: unknown, status = 400) {
  console.error(error instanceof Error ? error.message : "request failed");
  if (error instanceof ZodError)
    return Response.json(
      { error: "ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง กรุณาตรวจช่องที่กรอก" },
      { status },
    );
  return Response.json(
    {
      error:
        error instanceof Error && !("code" in error)
          ? error.message
          : "ทำรายการไม่สำเร็จ กรุณาลองใหม่",
    },
    { status },
  );
}
