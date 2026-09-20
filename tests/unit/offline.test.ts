import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { localDb } from "../../src/lib/offline/db";
import { checkout } from "../../src/lib/offline/checkout";
import { syncPending } from "../../src/lib/offline/sync";
import { boot, line } from "../fixtures";
beforeEach(async () => {
  await Promise.all([
    localDb.orders.clear(),
    localDb.printJobs.clear(),
    localDb.drafts.clear(),
    localDb.meta.clear(),
    localDb.audits.clear(),
  ]);
  vi.restoreAllMocks();
});
async function draft() {
  const id = crypto.randomUUID();
  await localDb.drafts.add({
    id,
    name: "ทดสอบ",
    channel: "TAKEAWAY",
    lines: [line],
    userId: boot.user.id,
  });
  return id;
}
const payment = {
  method: "CASH" as const,
  tendered: 5000,
  refNo: "",
  verified: true,
};
describe("Offline-first", () => {
  it("เก็บบิลและงานพิมพ์สองชุดแบบ atomic พร้อม sequence ไม่ซ้ำ", async () => {
    const a = await draft(),
      b = await draft();
    const saved = await Promise.all([
      checkout(boot, a, [line], "TAKEAWAY", null, payment, crypto.randomUUID()),
      checkout(boot, b, [line], "TAKEAWAY", null, payment, crypto.randomUUID()),
    ]);
    expect(new Set(saved.map((o) => o.order.orderNo)).size).toBe(2);
    expect(await localDb.printJobs.count()).toBe(4);
    expect((await localDb.drafts.get(a))?.lines).toEqual([]);
  });
  it("double tap UUID เดิมไม่สร้างบิลซ้ำ", async () => {
    const id = await draft(),
      uuid = crypto.randomUUID();
    await checkout(boot, id, [line], "TAKEAWAY", null, payment, uuid);
    await checkout(boot, id, [line], "TAKEAWAY", null, payment, uuid);
    expect(await localDb.orders.count()).toBe(1);
    expect(await localDb.printJobs.count()).toBe(2);
  });
  it("สิทธิ์หมดอายุและข้อมูลตะกร้าเปลี่ยนต้องไม่รับเงินซ้ำ", async () => {
    const id = await draft();
    await expect(
      checkout(
        { ...boot, expiresAt: 0 },
        id,
        [line],
        "TAKEAWAY",
        null,
        payment,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      checkout(
        boot,
        id,
        [{ ...line, qty: 2 }],
        "TAKEAWAY",
        null,
        { ...payment, tendered: 10000 },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    expect(await localDb.orders.count()).toBe(0);
  });
  it("เน็ตขาดไม่ทิ้งบิล กลับมาแล้ว replay พร้อมปล่อยงานพิมพ์", async () => {
    const id = await draft(),
      uuid = crypto.randomUUID();
    await checkout(boot, id, [line], "TAKEAWAY", null, payment, uuid);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await syncPending();
    expect((await localDb.orders.get(uuid))?.state).toBe("pending");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: "server", clientUuid: uuid, status: "PAID" }),
        ),
    );
    await syncPending();
    expect((await localDb.orders.get(uuid))?.state).toBe("synced");
    expect(await localDb.printJobs.where("state").equals("ready").count()).toBe(
      2,
    );
  });
});
