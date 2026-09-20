import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { snapshotCatalog } from "@/lib/catalog";
import { channelSchema, lineSchema, catalogSchema } from "@/domain/schema";
import { stages } from "@/domain/delivery";
import { priceOrder } from "@/domain/pricing";
import { canonical } from "@/lib/canonical";
const mutation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    id: z.string().uuid(),
    channel: channelSchema,
    externalRef: z.string().trim().min(1).max(100),
    lines: z.array(lineSchema).min(1),
    catalogId: z.string(),
  }),
  z.object({
    kind: z.literal("stage"),
    id: z.string().uuid(),
    stage: z.enum(stages),
  }),
  z.object({
    kind: z.literal("soldOut"),
    id: z.string(),
    soldOut: z.boolean(),
    confirmed: z.literal(true),
  }),
]);
export async function GET() {
  try {
    await authorized();
    const snapshot = await snapshotCatalog();
    const [tickets, availability, orders] = await Promise.all([
      prisma.deliveryTicket.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.menuItem.findMany({
        where: { isActive: true },
        select: { id: true, name: true, soldOut: true },
      }),
      prisma.order.findMany({
        where: {
          status: "PAID",
          createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const linked = new Set(tickets.map((t) => t.paidOrderUuid));
    const combined = [
      ...tickets,
      ...orders
        .filter((o) => !linked.has(o.clientUuid))
        .map((o) => ({
          id: o.clientUuid,
          channel: o.channel,
          externalRef: o.queueNo,
          lines: o.lines.map((l) => ({
            id: l.id,
            menuItemId: l.menuItemId,
            qty: l.qty,
            optionIds: z
              .array(z.object({ id: z.string() }))
              .parse(l.optionsJson)
              .map((v) => v.id),
            note: l.note,
          })),
          total: o.total,
          netPayout: o.netPayout,
          stage: o.fulfillmentStage,
          paidOrderUuid: o.clientUuid,
          createdAt: o.createdAt,
          catalogId: o.catalogId,
        })),
    ];
    return Response.json({
      tickets: combined,
      catalog: snapshot.data,
      catalogId: snapshot.id,
      availability,
    });
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized();
    const v = mutation.parse(await body(req));
    await serializable(async (tx) => {
      let before: unknown = {};
      if (v.kind === "create") {
        const old = await tx.deliveryTicket.findUnique({ where: { id: v.id } });
        if (old) {
          if (
            old.channel !== v.channel ||
            old.externalRef !== v.externalRef ||
            canonical(old.lines) !== canonical(v.lines)
          )
            throw new Error("เลขคำขอซ้ำ");
          return;
        }
        const snapshot = await tx.catalogSnapshot.findUniqueOrThrow({
          where: { id: v.catalogId },
        });
        const catalog = catalogSchema.parse(snapshot.data);
        const sold = await tx.menuItem.count({
          where: {
            id: { in: v.lines.map((l) => l.menuItemId) },
            OR: [{ soldOut: true }, { isActive: false }],
          },
        });
        if (sold) throw new Error("บางเมนูหมดแล้ว กรุณาเลือกใหม่");
        const price = priceOrder(catalog, v.channel, v.lines);
        await tx.deliveryTicket.create({
          data: {
            id: v.id,
            channel: v.channel,
            externalRef: v.externalRef,
            lines: v.lines,
            total: price.total,
            netPayout: price.netPayout,
            catalogId: v.catalogId,
            createdBy: user.id,
          },
        });
      }
      if (v.kind === "stage") {
        const ticket = await tx.deliveryTicket.findUnique({
          where: { id: v.id },
        });
        if (ticket) {
          before = ticket;
          if (
            stages.indexOf(v.stage) !==
            stages.indexOf(ticket.stage as (typeof stages)[number]) + 1
          )
            throw new Error("เปลี่ยนได้เฉพาะสถานะถัดไป");
          await tx.deliveryTicket.update({
            where: { id: v.id },
            data: { stage: v.stage },
          });
          if (ticket.paidOrderUuid)
            await tx.order.update({
              where: { clientUuid: ticket.paidOrderUuid },
              data: { fulfillmentStage: v.stage },
            });
        } else {
          const order = await tx.order.findUniqueOrThrow({
            where: { clientUuid: v.id },
          });
          before = order;
          if (
            stages.indexOf(v.stage) !==
            stages.indexOf(order.fulfillmentStage as (typeof stages)[number]) +
              1
          )
            throw new Error("เปลี่ยนได้เฉพาะสถานะถัดไป");
          await tx.order.update({
            where: { id: order.id },
            data: { fulfillmentStage: v.stage },
          });
        }
      }
      if (v.kind === "soldOut") {
        before = await tx.menuItem.findUniqueOrThrow({ where: { id: v.id } });
        await tx.menuItem.update({
          where: { id: v.id },
          data: { soldOut: v.soldOut },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `DELIVERY_${v.kind.toUpperCase()}`,
          entity: "Delivery",
          entityId: v.id,
          beforeJson: JSON.parse(JSON.stringify(before)) as object,
          afterJson: v,
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e, 409);
  }
}
