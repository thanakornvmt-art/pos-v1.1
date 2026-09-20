import { z } from "zod";
import { jwtVerify } from "jose";
import { lineSchema, grantSchema, discountSchema } from "@/domain/schema";
import { body, fail, sameOrigin } from "@/lib/http";
import { prisma } from "@/lib/db";
const schema = z
  .object({
    id: z.string().uuid(),
    permit: z.string(),
    userId: z.string(),
    deviceId: z.string().uuid(),
    action: z.enum([
      "REMOVE_LINE",
      "CLEAR_CART",
      "SPLIT_BILL",
      "MERGE_BILL",
      "PRINT_KITCHEN",
      "PRINT_CUSTOMER",
      "SET_DISCOUNT",
    ]),
    entityId: z.string().uuid(),
    before: z.array(lineSchema),
    after: z.array(lineSchema),
    createdAt: z.string().datetime(),
    state: z.literal("pending"),
    details: discountSchema.optional(),
  })
  .strict();
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const v = schema.parse(await body(req));
    const { payload } = await jwtVerify(
      v.permit,
      new TextEncoder().encode(process.env.NEXTAUTH_SECRET),
      {
        algorithms: ["HS256"],
        issuer: "morning-pos",
        audience: "offline-orders",
        currentDate: new Date(v.createdAt),
      },
    );
    const grant = grantSchema.parse(payload);
    if (
      grant.sub !== v.userId ||
      grant.deviceId !== v.deviceId ||
      new Date(v.createdAt).getTime() < grant.iat * 1000 - 1000 ||
      new Date(v.createdAt).getTime() > Date.now() + 60000
    )
      throw new Error("สิทธิ์ไม่ถูกต้อง");
    await prisma.auditLog.upsert({
      where: { clientUuid: v.id },
      update: {},
      create: {
        clientUuid: v.id,
        userId: v.userId,
        action: v.action,
        entity: v.action.startsWith("PRINT_") ? "PrintJob" : "Draft",
        entityId: v.entityId,
        beforeJson: v.before,
        afterJson: { lines: v.after, details: v.details ?? null },
        createdAt: new Date(v.createdAt),
      },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
