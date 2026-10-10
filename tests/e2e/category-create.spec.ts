import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertTestTarget } from "../assert-test-target";
import { channels } from "../../src/domain/schema";
assertTestTarget();
const db = new PrismaClient(),
  ingredient = crypto.randomUUID(),
  baseMenuId = crypto.randomUUID();
test.beforeAll(async () => {
  await db.ingredient.create({
    data: {
      id: ingredient,
      name: "วัตถุดิบทดสอบหมวดหมู่",
      purchaseUnit: "กรัม",
      usageUnit: "กรัม",
      conversionRate: 1,
      yieldPercent: 100,
      avgCost: 2,
      currentQty: 1000,
      parLevel: 0,
      reorderPoint: 0,
      isPerishable: false,
    },
  });
  const category = await db.category.create({
    data: {
      name: `หมวดตั้งต้นทดสอบ ${Date.now()}`,
      color: "#eddda5",
      sortOrder: 100,
    },
  });
  await db.menuItem.create({
    data: {
      id: baseMenuId,
      name: "เมนูบิลเดิมทดสอบหมวด",
      sku: `TEST-${baseMenuId}`,
      categoryId: category.id,
      imageUrl: "",
      prepSeconds: 180,
      bom: { create: { ingredientId: ingredient, qty: 1, unit: "กรัม" } },
      prices: {
        create: channels.map((channel) => ({ channel, price: 1000 })),
      },
    },
  });
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
  await expect(
    page.getByRole("heading", { name: "บิลปัจจุบัน", includeHidden: true }),
  ).toBeAttached({ timeout: 20000 });
  await expect(
    page.getByRole("status").getByText("ออนไลน์", { exact: true }),
  ).toBeVisible();
}
async function fillMenu(page: Page, name: string) {
  await page
    .getByRole("button", { name: "เพิ่มเมนูใหม่", exact: true })
    .click();
  await page.getByLabel("ชื่อเมนู", { exact: true }).fill(name);
  await page.getByLabel("ราคาขาย (บาท)", { exact: true }).fill("55.50");
  await page
    .getByLabel("วัตถุดิบหรือสูตรย่อย 1", { exact: true })
    .selectOption(`i:${ingredient}`);
  await page.getByLabel("จำนวนต่อจาน 1", { exact: true }).fill("12.5");
}
test("mobile adds category without losing menu fields, recovers lost response, then creates and filters menu", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const menuName = `เมนูหมวดใหม่ ${Date.now()}`,
    categoryName = `หมวดใหม่ ${Date.now()}`;
  await fillMenu(page, menuName);
  await page
    .getByRole("button", { name: "+ เพิ่มหมวดหมู่", exact: true })
    .click();
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "กรุณาใส่ชื่อหมวดหมู่" }),
  ).toBeVisible();
  const old = await db.category.findFirstOrThrow();
  await page
    .getByLabel("ชื่อหมวดหมู่ใหม่", { exact: true })
    .fill(` ${old.name} `);
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "มีหมวดหมู่ชื่อนี้แล้ว" }),
  ).toBeVisible();
  await page.getByLabel("ชื่อหมวดหมู่ใหม่", { exact: true }).fill(categoryName);
  const beforeOrder =
    (await db.category.aggregate({ _max: { sortOrder: true } }))._max
      .sortOrder ?? 0;
  let drop = true;
  await page.route("**/api/categories", async (route) => {
    if (drop) {
      drop = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "เชื่อมต่อไม่สำเร็จ" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `เพิ่มหมวดหมู่ “${categoryName}” แล้ว` }),
  ).toBeVisible();
  const category = await db.category.findFirstOrThrow({
    where: { name: categoryName },
  });
  expect(category.sortOrder).toBe(beforeOrder + 1);
  expect(category.color).toBe("#eddda5");
  expect(
    await db.auditLog.count({
      where: { entityId: category.id, action: "CREATE_CATEGORY" },
    }),
  ).toBe(1);
  await expect(page.getByLabel("หมวดหมู่", { exact: true })).toHaveValue(
    category.id,
  );
  await expect(page.getByLabel("ชื่อเมนู", { exact: true })).toHaveValue(
    menuName,
  );
  await expect(page.getByLabel("ราคาขาย (บาท)", { exact: true })).toHaveValue(
    "55.50",
  );
  await expect(page.getByLabel("จำนวนต่อจาน 1", { exact: true })).toHaveValue(
    "12.5",
  );
  await page.screenshot({
    path: "artifacts/category-create-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกเมนู", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกเมนู", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const menu = await db.menuItem.findFirstOrThrow({
    where: { name: menuName },
  });
  expect(menu.categoryId).toBe(category.id);
  await page.getByRole("button", { name: categoryName, exact: true }).click();
  await expect(page.getByTestId(`menu-${menu.id}`)).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "เพิ่มเมนูใหม่", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "+ เพิ่มหมวดหมู่", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
});
test("API limits owner and origin, rejects blank names, handles concurrent retries and duplicate names", async ({
  page,
  browser,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const command = {
    id: crypto.randomUUID(),
    name: `หมวดพร้อมกัน ${Date.now()}`,
    confirmed: true,
  };
  const post = (data: unknown) =>
    page.request.post("/api/categories", { headers: { Origin: origin }, data });
  expect((await post({ ...command, name: "  " })).ok()).toBe(false);
  expect((await post({ ...command, confirmed: false })).ok()).toBe(false);
  expect(
    (
      await page.request.post("/api/categories", {
        headers: { Origin: "https://other.example" },
        data: command,
      })
    ).status(),
  ).toBe(403);
  const other = await browser.newContext();
  const cashier = await other.newPage();
  try {
    await login(cashier, "cashier", "2345");
    expect(
      (
        await cashier.request.post("/api/categories", {
          headers: { Origin: origin },
          data: command,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await other.close();
  }
  const replies = await Promise.all([post(command), post(command)]);
  for (const reply of replies) expect(reply.ok()).toBe(true);
  expect(await db.category.count({ where: { id: command.id } })).toBe(1);
  expect(
    await db.auditLog.count({
      where: { entityId: command.id, action: "CREATE_CATEGORY" },
    }),
  ).toBe(1);
  expect(
    (await post({ ...command, name: "เปลี่ยนชื่อด้วยรหัสเดิม" })).ok(),
  ).toBe(false);
  const duplicateName = `หมวดซ้ำ ${Date.now()}`;
  const duplicates = await Promise.all([
    post({ ...command, id: crypto.randomUUID(), name: duplicateName }),
    post({ ...command, id: crypto.randomUUID(), name: ` ${duplicateName} ` }),
  ]);
  expect(duplicates.filter((r) => r.ok())).toHaveLength(1);
  expect(await db.category.count({ where: { name: duplicateName } })).toBe(1);
});
test("category and menu creation while selling preserve the current bill", async ({
  page,
}) => {
  await login(page);
  const base = await db.menuItem.findUniqueOrThrow({
    where: { id: baseMenuId },
  });
  await page.getByTestId(`menu-${base.id}`).click();
  await expect(page.locator("aside strong").last()).toHaveText("฿10");
  const priceText = await page.locator("aside strong").last().textContent();
  const name = `เมนูระหว่างเพิ่มหมวด ${Date.now()}`,
    categoryName = `หมวดระหว่างขาย ${Date.now()}`;
  await fillMenu(page, name);
  await page
    .getByRole("button", { name: "+ เพิ่มหมวดหมู่", exact: true })
    .click();
  await page.getByLabel("ชื่อหมวดหมู่ใหม่", { exact: true }).fill(categoryName);
  await page.getByLabel("ชื่อหมวดหมู่ใหม่", { exact: true }).press("Enter");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `เพิ่มหมวดหมู่ “${categoryName}” แล้ว` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกเมนู", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกเมนู", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("aside strong").last()).toHaveText(priceText!);
  await expect(page.locator("aside")).toContainText(base.name);
  const menu = await db.menuItem.findFirstOrThrow({ where: { name } });
  await expect(page.getByTestId(`menu-${menu.id}`)).toHaveCount(0);
  await page.getByRole("button", { name: "พัก / รวมบิล", exact: true }).click();
  await page
    .getByRole("button", { name: "พักบิลนี้ และเปิดบิลใหม่", exact: true })
    .click();
  await page.getByRole("button", { name: categoryName, exact: true }).click();
  await expect(page.getByTestId(`menu-${menu.id}`)).toBeVisible();
});
