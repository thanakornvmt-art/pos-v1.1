import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { channels } from "../../src/domain/schema";
import { assertTestTarget } from "../assert-test-target";
assertTestTarget();
const db = new PrismaClient();
const category = crypto.randomUUID(),
  rice = crypto.randomUUID(),
  box = crypto.randomUUID(),
  recipe = crypto.randomUUID();
const created: string[] = [];
test.beforeAll(async () => {
  await db.category.create({
    data: {
      id: category,
      name: "หมวดทดสอบเพิ่มเมนู",
      color: "#ffffff",
      sortOrder: 99,
    },
  });
  for (const [id, name, usageUnit, avgCost, currentQty] of [
    [rice, "ข้าวทดสอบเพิ่มเมนู", "กรัม", 2, 10000],
    [box, "กล่องทดสอบเพิ่มเมนู", "ใบ", 300, 100],
  ] as const)
    await db.ingredient.create({
      data: {
        id,
        name,
        usageUnit,
        purchaseUnit: usageUnit,
        conversionRate: 1,
        yieldPercent: 100,
        avgCost,
        currentQty,
        parLevel: 0,
        reorderPoint: 0,
        isPerishable: false,
      },
    });
  await db.subRecipe.create({
    data: {
      id: recipe,
      name: "สูตรข้าวทดสอบเพิ่มเมนู",
      outputQty: 200,
      outputUnit: "กรัม",
      lines: { create: { ingredientId: rice, qty: 100 } },
    },
  });
});
test.afterAll(async () => {
  await db.menuItem.updateMany({
    where: { id: { in: created } },
    data: { isActive: false },
  });
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
  await expect(
    page.getByRole("heading", { name: "บิลปัจจุบัน", includeHidden: true }),
  ).toBeAttached({ timeout: 20000 });
  await expect(
    page.getByRole("status").getByText("ออนไลน์", { exact: true }),
  ).toBeVisible();
}
async function createForm(page: Page, name: string) {
  await page
    .getByRole("button", { name: "เพิ่มเมนูใหม่", exact: true })
    .click();
  await page.getByLabel("ชื่อเมนู", { exact: true }).fill(name);
  await page.getByLabel("หมวดหมู่", { exact: true }).selectOption(category);
  await page.getByLabel("ราคาขาย (บาท)", { exact: true }).fill("50");
  await page
    .getByLabel("วัตถุดิบหรือสูตรย่อย 1", { exact: true })
    .selectOption(`i:${rice}`);
  await page.getByLabel("จำนวนต่อจาน 1", { exact: true }).fill("100");
}
test("owner creates menu from POS, sells offline then syncs recipe, packaging costs and stock", async ({
  page,
  context,
}) => {
  await login(page);
  const name = `เมนูใหม่ทดสอบ ${Date.now()}`;
  await createForm(page, name);
  await page.getByLabel("จำนวนต่อจาน 1", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกเมนู", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "จำนวนต้องมากกว่า 0" }),
  ).toBeVisible();
  await page.getByLabel("จำนวนต่อจาน 1", { exact: true }).fill("100");
  await page.getByRole("button", { name: "เพิ่มส่วนผสม", exact: true }).click();
  await page
    .getByLabel("วัตถุดิบหรือสูตรย่อย 2", { exact: true })
    .selectOption(`r:${recipe}`);
  await page.getByLabel("จำนวนต่อจาน 2", { exact: true }).fill("100");
  await page.locator("summary").filter({ hasText: "เพิ่มเติม: ราคา" }).click();
  await page.getByLabel("กำหนดราคาแยกตามช่องทาง").check();
  await page.getByLabel("ราคา Grab", { exact: true }).fill("65.50");
  await page
    .getByRole("button", { name: "เพิ่มบรรจุภัณฑ์", exact: true })
    .click();
  await page.getByLabel("บรรจุภัณฑ์ 1", { exact: true }).selectOption(box);
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกเมนู", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกเมนู", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const menu = await db.menuItem.findFirstOrThrow({
    where: { name },
    include: { bom: true, prices: true, packaging: true },
  });
  created.push(menu.id);
  expect(menu.bom.map((l) => l.unit)).toEqual(["กรัม", "กรัม"]);
  expect(menu.prices).toHaveLength(6);
  expect(menu.prices.find((p) => p.channel === "GRAB")?.price).toBe(6550);
  expect(menu.packaging).toHaveLength(1);
  await expect(page.getByTestId(`menu-${menu.id}`)).toBeVisible();
  await page.screenshot({
    path: "artifacts/menu-created-pos.png",
    fullPage: true,
  });
  const beforeRice = (
    await db.ingredient.findUniqueOrThrow({ where: { id: rice } })
  ).currentQty.toNumber();
  const beforeBox = (
    await db.ingredient.findUniqueOrThrow({ where: { id: box } })
  ).currentQty.toNumber();
  await context.setOffline(true);
  await page.getByTestId(`menu-${menu.id}`).click();
  await page.getByTestId("checkout").click();
  await page
    .getByRole("button", { name: "ยืนยันรับเงิน", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
  ).toBeVisible();
  expect(
    await db.order.count({
      where: { lines: { some: { menuItemId: menu.id } } },
    }),
  ).toBe(0);
  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        db.order.count({ where: { lines: { some: { menuItemId: menu.id } } } }),
      { timeout: 25000 },
    )
    .toBe(1);
  const order = await db.order.findFirstOrThrow({
    where: { lines: { some: { menuItemId: menu.id } } },
  });
  expect(order.total).toBe(5000);
  expect(order.ingredientCost).toBe(300);
  expect(order.packagingCost).toBe(300);
  expect(order.grossProfit).toBe(4400);
  expect(
    (
      await db.ingredient.findUniqueOrThrow({ where: { id: rice } })
    ).currentQty.toNumber(),
  ).toBe(beforeRice - 150);
  expect(
    (
      await db.ingredient.findUniqueOrThrow({ where: { id: box } })
    ).currentQty.toNumber(),
  ).toBe(beforeBox - 1);
  expect(
    await db.auditLog.count({
      where: { entityId: menu.id, action: "CREATE_MENU" },
    }),
  ).toBe(1);
});
test("existing bill keeps original price and recipe until a new bill is opened; mobile form fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // Create a base menu independently so this check can also run alone.
  const baseId = crypto.randomUUID();
  created.push(baseId);
  await db.menuItem.create({
    data: {
      id: baseId,
      sku: `TEST-${baseId}`,
      name: "เมนูบิลเดิมทดสอบ",
      categoryId: category,
      imageUrl: "",
      prepSeconds: 180,
      prices: { create: channels.map((channel) => ({ channel, price: 1000 })) },
      bom: { create: { ingredientId: rice, qty: 1, unit: "กรัม" } },
    },
  });
  await expect(page.getByTestId(`menu-${baseId}`)).toBeVisible({
    timeout: 20000,
  });
  await page.getByTestId(`menu-${baseId}`).click();
  const name = `เมนูระหว่างขาย ${Date.now()}`;
  await createForm(page, name);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/menu-create-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกเมนู", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกเมนู", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const menu = await db.menuItem.findFirstOrThrow({ where: { name } });
  created.push(menu.id);
  await db.menuPrice.updateMany({
    where: { menuItemId: baseId },
    data: { price: 9900 },
  });
  await expect(
    page.getByText(/พักบิลนี้และเปิดบิลใหม่เพื่อเลือกเมนูใหม่/),
  ).toBeVisible();
  await expect(page.getByTestId(`menu-${menu.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`menu-${baseId}`)).toContainText("฿10");
  await page.getByRole("button", { name: "พัก / รวมบิล", exact: true }).click();
  await page
    .getByRole("button", { name: "พักบิลนี้ และเปิดบิลใหม่", exact: true })
    .click();
  await expect(page.getByTestId(`menu-${menu.id}`)).toBeVisible();
});
test("server rejects invalid recipes and cashier access; identical concurrent retry records once", async ({
  page,
  browser,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const command = {
    id: crypto.randomUUID(),
    name: `ทดสอบบันทึกซ้ำ ${Date.now()}`,
    categoryId: category,
    prices: channels.map((channel) => ({ channel, price: 4500 })),
    lines: [{ ingredientId: rice, subRecipeId: null, qty: "1" }],
    packaging: [],
    confirmed: true,
  };
  created.push(command.id);
  for (const change of [
    { categoryId: "missing" },
    { lines: [] },
    { lines: [{ ingredientId: "missing", subRecipeId: null, qty: "1" }] },
    { lines: [{ ingredientId: null, subRecipeId: "missing", qty: "1" }] },
    { confirmed: false },
  ]) {
    const r = await page.request.post("/api/menus", {
      headers: { Origin: origin },
      data: { ...command, ...change },
    });
    expect(r.ok()).toBe(false);
    expect(await db.menuItem.count({ where: { id: command.id } })).toBe(0);
  }
  const forged = await page.request.post("/api/menus", {
    headers: { Origin: "https://other.example" },
    data: command,
  });
  expect(forged.ok()).toBe(false);
  const other = await browser.newContext();
  const cashier = await other.newPage();
  try {
    await login(cashier, "cashier", "2345");
    await expect(
      cashier.getByRole("button", { name: "เพิ่มเมนูใหม่", exact: true }),
    ).toHaveCount(0);
    expect((await cashier.request.get("/api/menus")).status()).toBe(403);
    expect(
      (
        await cashier.request.post("/api/menus", {
          headers: { Origin: origin },
          data: command,
        })
      ).ok(),
    ).toBe(false);
  } finally {
    await other.close();
  }
  const responses = await Promise.all([
    page.request.post("/api/menus", {
      headers: { Origin: origin },
      data: command,
    }),
    page.request.post("/api/menus", {
      headers: { Origin: origin },
      data: command,
    }),
  ]);
  for (const response of responses) expect(response.ok()).toBe(true);
  expect(await db.menuItem.count({ where: { id: command.id } })).toBe(1);
  expect(
    await db.auditLog.count({
      where: { entityId: command.id, action: "CREATE_MENU" },
    }),
  ).toBe(1);
  expect(
    (
      await page.request.post("/api/menus", {
        headers: { Origin: origin },
        data: { ...command, name: "แก้จากคำขอเดิม" },
      })
    ).ok(),
  ).toBe(false);
  await db.ingredient.update({ where: { id: rice }, data: { active: false } });
  const r = await page.request.post("/api/menus", {
    headers: { Origin: origin },
    data: {
      ...command,
      id: crypto.randomUUID(),
      lines: [{ ingredientId: null, subRecipeId: recipe, qty: "1" }],
    },
  });
  expect(r.ok()).toBe(false);
  await db.ingredient.update({ where: { id: rice }, data: { active: true } });
});
