import { hash } from "bcryptjs";
import { employeeMutation } from "@/domain/employees";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
const publicFields = {
  id: true,
  name: true,
  role: true,
  active: true,
  failedAttempts: true,
  lockedUntil: true,
} as const;
export async function GET() {
  try {
    const user = await authorized(true);
    const employees = await prisma.user.findMany({
      select: publicFields,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return Response.json(
      { currentUserId: user.id, employees },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const actor = await authorized(true);
    const input = employeeMutation.parse(await body(req));
    const pinHash = "pin" in input ? await hash(input.pin, 12) : undefined;
    const result = await serializable(async (tx) => {
      // Serialize owner changes so two admins cannot remove the final owner together.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73021)::text`;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
      });
      if (
        !current.active ||
        current.role !== "OWNER" ||
        current.authVersion !== actor.authVersion
      )
        throw new Error("สิทธิ์เปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่");
      if (input.action === "create") {
        if (await tx.user.findUnique({ where: { id: input.id } }))
          throw new Error("บัญชีนี้ถูกสร้างแล้ว กรุณาตรวจรายชื่อก่อนเพิ่มซ้ำ");
        const saved = await tx.user.create({
          data: {
            id: input.id,
            name: input.name,
            role: input.role,
            pinHash: pinHash!,
          },
          select: publicFields,
        });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "CREATE_EMPLOYEE",
            entity: "User",
            entityId: saved.id,
            beforeJson: {},
            afterJson: {
              name: saved.name,
              role: saved.role,
              active: true,
              pinSet: true,
            },
          },
        });
        return saved;
      }
      const old = await tx.user.findUniqueOrThrow({ where: { id: input.id } });
      const removingOwner =
        old.active &&
        old.role === "OWNER" &&
        ((input.action === "active" && !input.active) ||
          (input.action === "update" && input.role !== "OWNER"));
      if (
        removingOwner &&
        (await tx.user.count({ where: { active: true, role: "OWNER" } })) <= 1
      )
        throw new Error("ต้องมีเจ้าของร้านที่ใช้งานได้อย่างน้อย 1 คน");
      if (
        old.id === actor.id &&
        ((input.action === "active" && !input.active) ||
          (input.action === "update" && input.role !== "OWNER"))
      )
        throw new Error("ไม่สามารถปิดบัญชีหรือลดสิทธิ์ของตนเองขณะใช้งาน");
      const changes =
        input.action === "pin"
          ? {
              pinHash,
              failedAttempts: 0,
              lockedUntil: null,
              authVersion: { increment: 1 },
            }
          : input.action === "active"
            ? {
                active: input.active,
                failedAttempts: 0,
                lockedUntil: null,
                authVersion: { increment: 1 },
              }
            : {
                name: input.name,
                role: input.role,
                ...(input.role !== old.role
                  ? { authVersion: { increment: 1 } }
                  : {}),
              };
      const saved = await tx.user.update({
        where: { id: old.id },
        data: changes,
        select: publicFields,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: `EMPLOYEE_${input.action.toUpperCase()}`,
          entity: "User",
          entityId: old.id,
          beforeJson: { name: old.name, role: old.role, active: old.active },
          afterJson: {
            name: saved.name,
            role: saved.role,
            active: saved.active,
            reason: input.reason,
            pinChanged: input.action === "pin",
          },
        },
      });
      return saved;
    });
    return Response.json({ employee: result });
  } catch (e) {
    return fail(e, 400);
  }
}
