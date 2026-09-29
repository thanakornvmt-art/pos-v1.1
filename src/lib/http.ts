import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./db";
import { ZodError } from "zod";
import { readJson } from "./read-json";
import { assertSameOrigin } from "./request-origin";
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
  assertSameOrigin(req, process.env.NEXTAUTH_URL ?? req.url);
}
export async function body(req: Request): Promise<unknown> {
  return readJson(req);
}
export function fail(error: unknown, status = 400) {
  console.error(
    "request failed",
    error instanceof ZodError
      ? "validation"
      : error instanceof Error
        ? error.name
        : "unknown",
  );
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
