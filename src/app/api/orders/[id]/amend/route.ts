import { createHash } from "node:crypto";
import { z } from "zod";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { amendmentSchema } from "@/domain/order-history";
import { catalogSchema, orderInputSchema } from "@/domain/schema";
import { priceOrder } from "@/domain/pricing";
import { serializable } from "@/lib/transaction";
import { voidOrder } from "@/lib/void-order";
import { persistOrder } from "@/lib/order-service";
import { canonical } from "@/lib/canonical";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    sameOrigin(req);
    actor = await authorized(true);
  } catch (e) {
    return fail(e, 403);
  }
  try {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const v = amendmentSchema.parse(await body(req));
    const requestHash = createHash("sha256")
      .update(canonical({ id, ...v }))
      .digest("hex");
    const saved = await serializable(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (
        !user.active ||
        user.role !== "OWNER" ||
        user.authVersion !== actor.authVersion
      )
        throw new Error("สิทธิ์เปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่");
      const previous = await tx.auditLog.findUnique({
        where: { clientUuid: v.requestId },
      });
      if (previous) {
        const data = z
          .object({ requestHash: z.string(), replacementId: z.string() })
          .parse(previous.afterJson);
        if (
          previous.action !== "AMEND_ORDER" ||
          previous.userId !== user.id ||
          data.requestHash !== requestHash
        )
          throw new Error("คำขอซ้ำมีข้อมูลไม่ตรงกัน");
        return { clientUuid: data.replacementId };
      }
      const old = await tx.order.findUniqueOrThrow({
        where: { clientUuid: id },
        include: { payments: true, catalog: true, lines: true },
      });
      if (old.status !== "PAID" || old.payloadHash !== v.expectedHash)
        throw new Error("บิลถูกแก้หรือยกเลิกแล้ว กรุณาเปิดบิลล่าสุด");
      if (old.payments.length !== 1 || old.payments[0].reversedAt)
        throw new Error("รูปแบบการชำระของบิลนี้ไม่รองรับการแก้ไข");
      const payment = old.payments[0];
      const discount = v.discount
        ? { kind: "BAHT" as const, value: v.discount, reason: v.reason }
        : null;
      const priced = priceOrder(
        catalogSchema.parse(old.catalog.data),
        v.channel,
        v.lines,
        discount,
      );
      if (priced.total !== v.total)
        throw new Error("ยอดไม่ตรง กรุณาตรวจบิลใหม่");
      const difference = priced.total - old.total;
      if (payment.method !== "CASH" && difference !== 0 && !v.settlementRef)
        throw new Error("ระบุเลขอ้างอิงรับเพิ่มหรือคืนเงิน");
      // A replacement and reversal commit together. Retain the original immutable bill and its sync hash.
      await voidOrder(tx, id, user.id, `แก้ไขบิล: ${v.reason}`);
      const device = await tx.device.create({
        data: {
          id: v.requestId,
          prefix: `REV${v.requestId.replaceAll("-", "").toUpperCase()}`,
        },
      });
      const input = orderInputSchema.parse({
        clientUuid: v.requestId,
        deviceId: device.id,
        localSequence: 1,
        orderNo: `${device.prefix}-000001`,
        queueNo: old.queueNo,
        catalogId: old.catalogId,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
        channel: v.channel,
        lines: v.lines,
        discount,
        total: priced.total,
        payment: {
          method: payment.method,
          tendered: priced.total,
          verified: true,
          refNo: v.settlementRef || payment.refNo || "",
        },
      });
      const next = await persistOrder(
        tx,
        input,
        createHash("sha256").update(JSON.stringify(input)).digest("hex"),
        {
          sub: user.id,
          deviceId: device.id,
          catalogId: old.catalogId,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
      );
      await tx.order.update({
        where: { id: next.id },
        data: { fulfillmentStage: old.fulfillmentStage },
      });
      await tx.deliveryTicket.updateMany({
        where: { paidOrderUuid: id },
        data: {
          paidOrderUuid: next.clientUuid,
          channel: v.channel,
          total: next.total,
          netPayout: next.netPayout,
          lines: v.lines,
        },
      });
      await tx.auditLog.create({
        data: {
          clientUuid: v.requestId,
          userId: user.id,
          action: "AMEND_ORDER",
          entity: "Order",
          entityId: old.id,
          beforeJson: {
            clientUuid: id,
            orderNo: old.orderNo,
            total: old.total,
            lines: JSON.parse(JSON.stringify(old.lines)),
          },
          afterJson: {
            replacementId: next.clientUuid,
            orderNo: next.orderNo,
            total: next.total,
            difference,
            method: payment.method,
            settlementRef: v.settlementRef,
            reason: v.reason,
            requestHash,
          },
        },
      });
      return { clientUuid: next.clientUuid };
    });
    return Response.json(saved);
  } catch (e) {
    return fail(e, 409);
  }
}
