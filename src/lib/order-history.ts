import { z } from "zod";
import { prisma } from "./db";
import { catalogSchema } from "@/domain/schema";
import type { OrderDetail } from "@/domain/order-history";

export async function orderDetail(
  id: string,
  owner: boolean,
): Promise<OrderDetail> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { clientUuid: id },
    include: { lines: true, payments: true, catalog: true },
  });
  const catalog = catalogSchema.parse(order.catalog.data);
  const [replacement, source] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { action: "AMEND_ORDER", entityId: order.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.findFirst({
      where: { action: "AMEND_ORDER", clientUuid: id },
    }),
  ]);
  const payment = order.payments[0];
  const editLines = order.lines.map((l) => ({
    id: l.id,
    menuItemId: l.menuItemId,
    qty: l.qty,
    note: l.note,
    optionIds: z
      .array(z.object({ id: z.string() }))
      .parse(l.optionsJson)
      .map((o) => o.id),
  }));
  return {
    id: order.id,
    clientUuid: order.clientUuid,
    orderNo: order.orderNo,
    queueNo: order.queueNo,
    status: order.status,
    total: order.total,
    discount: order.discount,
    createdAt: order.createdAt.toISOString(),
    channel: order.channel,
    payloadHash: order.payloadHash,
    canEdit: owner && order.status === "PAID",
    catalog: owner ? catalog : undefined,
    editLines,
    voidReason: order.voidReason,
    replacementId: replacement
      ? z.object({ replacementId: z.string() }).parse(replacement.afterJson)
          .replacementId
      : null,
    replacesId: source
      ? z.object({ clientUuid: z.string() }).parse(source.beforeJson).clientUuid
      : null,
    receipt: {
      shopName: catalog.settings.shopName,
      settings: catalog.settings.receiptConfig,
      queueNo: order.queueNo,
      orderNo: order.orderNo,
      channel: order.channel,
      createdAt: order.createdAt.toISOString(),
      copy: true,
      voided: order.status === "VOIDED",
      lines: order.lines.map((l) => ({
        name: l.menuName,
        qty: l.qty,
        note: l.note,
        total: l.lineTotal,
        options: z
          .array(z.object({ name: z.string() }))
          .parse(l.optionsJson)
          .map((o) => o.name),
      })),
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      total: order.total,
      tendered: payment?.tendered ?? order.total,
      change: payment?.change ?? 0,
      method: payment?.method ?? "CASH",
    },
  };
}
