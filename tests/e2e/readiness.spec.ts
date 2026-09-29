import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bootstrapSchema, type OrderInput } from "../../src/domain/schema";
import { assertTestTarget } from "../assert-test-target";
const db = new PrismaClient();
test.beforeAll(assertTestTarget);
test.afterAll(async () => db.$disconnect());
async function login(page: Page, user = "owner", pin = "1234") {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption(user);
  for (const digit of pin)
    await page.getByRole("button", { name: digit, exact: true }).click();
  const bootResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/bootstrap") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true })
    .click();
  const boot = await bootResponse;
  expect(boot.ok(), boot.ok() ? "bootstrap succeeded" : await boot.text()).toBe(
    true,
  );
  await expect(
    page.getByRole("heading", { name: "บิลปัจจุบัน" }),
  ).toBeVisible();
}
test("offline-paid shortages remain recorded once and recover after two voids", async ({
  page,
  request,
  baseURL,
}) => {
  await login(page);
  const origin = { Origin: baseURL! };
  const response = await page.request.post("/api/bootstrap", {
    headers: origin,
    data: { deviceId: randomUUID() },
  });
  expect(response.ok()).toBe(true);
  const boot = bootstrapSchema.parse(await response.json());
  const pork = await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } });
  await db.ingredient.update({
    where: { id: "pork" },
    data: { currentQty: 0 },
  });
  const orders: OrderInput[] = [1, 2].map((sequence) => ({
    clientUuid: randomUUID(),
    deviceId: boot.device.id,
    localSequence: sequence,
    orderNo: `${boot.device.prefix}-${String(sequence).padStart(6, "0")}`,
    queueNo: `${boot.device.prefix.slice(0, 4)}-${sequence}`,
    catalogId: boot.catalogId,
    createdBy: "owner",
    createdAt: new Date().toISOString(),
    channel: "TAKEAWAY",
    lines: [
      { id: randomUUID(), menuItemId: "P01", qty: 1, optionIds: [], note: "" },
    ],
    discount: null,
    total: 4500,
    payment: { method: "CASH", tendered: 4500, refNo: "", verified: true },
  }));
  try {
    const send = (order: OrderInput) =>
      request.post("/api/sync/orders", {
        headers: origin,
        data: { order, permit: boot.permit },
      });
    const responses = await Promise.all([
      send(orders[0]),
      send(orders[1]),
      send(orders[0]),
    ]);
    for (const result of responses)
      expect(result.ok(), await result.text()).toBe(true);
    expect(
      (
        await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
      ).currentQty.toString(),
    ).toBe("-120");
    const saved = await db.order.findMany({
      where: { clientUuid: { in: orders.map((order) => order.clientUuid) } },
    });
    expect(saved).toHaveLength(2);
    expect(
      await db.auditLog.count({
        where: {
          action: "STOCK_SHORTAGE",
          entityId: { in: saved.map((row) => row.id) },
        },
      }),
    ).toBe(2);
    const shortages = await page.request.get("/api/stock/shortages");
    expect(shortages.ok()).toBe(true);
    expect(
      (await shortages.json()).find((row: { id: string }) => row.id === "pork")
        .currentQty,
    ).toBe("-120");
    await expect(
      page.getByRole("alert").filter({ hasText: "สต็อกติดลบ" }),
    ).toBeVisible({ timeout: 35000 });
    const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const audit = await page.request.get(
      `/api/audit?from=${day}&to=${day}&action=STOCK_SHORTAGE&entityId=${saved[0].id}`,
    );
    expect(audit.ok()).toBe(true);
    expect((await audit.json()).rows).toHaveLength(1);
    for (const order of orders) {
      const results = await Promise.all(
        [1, 2].map(() =>
          page.request.post(`/api/orders/${order.clientUuid}`, {
            headers: origin,
            data: { reason: "คืนบิลทดสอบสต็อกขาด", confirmed: true },
          }),
        ),
      );
      for (const result of results) expect(result.ok()).toBe(true);
    }
    expect(
      (
        await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
      ).currentQty.toString(),
    ).toBe("0");
  } finally {
    await db.ingredient.update({
      where: { id: "pork" },
      data: { currentQty: pork.currentQty },
    });
  }
});
test("audit and shortage endpoints reject anonymous and cashier access", async ({
  page,
  request,
}) => {
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  for (const path of [
    `/api/audit?from=${day}&to=${day}`,
    "/api/stock/shortages",
  ])
    expect((await request.get(path)).status()).toBe(403);
  await login(page, "cashier", "2345");
  for (const path of [
    `/api/audit?from=${day}&to=${day}`,
    "/api/stock/shortages",
  ])
    expect((await page.request.get(path)).status()).toBe(403);
  await page.goto("/audit");
  await expect(
    page.getByRole("alert").filter({ hasText: "ไม่มีสิทธิ์" }),
  ).toBeVisible();
});

test("owner audit timeline paginates without duplicates and redacts credentials", async ({
  page,
}) => {
  await login(page);
  const entityId = randomUUID();
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const createdAt = new Date();
  await db.auditLog.createMany({
    data: Array.from({ length: 52 }, () => ({
      id: randomUUID(),
      userId: "owner",
      action: "READINESS_CHECK",
      entity: "Test",
      entityId,
      beforeJson: {},
      afterJson: {
        pinHash: "audit-private-test-value",
        note: "ตรวจความครบถ้วน",
      },
      createdAt,
    })),
  });
  try {
    const path = `/api/audit?from=${day}&to=${day}&entityId=${entityId}`;
    const first = await (await page.request.get(path)).json();
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await (
      await page.request.get(path + `&cursor=${first.nextCursor}`)
    ).json();
    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.rows, ...second.rows].map((row) => row.id)).size,
    ).toBe(52);
    expect(JSON.stringify(first)).not.toContain("audit-private-test-value");
    await page.goto("/audit");
    await page.getByLabel("รหัสข้อมูล", { exact: true }).fill(entityId);
    await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(50);
    await page.locator("article summary").first().click();
    await expect(page.locator("article pre").first()).toContainText("[ปกปิด]");
    await page.screenshot({
      path: "artifacts/audit-readiness.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
  } finally {
    await db.auditLog.deleteMany({ where: { entityId } });
  }
});
