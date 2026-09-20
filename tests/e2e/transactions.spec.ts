import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { bootstrapSchema, type OrderInput } from "../../src/domain/schema";
import { randomUUID } from "node:crypto";
const db = new PrismaClient();
test.beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes("/morning_pos_test"))
    throw new Error(
      "Transaction tests require the isolated morning_pos_test database",
    );
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("PromptPay แสดงยอดจริง และไม่ถือว่าชำระอัตโนมัติ", async ({ page }) => {
  const original = await db.settings.findUniqueOrThrow({
    where: { id: "store" },
  });
  await db.settings.update({
    where: { id: "store" },
    data: { promptpayId: "0812345678", qrExpirySeconds: 30 },
  });
  try {
    await login(page);
    await page
      .getByRole("button", { name: /โจ๊กหมู ฿45/ })
      .first()
      .click();
    await page.getByTestId("checkout").click();
    await page
      .getByRole("button", { name: "PromptPay QR", exact: true })
      .click();
    await expect(page.getByTestId("confirm-payment")).toBeDisabled();
    await page.getByRole("button", { name: /แสดง QR เต็มจอ/ }).click();
    await expect(
      page.getByRole("img", { name: /PromptPay ยอด/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "สแกนจ่าย PromptPay" }),
    ).toContainText("45");
    await page.screenshot({
      path: "artifacts/promptpay-tablet.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "กลับไปตรวจยอดเข้า", exact: true })
      .click();
    await expect(page.getByTestId("confirm-payment")).toBeDisabled();
  } finally {
    await db.settings.update({
      where: { id: "store" },
      data: {
        promptpayId: original.promptpayId,
        qrExpirySeconds: original.qrExpirySeconds,
      },
    });
  }
});
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption("owner");
  for (const n of "1234")
    await page.getByRole("button", { name: n, exact: true }).click();
  await page
    .getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "บิลปัจจุบัน" }),
  ).toBeVisible();
}
test("PostgreSQL: concurrent sync exactly once, actual cost, audit, reversal exactly once", async ({
  page,
  request,
  baseURL,
}) => {
  await login(page);
  const deviceId = randomUUID();
  const b = await page.request.post("/api/bootstrap", {
    headers: { Origin: baseURL! },
    data: { deviceId },
  });
  expect(b.ok()).toBe(true);
  const boot = bootstrapSchema.parse(await b.json());
  const pork = await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } });
  const order: OrderInput = {
    clientUuid: randomUUID(),
    deviceId,
    localSequence: 1,
    orderNo: boot.device.prefix + "-000001",
    queueNo: boot.device.prefix.slice(0, 4) + "-1",
    catalogId: boot.catalogId,
    createdBy: "owner",
    createdAt: new Date().toISOString(),
    channel: "TAKEAWAY",
    lines: [
      { id: randomUUID(), menuItemId: "P01", qty: 1, optionIds: [], note: "" },
    ],
    discount: null,
    total: 4500,
    payment: { method: "CASH", tendered: 5000, refNo: "", verified: true },
  };
  const responses = await Promise.all([
    request.post("/api/sync/orders", {
      headers: { Origin: baseURL! },
      data: { order, permit: boot.permit },
    }),
    request.post("/api/sync/orders", {
      headers: { Origin: baseURL! },
      data: { order, permit: boot.permit },
    }),
  ]);
  for (const response of responses)
    expect(await response.text()).not.toContain("error");
  expect(
    await db.order.count({ where: { clientUuid: order.clientUuid } }),
  ).toBe(1);
  const after = await db.ingredient.findUniqueOrThrow({
    where: { id: "pork" },
  });
  expect(pork.currentQty.minus(after.currentQty).toString()).toBe("60");
  expect(
    await db.stockMovement.count({
      where: { refId: order.clientUuid, ingredientId: "pork", type: "SALE" },
    }),
  ).toBe(1);
  const saved = await db.order.findUniqueOrThrow({
    where: { clientUuid: order.clientUuid },
    include: { lines: true },
  });
  expect(saved.ingredientCost).toBeGreaterThan(0);
  expect(saved.lines.reduce((n, l) => n + l.ingredientCost, 0)).toBe(
    saved.ingredientCost,
  );
  expect(saved.packagingCost).toBe(400);
  const tampered = await request.post("/api/sync/orders", {
    headers: { Origin: baseURL! },
    data: { order: { ...order, total: 1 }, permit: boot.permit },
  });
  expect(tampered.status()).toBe(409);
  const voids = await Promise.all([
    page.request.post(`/api/orders/${order.clientUuid}`, {
      headers: { Origin: baseURL! },
      data: { reason: "ทดสอบยกเลิก", confirmed: true },
    }),
    page.request.post(`/api/orders/${order.clientUuid}`, {
      headers: { Origin: baseURL! },
      data: { reason: "ทดสอบยกเลิก", confirmed: true },
    }),
  ]);
  for (const response of voids) expect(response.ok()).toBe(true);
  expect(
    (
      await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
    ).currentQty.toString(),
  ).toBe(pork.currentQty.toString());
  expect(
    await db.stockMovement.count({
      where: {
        refId: order.clientUuid,
        ingredientId: "pork",
        type: "REVERSAL",
      },
    }),
  ).toBe(1);
});
test("รับเข้าคำนวณ WAC, replay ไม่เพิ่มซ้ำ, reject stale count, cycle rejection", async ({
  page,
  baseURL,
}) => {
  await login(page);
  const origin = { Origin: baseURL! };
  const supplierId = randomUUID(),
    ingredientId = randomUUID();
  expect(
    (
      await page.request.post("/api/manage", {
        headers: origin,
        data: {
          kind: "supplier",
          data: {
            id: supplierId,
            name: "ทดสอบ supplier",
            phone: "",
            lineId: "",
          },
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/manage", {
        headers: origin,
        data: {
          kind: "ingredient",
          data: {
            id: ingredientId,
            name: "ทดสอบ WAC",
            purchaseUnit: "กก.",
            usageUnit: "กรัม",
            conversionRate: "1000",
            yieldPercent: "80",
            parLevel: "2000",
            reorderPoint: "500",
            isPerishable: true,
            shelfLifeDays: 3,
            supplierId,
          },
        },
      })
    ).ok(),
  ).toBe(true);
  const receipt = {
    kind: "receive",
    id: randomUUID(),
    supplierId,
    lines: [
      {
        ingredientId,
        purchaseQty: "2",
        unitPrice: 12000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  };
  for (let i = 0; i < 2; i++)
    expect(
      (
        await page.request.post("/api/stock", {
          headers: origin,
          data: receipt,
        })
      ).ok(),
    ).toBe(true);
  const ingredient = await db.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
  });
  expect(ingredient.currentQty.toString()).toBe("1600");
  expect(ingredient.avgCost.toString()).toBe("15");
  const waste = await page.request.post("/api/stock", {
    headers: origin,
    data: {
      kind: "waste",
      id: randomUUID(),
      ingredientId,
      qty: "100",
      reason: "ของตกพื้น",
      confirmed: true,
    },
  });
  expect(waste.ok()).toBe(true);
  const stale = await page.request.post("/api/stock", {
    headers: origin,
    data: {
      kind: "count",
      id: randomUUID(),
      confirmed: true,
      lines: [{ ingredientId, systemQty: "1600", actualQty: "1500" }],
    },
  });
  expect(stale.status()).toBe(409);
  const cycleId = randomUUID();
  const cycle = await page.request.post("/api/manage", {
    headers: origin,
    data: {
      kind: "recipe",
      data: {
        id: cycleId,
        name: "สูตรวน",
        outputQty: "1",
        outputUnit: "ถ้วย",
        lines: [{ ingredientId: null, subRecipeId: cycleId, qty: "1" }],
      },
    },
  });
  expect(cycle.status()).toBe(400);
  expect(await db.subRecipe.count({ where: { id: cycleId } })).toBe(0);
});
test("ออเดอร์แพลตฟอร์มไม่ตัดสต็อกก่อนรับเงินและรับชำระได้ครั้งเดียว", async ({
  page,
  baseURL,
  request,
}) => {
  await login(page);
  const origin = { Origin: baseURL! };
  const boot = bootstrapSchema.parse(
    await (
      await page.request.post("/api/bootstrap", {
        headers: origin,
        data: { deviceId: randomUUID() },
      })
    ).json(),
  );
  const before = await db.ingredient.findUniqueOrThrow({
    where: { id: "pork" },
  });
  const id = randomUUID();
  const lines = [
    { id: randomUUID(), menuItemId: "P01", qty: 1, optionIds: [], note: "" },
  ];
  const ticket = await page.request.post("/api/delivery", {
    headers: origin,
    data: {
      kind: "create",
      id,
      channel: "GRAB",
      externalRef: "TEST-" + id,
      lines,
      catalogId: boot.catalogId,
    },
  });
  expect(ticket.ok()).toBe(true);
  expect(
    (
      await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
    ).currentQty.toString(),
  ).toBe(before.currentQty.toString());
  const order: OrderInput = {
    clientUuid: randomUUID(),
    deviceId: boot.device.id,
    localSequence: 1,
    orderNo: boot.device.prefix + "-000001",
    queueNo: boot.device.prefix.slice(0, 4) + "-1",
    catalogId: boot.catalogId,
    createdBy: "owner",
    createdAt: new Date().toISOString(),
    channel: "GRAB",
    lines,
    discount: null,
    total: 6500,
    payment: {
      method: "COD",
      tendered: 6500,
      refNo: "TEST-COD",
      verified: true,
    },
    deliveryId: id,
  };
  const paid = await request.post("/api/sync/orders", {
    headers: origin,
    data: { order, permit: boot.permit },
  });
  expect(await paid.text()).not.toContain("error");
  expect(
    (await db.deliveryTicket.findUniqueOrThrow({ where: { id } }))
      .paidOrderUuid,
  ).toBe(order.clientUuid);
});
