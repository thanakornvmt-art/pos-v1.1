import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertTestTarget } from "../assert-test-target";
import { channels } from "../../src/domain/schema";

assertTestTarget();
const db = new PrismaClient();
test.afterAll(async () => { await db.$disconnect(); });
async function login(page: Page, user = "owner", pin = "1234") {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption(user);
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "บิลปัจจุบัน" })).toBeVisible();
}

test("recipe management creates, filters and renames categories, and keeps new menus closed until configured", async ({ page }) => {
  await login(page);
  await page.goto("/manage");
  await page.getByRole("button", { name: "สูตรรายเมนู", exact: true }).click();
  const name = `หมวดรวมงาน ${crypto.randomUUID()}`;
  await page.getByRole("button", { name: "+ สร้างหมวดหมู่", exact: true }).click();
  await page.getByLabel("ชื่อหมวดหมู่ *").fill(name);
  await page.getByRole("button", { name: "บันทึกหมวดหมู่", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const category = await db.category.findFirstOrThrow({ where: { name } });
  await page.getByLabel("หมวดหมู่สูตรรายเมนู").selectOption(category.id);
  await expect(page.getByText("ยังไม่มีเมนูในหมวดหมู่นี้", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ เพิ่มเมนู", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "เพิ่มเมนู", exact: true });
  const sku = `MERGE-${crypto.randomUUID()}`;
  const menuName = `เมนูรวมงาน ${Date.now()}`;
  await dialog.getByLabel("รหัสเมนู *").fill(sku);
  await dialog.getByLabel("ชื่อเมนู *").fill(menuName);
  await expect(dialog.getByLabel("หมวดหมู่ *")).toHaveValue(category.id);
  await dialog.locator('input[name^="price-"]').first().fill("42.50");
  await dialog.getByRole("button", { name: "บันทึกเมนู", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: menuName, exact: true })).toBeVisible();
  const menu = await db.menuItem.findUniqueOrThrow({ where: { sku }, include: { prices: true } });
  expect(menu.categoryId).toBe(category.id);
  expect(menu.isActive).toBe(false);
  expect(menu.prices).toHaveLength(6);
  expect(menu.prices.some(p => p.price === 4250)).toBe(true);
  await page.getByRole("button", { name: "แก้ไขชื่อหมวดหมู่", exact: true }).click();
  await page.getByLabel("ชื่อหมวดหมู่ *").fill(`${name} ใหม่`);
  await page.getByRole("button", { name: "บันทึกหมวดหมู่", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await db.category.findUniqueOrThrow({ where: { id: category.id } })).name).toBe(`${name} ใหม่`);
  expect(await db.auditLog.count({ where: { entityId: category.id, action: "CATEGORY" } })).toBe(2);
  expect(await db.auditLog.count({ where: { entityId: menu.id, action: "MENU" } })).toBe(1);
});

test("management mutations reject cashier access, duplicate categories and invalid prices", async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const category = await db.category.findFirstOrThrow();
  const duplicate = await page.request.post("/api/manage", { headers: { Origin: origin }, data: { kind: "category", data: { id: crypto.randomUUID(), name: category.name } } });
  expect(duplicate.ok()).toBe(false);
  const invalid = await page.request.post("/api/manage", { headers: { Origin: origin }, data: { kind: "menu", data: { id: crypto.randomUUID(), sku: crypto.randomUUID(), name: "ราคาผิด", categoryId: category.id, prices: channels.map(channel => ({ channel, price: -1 })) } } });
  expect(invalid.ok()).toBe(false);
  await login(page, "cashier", "2345");
  const id = crypto.randomUUID();
  const denied = await page.request.post("/api/manage", { headers: { Origin: origin }, data: { kind: "category", data: { id, name: "หมวดที่ต้องถูกปฏิเสธ" } } });
  expect(denied.ok()).toBe(false);
  expect(await db.category.findUnique({ where: { id } })).toBeNull();
});
