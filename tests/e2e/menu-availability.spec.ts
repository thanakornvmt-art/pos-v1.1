import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  bootstrapSchema,
  type Bootstrap,
  type OrderInput,
} from "../../src/domain/schema";
import { priceOrder } from "../../src/domain/pricing";
import type { LocalOrder } from "../../src/lib/offline/db";

const db = new PrismaClient();
test.describe.configure({ timeout: 90000 });
test.beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  const app = new URL(process.env.TEST_BASE_URL ?? "http://invalid");
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/morning_pos_test" ||
    app.hostname !== "localhost" ||
    app.port !== "3001"
  ) {
    throw new Error(
      "Menu regression tests require local morning_pos_test and localhost:3001",
    );
  }
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, user = "owner", pin = "1234") {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption(user);
  for (const digit of pin)
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page
    .getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login$/);
  if (user !== "kitchen")
    await expect(
      page.getByRole("heading", { name: "บิลปัจจุบัน" }),
    ).toBeVisible();
}
async function active(page: Page, value: boolean, id = "P01") {
  const response = await page.request.post("/api/manage", {
    headers: { Origin: new URL(page.url()).origin },
    data: { kind: "menuActive", id, isActive: value, confirmed: true },
  });
  expect(await response.text()).toBe('{"ok":true}');
}
async function bootstrap(page: Page) {
  const response = await page.request.post("/api/bootstrap", {
    headers: { Origin: new URL(page.url()).origin },
    data: { deviceId: randomUUID() },
  });
  expect(response.ok()).toBe(true);
  return bootstrapSchema.parse(await response.json());
}
function order(boot: Bootstrap, sequence = 1): OrderInput {
  const lines = [
    {
      id: randomUUID(),
      menuItemId: "P01",
      qty: 1,
      optionIds: [],
      note: "ทดสอบสถานะเมนู",
    },
  ];
  const total = priceOrder(boot.catalog, "TAKEAWAY", lines).total;
  return {
    clientUuid: randomUUID(),
    deviceId: boot.device.id,
    localSequence: sequence,
    orderNo: `${boot.device.prefix}-${String(sequence).padStart(6, "0")}`,
    queueNo: `${boot.device.prefix.slice(0, 4)}-${sequence}`,
    catalogId: boot.catalogId,
    createdBy: boot.user.id,
    createdAt: new Date().toISOString(),
    channel: "TAKEAWAY",
    lines,
    discount: null,
    total,
    payment: { method: "CASH", tendered: total, refNo: "", verified: true },
  };
}
async function sync(page: Page, value: OrderInput, permit: string) {
  const response = await page.request.post("/api/sync/orders", {
    headers: { Origin: new URL(page.url()).origin },
    data: { order: value, permit },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function localOrders(page: Page): Promise<LocalOrder[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("morning-pos-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const connection = request.result;
          const read = connection
            .transaction("orders")
            .objectStore("orders")
            .getAll();
          read.onsuccess = () => {
            resolve(read.result);
            connection.close();
          };
          read.onerror = () => {
            reject(read.error);
            connection.close();
          };
        };
      }),
  );
}
async function protectedData() {
  const [menus, images, ingredients, movements, batches, orders, recipes] =
    await Promise.all([
      db.menuItem.findMany({
        orderBy: { id: "asc" },
        include: {
          bom: { orderBy: { id: "asc" } },
          prices: { orderBy: { id: "asc" } },
          packaging: { orderBy: { id: "asc" } },
          optionGroups: {
            orderBy: { optionGroupId: "asc" },
            include: {
              optionGroup: { include: { items: { orderBy: { id: "asc" } } } },
            },
          },
        },
      }),
      db.menuImage.findMany({ orderBy: { id: "asc" } }),
      db.ingredient.findMany({ orderBy: { id: "asc" } }),
      db.stockMovement.findMany({ orderBy: { id: "asc" } }),
      db.stockBatch.findMany({ orderBy: { id: "asc" } }),
      db.order.findMany({
        orderBy: { id: "asc" },
        include: {
          lines: { orderBy: { id: "asc" } },
          payments: { orderBy: { id: "asc" } },
        },
      }),
      db.subRecipe.findMany({
        orderBy: { id: "asc" },
        include: { lines: { orderBy: { id: "asc" } } },
      }),
    ]);
  return JSON.parse(
    JSON.stringify({
      menus: menus.map(({ isActive: _active, ...menu }) => menu),
      images,
      ingredients,
      movements,
      batches,
      orders,
      recipes,
    }),
  );
}

test("browser-paid offline sale replays once after another terminal closes its menu", async ({
  page,
  context,
  browser,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: original.id },
    data: { isActive: true, soldOut: false },
  });
  const managerContext = await browser.newContext();
  try {
    await login(page);
    const manager = await managerContext.newPage();
    await login(manager);
    const before = await db.ingredient.findUniqueOrThrow({
      where: { id: "pork" },
    });
    await context.setOffline(true);
    await page.getByTestId("menu-P01").click();
    await page.getByTestId("checkout").click();
    await page.getByTestId("confirm-payment").click();
    await expect(
      page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
    ).toBeVisible();
    const pending = (await localOrders(page))[0];
    expect(pending.state).toBe("pending");
    expect(await db.order.count({ where: { clientUuid: pending.id } })).toBe(0);
    await active(manager, false);
    await context.setOffline(false);
    await expect(page.getByText("รอส่ง 0 บิล").first()).toBeVisible({
      timeout: 25000,
    });
    const saved = await db.order.findUniqueOrThrow({
      where: { clientUuid: pending.id },
      include: { lines: true },
    });
    expect(saved.total).toBe(pending.order.total);
    expect(saved.lines[0].menuName).toBe(original.name);
    const after = await db.ingredient.findUniqueOrThrow({
      where: { id: "pork" },
    });
    expect(before.currentQty.minus(after.currentQty).toString()).toBe("60");
    await sync(manager, pending.order, pending.permit);
    expect(await db.order.count({ where: { clientUuid: pending.id } })).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { refId: pending.id, ingredientId: "pork", type: "SALE" },
      }),
    ).toBe(1);
    expect(
      (
        await db.ingredient.findUniqueOrThrow({ where: { id: "pork" } })
      ).currentQty.toString(),
    ).toBe(after.currentQty.toString());
  } finally {
    await context.setOffline(false);
    await managerContext.close();
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});

test("Manage confirmation preserves related data; ingredient archive and sold-out stay independent", async ({
  page,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: "P01" },
    data: { isActive: true, soldOut: true },
  });
  try {
    await login(page);
    await page.goto("/manage");
    await page
      .getByRole("button", { name: "เมนู / เปิด–ปิดขาย", exact: true })
      .click();
    const card = page.locator("article").filter({
      has: page.getByRole("heading", { name: original.name, exact: true }),
    });
    const before = await protectedData();
    const auditCount = await db.auditLog.count({
      where: { action: "MENUACTIVE", entityId: original.id },
    });
    await card.getByRole("button", { name: "ปิดขาย", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: `ยืนยันปิดขาย ${original.name}?`,
    });
    await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    expect(
      (await db.menuItem.findUniqueOrThrow({ where: { id: original.id } }))
        .isActive,
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { action: "MENUACTIVE", entityId: original.id },
      }),
    ).toBe(auditCount);
    await card.getByRole("button", { name: "ปิดขาย", exact: true }).click();
    await dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(card.getByText("ปิดขาย", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("button", { name: "เปิดขาย", exact: true }),
    ).toBeVisible();
    expect(await protectedData()).toEqual(before);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "MENUACTIVE", entityId: original.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.beforeJson).toEqual({ id: original.id, isActive: true });
    expect(audit.afterJson).toMatchObject({ id: original.id, isActive: false });
    const closedBoot = await bootstrap(page);
    expect(
      closedBoot.catalog.menus.some((menu) => menu.id === original.id),
    ).toBe(false);
    const headers = { Origin: new URL(page.url()).origin };
    const archive = await page.request.post("/api/manage", {
      headers,
      data: { kind: "archiveIngredient", id: "pork", confirmed: true },
    });
    expect(archive.ok()).toBe(false);
    expect(await archive.text()).toContain("วัตถุดิบยังถูกใช้ในสูตร");
    const unused = await db.ingredient.create({
      data: {
        id: randomUUID(),
        name: "วัตถุดิบไม่มีสูตรสำหรับ regression",
        purchaseUnit: "ชิ้น",
        usageUnit: "ชิ้น",
        conversionRate: 1,
        yieldPercent: 100,
        avgCost: 0,
        currentQty: 0,
        parLevel: 0,
        reorderPoint: 0,
        isPerishable: false,
      },
    });
    expect(
      (
        await page.request.post("/api/manage", {
          headers,
          data: { kind: "archiveIngredient", id: unused.id, confirmed: true },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (await db.ingredient.findUniqueOrThrow({ where: { id: unused.id } }))
        .active,
    ).toBe(false);
    await card.getByRole("button", { name: "เปิดขาย", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "ยืนยัน", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "ปิดขาย", exact: true }),
    ).toBeVisible();
    const reopened = await db.menuItem.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(reopened.isActive).toBe(true);
    expect(reopened.soldOut).toBe(true);
    await page.screenshot({
      path: "artifacts/menu-availability-manage.png",
      fullPage: true,
    });
  } finally {
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});

test("an ingredient referenced only by a closed menu still cannot be archived", async ({
  page,
}) => {
  const ingredient = await db.ingredient.create({
    data: {
      name: "วัตถุดิบใช้เฉพาะเมนูปิด",
      purchaseUnit: "ชิ้น",
      usageUnit: "ชิ้น",
      conversionRate: 1,
      yieldPercent: 100,
      avgCost: 0,
      currentQty: 0,
      parLevel: 0,
      reorderPoint: 0,
      isPerishable: false,
    },
  });
  const template = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  const menu = await db.menuItem.create({
    data: {
      sku: `ZZ_TEST_${randomUUID()}`,
      name: "เมนูทดสอบอ้างอิงวัตถุดิบ",
      categoryId: template.categoryId,
      imageUrl: "",
      prepSeconds: 0,
      prices: { create: { channel: "TAKEAWAY", price: 100 } },
      bom: { create: { ingredientId: ingredient.id, qty: 1, unit: "ชิ้น" } },
    },
  });
  try {
    await login(page);
    await active(page, false, menu.id);
    const response = await page.request.post("/api/manage", {
      headers: { Origin: new URL(page.url()).origin },
      data: { kind: "archiveIngredient", id: ingredient.id, confirmed: true },
    });
    expect(response.ok()).toBe(false);
    expect(await response.text()).toContain("วัตถุดิบยังถูกใช้ในสูตร");
    expect(
      (await db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }))
        .active,
    ).toBe(true);
    await active(page, true, menu.id);
    expect(
      await db.bomLine.count({
        where: { menuItemId: menu.id, ingredientId: ingredient.id },
      }),
    ).toBe(1);
  } finally {
    await db.menuItem.update({
      where: { id: menu.id },
      data: { isActive: false },
    });
  }
});

test("menu status API validates owner, confirmation and explicit target state", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  const headers = { Origin: baseURL! };
  const valid = {
    kind: "menuActive",
    id: original.id,
    isActive: false,
    confirmed: true,
  };
  try {
    expect(
      (await request.post("/api/manage", { headers, data: valid })).ok(),
    ).toBe(false);
    await login(page);
    for (const data of [
      { ...valid, confirmed: false },
      { ...valid, confirmed: undefined },
      { ...valid, isActive: "false" },
      { ...valid, id: "missing-menu" },
      { ...valid, soldOut: false },
    ])
      expect(
        (await page.request.post("/api/manage", { headers, data })).ok(),
      ).toBe(false);
    expect(
      (
        await page.request.post("/api/manage", {
          headers: { Origin: "https://invalid.example" },
          data: valid,
        })
      ).ok(),
    ).toBe(false);
    for (const [user, pin] of [
      ["cashier", "2345"],
      ["kitchen", "3456"],
    ]) {
      const context = await browser.newContext();
      try {
        const staff = await context.newPage();
        await login(staff, user, pin);
        expect(
          (
            await staff.request.post("/api/manage", { headers, data: valid })
          ).ok(),
        ).toBe(false);
      } finally {
        await context.close();
      }
    }
    await active(page, false);
    await active(page, false);
    expect(
      (await db.menuItem.findUniqueOrThrow({ where: { id: original.id } }))
        .isActive,
    ).toBe(false);
  } finally {
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive },
    });
  }
});

test("reopening a menu absent from a held snapshot refreshes new bills without rewriting the held bill", async ({
  page,
}) => {
  const originals = await db.menuItem.findMany({
    where: { id: { in: ["P01", "P02"] } },
  });
  await db.menuItem.update({
    where: { id: "P01" },
    data: { isActive: true, soldOut: false },
  });
  await db.menuItem.update({
    where: { id: "P02" },
    data: { isActive: false, soldOut: false },
  });
  try {
    await login(page);
    await expect(page.getByTestId("menu-P02")).toHaveCount(0);
    await page.getByTestId("menu-P01").click();
    await active(page, true, "P02");
    await expect(
      page.getByText(
        "มีเมนูเปิดขายเพิ่ม หากต้องการเลือกให้พักบิลนี้และเปิดบิลใหม่",
      ),
    ).toBeVisible({ timeout: 12000 });
    await expect(page.getByTestId("menu-P02")).toHaveCount(0);
    await page
      .getByRole("button", { name: "พัก / รวมบิล", exact: true })
      .click();
    await page
      .getByRole("button", { name: "พักบิลนี้ และเปิดบิลใหม่", exact: true })
      .click();
    await expect(page.getByTestId("menu-P02")).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: "พัก / รวมบิล", exact: true })
      .click();
    await page.getByRole("button", { name: "เปิดบิล", exact: true }).click();
    await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
    await expect(page.getByTestId("menu-P02")).toHaveCount(0);
    await page.getByTestId("checkout").click();
    await expect(
      page.getByRole("dialog", { name: "ชำระเงิน", exact: true }),
    ).toContainText("45");
  } finally {
    for (const menu of originals)
      await db.menuItem.update({
        where: { id: menu.id },
        data: { isActive: menu.isActive, soldOut: menu.soldOut },
      });
  }
});

test("sold-out remains visible and disabled across close and reopen", async ({
  page,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: original.id },
    data: { isActive: true, soldOut: true },
  });
  try {
    await login(page);
    const menu = page.getByTestId("menu-P01");
    await expect(menu).toBeVisible();
    await expect(menu).toBeDisabled();
    await expect(menu).toContainText("หมด");
    await active(page, false);
    await expect(menu).toHaveCount(0, { timeout: 12000 });
    await active(page, true);
    await expect(menu).toBeVisible({ timeout: 15000 });
    await expect(menu).toBeDisabled();
    expect(
      (await db.menuItem.findUniqueOrThrow({ where: { id: original.id } }))
        .soldOut,
    ).toBe(true);
  } finally {
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});

test("open POS hides closed menus, protects stale options and cart; reopen refreshes an empty bill", async ({
  page,
  context,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: original.id },
    data: { isActive: true, soldOut: false },
  });
  try {
    await login(page);
    const menu = page.getByTestId("menu-P01");
    await expect(menu).toBeVisible();
    await active(page, false);
    await expect(menu).toHaveCount(0, { timeout: 12000 });
    await page.getByPlaceholder(/ค้นหา/).fill(original.name);
    await expect(menu).toHaveCount(0);
    await page.getByPlaceholder(/ค้นหา/).fill("");
    await active(page, true);
    await expect(menu).toBeVisible({ timeout: 15000 });
    await menu.click();
    await page.getByRole("button", { name: "ตัวเลือก", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: original.name, exact: true }),
    ).toBeVisible();
    await active(page, false);
    await expect(
      page.getByRole("dialog", { name: original.name, exact: true }),
    ).toHaveCount(0, { timeout: 12000 });
    const notice = page.getByRole("dialog", { name: "ตรวจสอบรายการ" });
    await expect(notice).toContainText("เมนูนี้ปิดขายหรือหมดแล้ว");
    await notice.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `เพิ่ม ${original.name}`, exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "artifacts/menu-availability-pos.png",
      fullPage: true,
    });
    // Last known closed status survives an offline reload, even with the old draft catalog.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller !== null),
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "บิลปัจจุบัน" }),
    ).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
    await page.getByTestId("checkout").click();
    await page.getByTestId("confirm-payment").click();
    await expect(
      page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ขายบิลถัดไป" }).click();
    const pending = (await localOrders(page))[0];
    expect(pending.state).toBe("pending");
    await context.setOffline(false);
    await expect(page.getByText("รอส่ง 0 บิล").first()).toBeVisible({
      timeout: 25000,
    });
    await active(page, true);
    await expect(menu).toBeVisible({ timeout: 15000 });
    expect(await db.order.count({ where: { clientUuid: pending.id } })).toBe(1);
  } finally {
    await context.setOffline(false);
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});

test("paid offline order syncs after closure; old history, reports, stock and reversal remain exact", async ({
  page,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: original.id },
    data: { isActive: true, soldOut: false },
  });
  try {
    await login(page);
    const boot = await bootstrap(page);
    const historic = order(boot);
    await sync(page, historic, boot.permit);
    const pending = order(boot, 2); // Created/paid with this signed snapshot before closure.
    const before = await protectedData();
    const date = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const reportPath = `/api/reports?from=${date}&to=${date}`;
    const report = await (await page.request.get(reportPath)).json();
    const detail = await (
      await page.request.get(`/api/orders/${historic.clientUuid}`)
    ).json();
    await active(page, false);
    expect(await protectedData()).toEqual(before);
    expect(await (await page.request.get(reportPath)).json()).toEqual(report);
    expect(
      await (
        await page.request.get(`/api/orders/${historic.clientUuid}`)
      ).json(),
    ).toEqual(detail);
    const qtyBefore = await db.ingredient.findMany({ orderBy: { id: "asc" } });
    const batchesBefore = await db.stockBatch.findMany({
      orderBy: { id: "asc" },
    });
    await Promise.all([
      sync(page, pending, boot.permit),
      sync(page, pending, boot.permit),
    ]);
    const saved = await db.order.findUniqueOrThrow({
      where: { clientUuid: pending.clientUuid },
      include: { lines: true },
    });
    expect(saved.total).toBe(pending.total);
    expect(saved.lines[0].menuName).toBe(original.name);
    expect(saved.lines[0].unitPrice).toBe(
      boot.catalog.menus
        .find((menu) => menu.id === original.id)!
        .prices.find((price) => price.channel === "TAKEAWAY")!.price,
    );
    const sales = await db.stockMovement.findMany({
      where: { refId: pending.clientUuid, type: "SALE" },
      orderBy: { id: "asc" },
    });
    expect(sales.length).toBeGreaterThan(0);
    expect(new Set(sales.map((row) => row.ingredientId)).size).toBe(
      sales.length,
    );
    for (const sale of sales) {
      const after = await db.ingredient.findUniqueOrThrow({
        where: { id: sale.ingredientId },
      });
      expect(after.currentQty.toString()).toBe(
        qtyBefore
          .find((row) => row.id === sale.ingredientId)!
          .currentQty.plus(sale.qtyDelta)
          .toString(),
      );
    }
    const headers = { Origin: new URL(page.url()).origin };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await page.request.post(`/api/orders/${pending.clientUuid}`, {
            headers,
            data: { reason: "ทดสอบคืนหลังปิดเมนู", confirmed: true },
          })
        ).ok(),
      ).toBe(true);
    expect(
      await db.stockMovement.findMany({
        where: { refId: pending.clientUuid, type: "SALE" },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sales);
    expect(
      await db.stockMovement.count({
        where: { refId: pending.clientUuid, type: "REVERSAL" },
      }),
    ).toBe(sales.length);
    expect(await db.ingredient.findMany({ orderBy: { id: "asc" } })).toEqual(
      qtyBefore,
    );
    expect(await db.stockBatch.findMany({ orderBy: { id: "asc" } })).toEqual(
      batchesBefore,
    );
  } finally {
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});

test("Delivery retains historical names and payment; closing during composition never crashes", async ({
  page,
}) => {
  const original = await db.menuItem.findUniqueOrThrow({
    where: { id: "P01" },
  });
  await db.menuItem.update({
    where: { id: original.id },
    data: { isActive: true, soldOut: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(page);
    const boot = await bootstrap(page);
    const historical = order(boot);
    await sync(page, historical, boot.permit);
    const ticketId = randomUUID();
    const ticketLines = order(boot).lines;
    const headers = { Origin: new URL(page.url()).origin };
    const ticket = {
      kind: "create",
      id: ticketId,
      channel: "GRAB",
      externalRef: `availability-${ticketId}`,
      lines: ticketLines,
      catalogId: boot.catalogId,
    };
    expect(
      (
        await page.request.post("/api/delivery", { headers, data: ticket })
      ).ok(),
    ).toBe(true);
    await page.goto("/delivery");
    await page.getByRole("button", { name: "+ คีย์ออเดอร์แพลตฟอร์ม" }).click();
    const dialog = page.getByRole("dialog", { name: "คีย์ออเดอร์แพลตฟอร์ม" });
    await dialog
      .getByRole("button", { name: original.name, exact: true })
      .click();
    await dialog.getByLabel("เลขอ้างอิงแพลตฟอร์ม").fill("draft-closure");
    await active(page, false);
    await expect(dialog.getByRole("alert")).toContainText(
      "บางรายการปิดขายหรือหมดแล้ว",
      { timeout: 12000 },
    );
    await expect(
      dialog.getByRole("button", { name: "บันทึกออเดอร์ (ยังไม่รับเงิน)" }),
    ).toBeDisabled();
    expect(
      (
        await page.request.post("/api/delivery", {
          headers,
          data: { ...ticket, id: randomUUID(), externalRef: randomUUID() },
        })
      ).ok(),
    ).toBe(false);
    const view = await (await page.request.get("/api/delivery")).json();
    expect(
      view.tickets.find((item: { id: string }) => item.id === ticketId)
        .menuNames.P01,
    ).toBe(original.name);
    expect(
      view.tickets.find(
        (item: { id: string }) => item.id === historical.clientUuid,
      ).menuNames.P01,
    ).toBe(original.name);
    await dialog
      .getByRole("button", { name: "นำรายการที่ขายไม่ได้ออก" })
      .click();
    await expect(dialog.getByText(/0 รายการ/)).toBeVisible();
    await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
    const card = page
      .locator("article")
      .filter({ hasText: ticket.externalRef });
    await expect(card).toContainText(original.name);
    await card.getByRole("button", { name: "รับชำระบิลนี้" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByTestId("menu-P01")).toHaveCount(0);
    await page.getByTestId("checkout").click();
    await page.getByTestId("confirm-payment").click();
    await expect(
      page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await db.deliveryTicket.findUniqueOrThrow({
              where: { id: ticketId },
            })
          ).paidOrderUuid,
      )
      .not.toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await db.menuItem.update({
      where: { id: original.id },
      data: { isActive: original.isActive, soldOut: original.soldOut },
    });
  }
});
