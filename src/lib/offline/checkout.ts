import { localDb, type Receipt } from "./db";
import {
  orderInputSchema,
  type Bootstrap,
  type CartLine,
  type Channel,
  type Discount,
  type OrderInput,
} from "@/domain/schema";
import { priceOrder } from "@/domain/pricing";
export async function checkout(
  boot: Bootstrap,
  draftId: string,
  lines: CartLine[],
  channel: Channel,
  discount: Discount | null,
  payment: OrderInput["payment"],
  clientUuid: string,
) {
  if (Date.now() >= boot.expiresAt)
    throw new Error("สิทธิ์ออฟไลน์หมดอายุ กรุณาเชื่อมต่อและเข้าสู่ระบบใหม่");
  const priced = priceOrder(boot.catalog, channel, lines, discount);
  if (payment.tendered < priced.total || !payment.verified)
    throw new Error("ยังไม่ได้รับชำระครบ");
  return localDb.transaction(
    "rw",
    localDb.orders,
    localDb.meta,
    localDb.printJobs,
    localDb.drafts,
    async () => {
      const existing = await localDb.orders.get(clientUuid);
      if (existing) return existing;
      const current = await localDb.drafts.get(draftId);
      if (!current || !current.lines.length)
        throw new Error("บิลนี้ชำระแล้วหรือไม่มีรายการ");
      if (current.bootstrap && current.bootstrap.catalogId !== boot.catalogId)
        throw new Error("ชุดราคาไม่ตรงกับบิลที่พักไว้ กรุณาเปิดบิลใหม่");
      if (JSON.stringify(current.lines) !== JSON.stringify(lines))
        throw new Error("บิลเปลี่ยนในอีกหน้าจอ กรุณาเปิดใหม่");
      const seq =
        Number((await localDb.meta.get("sequence"))?.value ?? "0") + 1;
      const orderNo = `${boot.device.prefix}-${String(seq).padStart(6, "0")}`;
      const queueNo = `${boot.device.prefix.slice(0, 4)}-${seq}`;
      const order = orderInputSchema.parse({
        clientUuid,
        deviceId: boot.device.id,
        localSequence: seq,
        orderNo,
        queueNo,
        catalogId: boot.catalogId,
        createdBy: boot.user.id,
        createdAt: new Date().toISOString(),
        channel,
        lines,
        discount,
        total: priced.total,
        payment,
        deliveryId: current.deliveryId,
      });
      const receipt: Receipt = {
        shopName: boot.catalog.settings.shopName,
        queueNo,
        orderNo,
        channel,
        createdAt: order.createdAt,
        lines: priced.lines.map((l) => ({
          name: l.menu.name,
          qty: l.qty,
          options: l.options.map((o) => o.name),
          note: l.note,
          total: l.lineTotal,
        })),
        subtotal: priced.subtotal,
        discount: priced.discount,
        tax: priced.tax,
        total: priced.total,
        tendered: payment.tendered,
        change: payment.tendered - priced.total,
        method: payment.method,
      };
      const saved = {
        id: clientUuid,
        order,
        permit: boot.permit,
        state: "pending" as const,
        error: "",
        receipt,
      };
      await localDb.orders.add(saved);
      await localDb.meta.put({ key: "sequence", value: String(seq) });
      await localDb.printJobs.bulkAdd(
        ["KITCHEN", "CUSTOMER"].map((kind) => ({
          id: `${clientUuid}:${kind}`,
          orderId: clientUuid,
          kind: kind as "KITCHEN" | "CUSTOMER",
          state: "waiting-sync" as const,
          receipt,
        })),
      );
      await localDb.drafts.update(draftId, {
        lines: [],
        deliveryId: undefined,
      });
      return saved;
    },
  );
}
