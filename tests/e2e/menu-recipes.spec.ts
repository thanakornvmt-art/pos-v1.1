import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertTestTarget } from "../assert-test-target";
import { channels, bootstrapSchema } from "../../src/domain/schema";
assertTestTarget();
const db = new PrismaClient();
test.use({ serviceWorkers: "block" });
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
    page.getByRole("heading", { name: "บิลปัจจุบัน" }),
  ).toBeVisible();
}
async function fixture() {
  const id = crypto.randomUUID();
  const sub = await db.subRecipe.create({
    data: {
      name: `สูตรทดลอง ${id}`,
      outputQty: 10,
      outputUnit: "ถ้วย",
      lines: { create: { ingredientId: "rice", qty: 100 } },
    },
  });
  const menu = await db.menuItem.create({
    data: {
      id,
      name: `สูตรเมนู ${id}`,
      sku: `R-${id}`,
      categoryId: "porridge",
      imageUrl: "/menu/porridge.svg",
      prepSeconds: 0,
      isActive: false,
      prices: {
        create: channels.map((channel) => ({ channel, price: 10000 })),
      },
    },
  });
  return { menu, sub };
}
async function manage(page: Page, name: string) {
  await page.goto("/manage");
  await page.getByRole("button", { name: "สูตรรายเมนู", exact: true }).click();
  await page.getByLabel("ค้นหาสูตร / รหัสเมนู").fill(name);
}
test("create, review, cancel, update and delete recipe, packaging and audit without changing stock", async ({
  page,
}) => {
  const { menu, sub } = await fixture();
  await login(page);
  await manage(page, menu.sku);
  const stockBefore = await db.ingredient.findMany({
    orderBy: { id: "asc" },
    select: { id: true, currentQty: true },
  });
  const movementBefore = await db.stockMovement.count();
  await page.getByRole("button", { name: "เพิ่มสูตร", exact: true }).click();
  await page
    .getByRole("button", { name: "+ เพิ่มส่วนประกอบ", exact: true })
    .click();
  await page
    .getByLabel("ส่วนประกอบ 1", { exact: true })
    .selectOption(`r:${sub.id}`);
  await page.getByLabel("ปริมาณ 1 (ถ้วย)", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "+ เพิ่มบรรจุภัณฑ์", exact: true })
    .click();
  await page.getByLabel("บรรจุภัณฑ์ 1", { exact: true }).selectOption("bowl");
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกสูตร", exact: true })
    .click();
  expect(await db.bomLine.count({ where: { menuItemId: menu.id } })).toBe(0);
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await page.getByLabel("ปริมาณ 1 (ถ้วย)", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกสูตร", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกสูตร", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await db.menuItem.findUniqueOrThrow({
    where: { id: menu.id },
    include: { bom: true, packaging: true },
  });
  expect(saved.bom[0].unit).toBe("ถ้วย");
  expect(saved.bom[0].qty.toString()).toBe("3");
  expect(saved.packaging[0].ingredientId).toBe("bowl");
  expect(saved.packaging[0].channel).toBe("TAKEAWAY");
  expect(saved.isActive).toBe(false);
  await page.getByRole("button", { name: "แก้ไขสูตร", exact: true }).click();
  await page.getByLabel("ปริมาณ 1 (ถ้วย)", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "ตรวจสอบและบันทึกสูตร", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันบันทึกสูตร", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "ลบสูตร", exact: true }).click();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(await db.bomLine.count({ where: { menuItemId: menu.id } })).toBe(1);
  await page.getByRole("button", { name: "ลบสูตร", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันลบสูตร", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await db.bomLine.count({ where: { menuItemId: menu.id } })).toBe(0);
  expect(await db.packagingRule.count({ where: { menuItemId: menu.id } })).toBe(
    0,
  );
  expect(
    await db.menuItem.findUnique({ where: { id: menu.id } }),
  ).toMatchObject({ isActive: false });
  expect(
    await db.auditLog.count({ where: { entityId: menu.id, action: "BOM" } }),
  ).toBe(2);
  expect(
    await db.auditLog.count({
      where: { entityId: menu.id, action: "DELETEBOM" },
    }),
  ).toBe(1);
  expect(
    await db.ingredient.findMany({
      orderBy: { id: "asc" },
      select: { id: true, currentQty: true },
    }),
  ).toEqual(stockBefore);
  expect(await db.stockMovement.count()).toBe(movementBefore);
});
test("reject invalid, stale, unconfirmed and unauthorized recipe mutations atomically", async ({
  page,
  baseURL,
}) => {
  const { menu } = await fixture();
  await login(page);
  const current = async () =>
    (await (await page.request.get("/api/manage")).json()).menus.find(
      (m: { id: string }) => m.id === menu.id,
    );
  const initial = await current();
  const payload = {
    kind: "bom",
    id: menu.id,
    lines: [{ ingredientId: "rice", subRecipeId: null, qty: "1" }],
    packaging: [],
    expectedVersion: initial.recipeVersion,
    confirmed: true,
  };
  const post = (data: unknown) =>
    page.request.post("/api/manage", { headers: { Origin: baseURL! }, data });
  expect((await post({ ...payload, confirmed: false })).ok()).toBe(false);
  expect(
    (
      await post({
        ...payload,
        lines: [{ ingredientId: "rice", subRecipeId: null, qty: "0" }],
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await post({
        ...payload,
        lines: [{ ingredientId: "missing", subRecipeId: null, qty: "1" }],
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await post({
        ...payload,
        packaging: [1, 2].map(() => ({
          channel: "TAKEAWAY",
          ingredientId: "bowl",
          qty: "1",
        })),
      })
    ).ok(),
  ).toBe(false);
  expect(await db.bomLine.count({ where: { menuItemId: menu.id } })).toBe(0);
  expect((await post(payload)).ok()).toBe(true);
  expect(
    (
      await post({
        ...payload,
        lines: [{ ingredientId: "rice", subRecipeId: null, qty: "9" }],
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await post({
        kind: "deleteBom",
        id: menu.id,
        expectedVersion: initial.recipeVersion,
        confirmed: true,
      })
    ).ok(),
  ).toBe(false);
  const fresh = await current();
  await login(page, "cashier", "2345");
  expect(
    (await post({ ...payload, expectedVersion: fresh.recipeVersion })).ok(),
  ).toBe(false);
  expect(
    (
      await post({
        kind: "deleteBom",
        id: menu.id,
        expectedVersion: fresh.recipeVersion,
        confirmed: true,
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await db.bomLine.findFirstOrThrow({ where: { menuItemId: menu.id } })
    ).qty.toString(),
  ).toBe("1");
  await login(page);
  const empty = await fixture();
  expect(
    (
      await post({
        kind: "menuActive",
        id: empty.menu.id,
        isActive: true,
        confirmed: true,
      })
    ).ok(),
  ).toBe(false);
});
test("old catalog orders keep original usage after editing and deleting recipe; resync does not deduct again", async ({
  page,
  baseURL,
}) => {
  const { menu } = await fixture();
  await db.bomLine.create({
    data: { menuItemId: menu.id, ingredientId: "rice", qty: 2, unit: "กรัม" },
  });
  await db.menuItem.update({
    where: { id: menu.id },
    data: { isActive: true },
  });
  await login(page);
  const deviceId = crypto.randomUUID();
  const boot = bootstrapSchema.parse(
    await (
      await page.request.post("/api/bootstrap", {
        headers: { Origin: baseURL! },
        data: { deviceId },
      })
    ).json(),
  );
  const order = {
    clientUuid: crypto.randomUUID(),
    deviceId,
    localSequence: 1,
    orderNo: `${boot.device.prefix}-000001`,
    queueNo: `${boot.device.prefix.slice(0, 4)}-1`,
    catalogId: boot.catalogId,
    createdBy: "owner",
    createdAt: new Date().toISOString(),
    channel: "DINE_IN",
    lines: [
      {
        id: crypto.randomUUID(),
        menuItemId: menu.id,
        qty: 1,
        optionIds: [],
        note: "",
      },
    ],
    discount: null,
    total: 10000,
    payment: { method: "CASH", tendered: 10000, refNo: "", verified: true },
  };
  const sync = () =>
    page.request.post("/api/sync/orders", {
      headers: { Origin: baseURL! },
      data: { order, permit: boot.permit },
    });
  const before = await db.catalogSnapshot.findUniqueOrThrow({
    where: { id: boot.catalogId },
  });
  const getMenu = async () =>
    (await (await page.request.get("/api/manage")).json()).menus.find(
      (m: { id: string }) => m.id === menu.id,
    );
  let m = await getMenu();
  expect(
    (
      await page.request.post("/api/manage", {
        headers: { Origin: baseURL! },
        data: {
          kind: "bom",
          id: menu.id,
          expectedVersion: m.recipeVersion,
          lines: [{ ingredientId: "rice", subRecipeId: null, qty: "20" }],
          confirmed: true,
        },
      })
    ).ok(),
  ).toBe(true);
  m = await getMenu();
  expect(
    (
      await page.request.post("/api/manage", {
        headers: { Origin: baseURL! },
        data: {
          kind: "deleteBom",
          id: menu.id,
          expectedVersion: m.recipeVersion,
          confirmed: true,
        },
      })
    ).ok(),
  ).toBe(true);
  // An offline sale from the earlier immutable catalog is synced after deletion.
  expect((await sync()).ok()).toBe(true);
  const saved = await db.order.findUniqueOrThrow({
    where: { clientUuid: order.clientUuid },
    include: { lines: true },
  });
  const stock = await db.ingredient.findUniqueOrThrow({
    where: { id: "rice" },
  });
  const movement = await db.stockMovement.findMany({
    where: { refId: order.clientUuid, type: "SALE" },
  });
  expect(movement).toHaveLength(1);
  expect(movement[0].qtyDelta.toString()).toBe("-2");
  expect((await sync()).ok()).toBe(true);
  expect(
    await db.order.findUniqueOrThrow({
      where: { clientUuid: order.clientUuid },
      include: { lines: true },
    }),
  ).toEqual(saved);
  expect(
    (await db.ingredient.findUniqueOrThrow({ where: { id: "rice" } }))
      .currentQty,
  ).toEqual(stock.currentQty);
  expect(
    await db.stockMovement.findMany({
      where: { refId: order.clientUuid, type: "SALE" },
    }),
  ).toEqual(movement);
  expect(
    await db.catalogSnapshot.findUniqueOrThrow({
      where: { id: boot.catalogId },
    }),
  ).toEqual(before);
});
for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]) {
  test(`recipe editor, packaging, options and confirmation fit ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize(size);
    await manage(page, "P01");
    await page.getByRole("button", { name: "แก้ไขสูตร", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "รูปแบบสินค้า / ตัวเลือกเดิม (จำลองต้นทุน)",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "+ เพิ่มบรรจุภัณฑ์", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          body: document.documentElement.scrollWidth <= window.innerWidth,
          dialogs: [...document.querySelectorAll('[role="dialog"]')].every(
            (el) => el.scrollWidth <= el.clientWidth,
          ),
        })),
      )
      .toEqual({ body: true, dialogs: true });
    await page.screenshot({ path: `artifacts/recipe-${size.width}.png` });
    await page.getByRole("button", { name: "ปิด", exact: true }).click();
    await page.getByRole("button", { name: "ลบสูตร", exact: true }).click();
    await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
