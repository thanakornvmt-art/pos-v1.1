import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { z } from "zod";
import { stages } from "@/domain/delivery";
async function user() {
  const session = await getServerSession(authOptions);
  const u = session
    ? await prisma.user.findUnique({ where: { id: session.user.id } })
    : null;
  if (!u?.active || u.authVersion !== session?.user.authVersion)
    throw new Error("กรุณาเข้าสู่ระบบ");
  return u;
}
export async function GET() {
  try {
    await user();
    const [orders, tickets] = await Promise.all([
      prisma.order.findMany({
        where: {
          status: "PAID",
          fulfillmentStage: { not: "SENT" },
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        include: { lines: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.deliveryTicket.findMany({
        where: {
          paidOrderUuid: null,
          stage: { not: "SENT" },
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const menus = await prisma.menuItem.findMany({
      select: { id: true, name: true },
    });
    const lines = z.array(
      z.object({ menuItemId: z.string(), qty: z.number(), note: z.string() }),
    );
    return Response.json([
      ...orders.map((o) => ({
        id: o.clientUuid,
        kind: "ORDER",
        queue: o.queueNo,
        channel: o.channel,
        stage: o.fulfillmentStage,
        lines: o.lines.map((l) => ({
          name: l.menuName,
          qty: l.qty,
          note: l.note,
        })),
      })),
      ...tickets.map((t) => ({
        id: t.id,
        kind: "TICKET",
        queue: t.externalRef,
        channel: t.channel,
        stage: t.stage,
        lines: lines.parse(t.lines).map((l) => ({
          name: menus.find((m) => m.id === l.menuItemId)?.name ?? l.menuItemId,
          qty: l.qty,
          note: l.note,
        })),
      })),
    ]);
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await user();
    const v = z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["ORDER", "TICKET"]),
        stage: z.enum(stages),
      })
      .parse(await body(req));
    await serializable(async (tx) => {
      const old =
        v.kind === "ORDER"
          ? (await tx.order.findUniqueOrThrow({ where: { clientUuid: v.id } }))
              .fulfillmentStage
          : (await tx.deliveryTicket.findUniqueOrThrow({ where: { id: v.id } }))
              .stage;
      if (
        stages.indexOf(v.stage) !==
        stages.indexOf(old as (typeof stages)[number]) + 1
      )
        throw new Error("เลือกสถานะถัดไปเท่านั้น");
      if (v.kind === "ORDER")
        await tx.order.update({
          where: { clientUuid: v.id },
          data: { fulfillmentStage: v.stage },
        });
      else
        await tx.deliveryTicket.update({
          where: { id: v.id },
          data: { stage: v.stage },
        });
      if (v.kind === "ORDER")
        await tx.deliveryTicket.updateMany({
          where: { paidOrderUuid: v.id },
          data: { stage: v.stage },
        });
      await tx.auditLog.create({
        data: {
          userId: u.id,
          action: "KITCHEN_STAGE",
          entity: v.kind,
          entityId: v.id,
          beforeJson: { stage: old },
          afterJson: { stage: v.stage },
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
