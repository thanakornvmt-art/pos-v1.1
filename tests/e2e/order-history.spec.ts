import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bootstrapSchema, type OrderInput } from "../../src/domain/schema";
import { orderDetailSchema } from "../../src/domain/order-history";
import { assertTestTarget } from "../assert-test-target";
const db = new PrismaClient();
test.use({ serviceWorkers: "block" });
test.beforeAll(() => assertTestTarget());
test.afterAll(() => db.$disconnect());
async function login(page: Page, user = "owner", pin = "1234") {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption(user);
  for (const n of pin)
    await page.getByRole("button", { name: n, exact: true }).click();
  await page
    .getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "บิลปัจจุบัน" }),
  ).toBeVisible();
}
async function sale(page: Page, origin: string) {
  const r = await page.request.post("/api/bootstrap", {
    headers: { Origin: origin },
    data: { deviceId: randomUUID() },
  });
  const boot = bootstrapSchema.parse(await r.json());
  const order: OrderInput = {
    clientUuid: randomUUID(),
    deviceId: boot.device.id,
    localSequence: 1,
    orderNo: `${boot.device.prefix}-000001`,
    queueNo: `${boot.device.prefix.slice(0, 4)}-1`,
    catalogId: boot.catalogId,
    createdBy: boot.user.id,
    createdAt: new Date().toISOString(),
    channel: "TAKEAWAY",
    lines: [
      { id: randomUUID(), menuItemId: "P01", qty: 1, optionIds: [], note: "" },
    ],
    discount: null,
    total: 4500,
    payment: { method: "CASH", tendered: 5000, refNo: "", verified: true },
  };
  const posted = await page.request.post("/api/sync/orders", {
    headers: { Origin: origin },
    data: { order, permit: boot.permit },
  });
  expect(posted.ok()).toBe(true);
  const detail = orderDetailSchema.parse(
    await (await page.request.get(`/api/orders/${order.clientUuid}`)).json(),
  );
  return { order, detail, permit: boot.permit };
}
test("paid correction is atomic, owner-only, repeat-safe and reverses stock once", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  await login(page);
  const before = await db.ingredient.findUniqueOrThrow({
    where: { id: "pork" },
  });
  const { order, detail, permit } = await sale(page, baseURL!);
  const input = {
    requestId: randomUUID(),
    expectedHash: detail.payloadHash,
    lines: detail.editLines.map((l) => ({ ...l, qty: 2 })),
    channel: detail.channel,
    discount: 0,
    total: 9000,
    reason: "แก้จำนวนตามลูกค้า",
    settled: true,
    settlementRef: "",
  };
  expect(
    (
      await request.post(`/api/orders/${order.clientUuid}/amend`, {
        headers: { Origin: baseURL! },
        data: input,
      })
    ).status(),
  ).toBe(403);
  const other = await browser.newContext();
  const cashier = await other.newPage();
  await login(cashier, "cashier", "2345");
  expect(
    (
      await cashier.request.post(`/api/orders/${order.clientUuid}/amend`, {
        headers: { Origin: baseURL! },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (await cashier.request.get(`/api/orders/${order.clientUuid}`)).ok(),
  ).toBe(true);
  await other.close();
  expect(
    (
      await page.request.post(`/api/orders/${order.clientUuid}/amend`, {
        headers: { Origin: baseURL! },
        data: { ...input, total: 1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await db.order.findUniqueOrThrow({
        where: { clientUuid: order.clientUuid },
      })
    ).status,
  ).toBe("PAID");
  const responses = await Promise.all(
    [1, 2].map(() =>
      page.request.post(`/api/orders/${order.clientUuid}/amend`, {
        headers: { Origin: baseURL! },
        data: input,
      }),
    ),
  );
  for (const r of responses) {
    expect(await r.text()).not.toContain("error");
  }
  expect(await db.order.count({ where: { clientUuid: input.requestId } })).toBe(
    1,
  );
  expect(
    await db.auditLog.count({
      where: { action: "AMEND_ORDER", clientUuid: input.requestId },
    }),
  ).toBe(1);
  expect(
    (
      await db.order.findUniqueOrThrow({
        where: { clientUuid: order.clientUuid },
      })
    ).status,
  ).toBe("VOIDED");
  expect(
    before.currentQty
      .minus(
        (await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } }))
          .currentQty,
      )
      .toString(),
  ).toBe("120");
  const replay = await page.request.post("/api/sync/orders", {
    headers: { Origin: baseURL! },
    data: { order, permit },
  });
  expect((await replay.json()).status).toBe("VOIDED");
  expect(
    (
      await page.request.post(`/api/orders/${order.clientUuid}/amend`, {
        headers: { Origin: baseURL! },
        data: { ...input, requestId: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  const updated = orderDetailSchema.parse(
    await (await page.request.get(`/api/orders/${input.requestId}`)).json(),
  );
  expect(updated.total).toBe(9000);
  expect(updated.replacesId).toBe(order.clientUuid);
  expect(updated.receipt.copy).toBe(true);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await page.request.post(`/api/orders/${input.requestId}`, {
          headers: { Origin: baseURL! },
          data: { reason: "ทดสอบคืนสต็อก", confirmed: true },
        })
      ).ok(),
    ).toBe(true);
  expect(
    (
      await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
    ).currentQty.toString(),
  ).toBe(before.currentQty.toString());
});
test("POS history opens a paid receipt, reprints without sale, and owner edits refund in UI", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    (window as any).printed = 0;
    window.print = () => {
      (window as any).printed++;
    };
    Object.defineProperty(navigator, "bluetooth", {
      value: undefined,
      configurable: true,
    });
  });
  await login(page);
  const { order } = await sale(page, baseURL!);
  await page
    .getByRole("link", { name: "ดูบิลเก่า / พิมพ์ซ้ำ", exact: true })
    .click();
  await page.getByLabel("เลขบิล / เลขคิว").fill(order.orderNo);
  await page.getByRole("button", { name: "ค้นหาบิล", exact: true }).click();
  await page.getByRole("link").filter({ hasText: order.orderNo }).click();
  await expect(page.getByTestId("receipt-preview")).toContainText(
    "สำเนา / พิมพ์ซ้ำ",
  );
  const count = await db.order.count();
  await page
    .getByRole("button", { name: "พิมพ์ใบเสร็จซ้ำ", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => (window as any).printed)).toBe(1);
  expect(await db.order.count()).toBe(count);
  await page
    .getByRole("button", { name: "แก้ไขบิลที่ชำระแล้ว", exact: true })
    .click();
  await page.getByLabel("ส่วนลด (บาท)").fill("5");
  await page.getByLabel("เหตุผลที่แก้บิล").fill("แก้ส่วนลดให้ลูกค้า");
  await expect(page.getByText("ต้องคืนเงิน ฿5", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "บันทึกบิลฉบับแก้ไข" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "ยืนยันว่าคืนเงินส่วนต่างแล้ว" })
    .click();
  await page.getByRole("button", { name: "บันทึกบิลฉบับแก้ไข" }).click();
  await expect(
    page.getByRole("link", { name: "ดูบิลเดิมก่อนแก้ไข" }),
  ).toBeVisible();
  await expect(page.getByTestId("receipt-preview")).toContainText("รวม ฿40");
  const newId = page.url().split("/").at(-1)!;
  await page.request.post(`/api/orders/${newId}`, {
    headers: { Origin: baseURL! },
    data: { reason: "จบการทดสอบ", confirmed: true },
  });
});
