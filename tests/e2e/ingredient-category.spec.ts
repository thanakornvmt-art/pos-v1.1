import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertTestTarget } from "../assert-test-target";
assertTestTarget();
const db = new PrismaClient();
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
  await expect(page).toHaveURL(/\/pos$/);
}
test("create and edit all categories; stock filters and legacy API preserve stock, recipes and sales", async ({
  page,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const existing = await db.ingredient.findFirstOrThrow();
  const before = {
    orders: await db.order.count(),
    movements: await db.stockMovement.count(),
    bom: await db.bomLine.findMany(),
  };
  await page.goto("/manage");
  await page
    .getByRole("button", { name: "+ เพิ่มวัตถุดิบ", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "ข้อมูลวัตถุดิบ" });
  const name = `หมวดทดสอบ ${crypto.randomUUID()}`;
  await form.getByLabel("ชื่อ", { exact: true }).fill(name);
  await form.getByLabel("หน่วยซื้อ", { exact: true }).fill("ชิ้น");
  await form.getByLabel("หน่วยใช้", { exact: true }).fill("ชิ้น");
  await form
    .getByLabel("หมวดวัตถุดิบ", { exact: false })
    .selectOption("PACKAGING");
  await form
    .getByRole("button", { name: "บันทึกวัตถุดิบ", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const item = await db.ingredient.findFirstOrThrow({ where: { name } });
  expect(item.category).toBe("PACKAGING");
  for (const category of ["SEASONING", "FOOD", "PACKAGING"] as const) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "แก้ไข", exact: true }).click();
    await form
      .getByLabel("หมวดวัตถุดิบ", { exact: false })
      .selectOption(category);
    await form
      .getByRole("button", { name: "บันทึกวัตถุดิบ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ยืนยัน", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await db.ingredient.findUniqueOrThrow({ where: { id: item.id } }))
        .category,
    ).toBe(category);
  }
  const payload = {
    id: item.id,
    name,
    purchaseUnit: "ชิ้น",
    usageUnit: "ชิ้น",
    conversionRate: "1",
    yieldPercent: "100",
    parLevel: "0",
    reorderPoint: "0",
    isPerishable: false,
    shelfLifeDays: null,
    supplierId: null,
  };
  const post = (data: unknown) =>
    page.request.post("/api/manage", {
      headers: { Origin: origin },
      data: { kind: "ingredient", data },
    });
  expect((await post({ ...payload, category: "INVALID" })).ok()).toBe(false);
  expect((await post(payload)).ok()).toBe(true);
  expect(
    (await db.ingredient.findUniqueOrThrow({ where: { id: item.id } }))
      .category,
  ).toBe("PACKAGING");
  await page.goto("/stock");
  const filter = page.getByLabel("หมวดวัตถุดิบในสต็อก");
  for (const category of [
    "FOOD",
    "SEASONING",
    "PACKAGING",
    "unclassified",
    "all",
  ]) {
    await filter.selectOption(category);
    const expected = await db.ingredient.findMany({
      where: {
        active: true,
        ...(category === "all"
          ? {}
          : {
              category:
                category === "unclassified"
                  ? null
                  : (category as "FOOD" | "SEASONING" | "PACKAGING"),
            }),
      },
    });
    const list = page.getByRole("region", { name: "รายการสต็อก" });
    await expect(list.getByRole("article")).toHaveCount(expected.length);
    for (const ingredient of expected)
      await expect(
        list.getByRole("heading", { name: ingredient.name, exact: true }),
      ).toBeVisible();
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(filter).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/stock-mobile.png", fullPage: true });
  expect(await db.order.count()).toBe(before.orders);
  expect(await db.stockMovement.count()).toBe(before.movements);
  expect(await db.bomLine.findMany()).toEqual(before.bom);
  expect(
    await db.ingredient.findUniqueOrThrow({ where: { id: existing.id } }),
  ).toEqual(existing);
  expect(
    await db.auditLog.count({
      where: { entityId: item.id, action: "INGREDIENT" },
    }),
  ).toBe(5);
  await login(page, "cashier", "2345");
  expect((await post({ ...payload, category: "FOOD" })).ok()).toBe(false);
  expect(
    (await db.ingredient.findUniqueOrThrow({ where: { id: item.id } }))
      .category,
  ).toBe("PACKAGING");
});

