import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bootstrapSchema } from "../../src/domain/schema";
import { reportSchema } from "../../src/domain/reports";
import { reportSections } from "../../src/domain/report-sections";

test.use({ serviceWorkers: "block" });
const db = new PrismaClient();
test.beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes("/morning_pos_test"))
    throw new Error(
      "Reports tests require the isolated morning_pos_test database",
    );
});
test.afterAll(async () => db.$disconnect());
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
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const content = document.querySelector('[data-testid="page-content"]')!;
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        content.scrollWidth <= content.clientWidth
      );
    }),
  ).toBe(true);
}

test("nine report views use historical sales, support CSV, filtering, dates and mobile navigation", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const deviceId = randomUUID();
  const response = await page.request.post("/api/bootstrap", {
    headers: { Origin: baseURL! },
    data: { deviceId },
  });
  expect(response.ok()).toBe(true);
  const boot = bootstrapSchema.parse(await response.json());
  const savedCatalog = structuredClone(boot.catalog);
  savedCatalog.settings.taxBps = 700;
  savedCatalog.categories[0].name = "หมวดหมู่ ณ วันขาย";
  const first = savedCatalog.menus[0],
    second = savedCatalog.menus[1];
  first.categoryId = savedCatalog.categories[0].id;
  first.groups = [
    {
      id: "report-eggs",
      name: "ไข่",
      minSelect: 0,
      maxSelect: 1,
      isRequired: false,
      items: [
        {
          id: "report-egg",
          name: "ไข่ทดสอบ",
          priceDelta: 1000,
          ingredientId: null,
          qtyDelta: null,
        },
      ],
    },
  ];
  const snapshotId = createHash("sha256")
    .update(JSON.stringify(savedCatalog) + randomUUID())
    .digest("hex");
  const paidId = randomUUID(),
    voidId = randomUUID();
  const orderIds = [paidId, voidId];
  const at = new Date("2001-01-01T03:00:00Z");
  await db.catalogSnapshot.create({
    data: { id: snapshotId, data: savedCatalog },
  });
  try {
    const common = {
      deviceId,
      catalogId: snapshotId,
      payloadHash: "report-test",
      createdBy: boot.user.id,
      createdAt: at,
      channel: "DINE_IN" as const,
      platformFeePercent: 0,
      platformFee: 0,
      packagingCost: 0,
    };
    await db.order.create({
      data: {
        ...common,
        id: paidId,
        clientUuid: paidId,
        orderNo: `REPORT-${paidId.slice(0, 8)}`,
        queueNo: "R1",
        localSequence: 1,
        subtotal: 15000,
        discount: 1000,
        tax: 980,
        total: 14980,
        netPayout: 14980,
        ingredientCost: 3500,
        grossProfit: 11480,
        lines: {
          create: [
            {
              menuItemId: first.id,
              menuName: "สินค้าทดสอบรายงาน",
              qty: 2,
              unitPrice: 6000,
              lineTotal: 12000,
              ingredientCost: 3000,
              netPayout: 11984,
              note: "",
              optionsJson: first.groups[0].items,
            },
            {
              menuItemId: second.id,
              menuName: second.name,
              qty: 1,
              unitPrice: 3000,
              lineTotal: 3000,
              ingredientCost: 500,
              netPayout: 2996,
              note: "",
              optionsJson: [],
            },
          ],
        },
        payments: {
          create: {
            method: "CASH",
            amount: 14980,
            tendered: 20000,
            change: 5020,
          },
        },
      },
    });
    await db.auditLog.create({
      data: {
        userId: boot.user.id,
        action: "DISCOUNT",
        entity: "Order",
        entityId: paidId,
        beforeJson: {},
        afterJson: { kind: "BAHT", amount: 1000, reason: "ทดสอบส่วนลดรายงาน" },
      },
    });
    await db.order.create({
      data: {
        ...common,
        id: voidId,
        clientUuid: voidId,
        orderNo: `VOID-${voidId.slice(0, 8)}`,
        queueNo: "R2",
        localSequence: 2,
        status: "VOIDED",
        voidedAt: at,
        voidReason: "ทดสอบยกเลิก",
        subtotal: 5000,
        discount: 0,
        tax: 0,
        total: 5000,
        netPayout: 5000,
        ingredientCost: 1000,
        grossProfit: 4000,
        payments: {
          create: {
            method: "CASH",
            amount: 5000,
            tendered: 5000,
            change: 0,
            reversedAt: at,
          },
        },
      },
    });
    const range = "from=2001-01-01&to=2001-01-01";
    const api = await page.request.get(`/api/reports?${range}`);
    expect(api.ok()).toBe(true);
    const data = reportSchema.parse(await api.json());
    expect(data.summary).toMatchObject({
      bills: 1,
      sales: 14980,
      profit: 11480,
    });
    expect(data.categories.reduce((n, r) => n + r.sales, 0)).toBe(
      data.summary.sales,
    );
    expect(data.categories.some((r) => r.name === "หมวดหมู่ ณ วันขาย")).toBe(
      true,
    );
    expect(data.employees[0]).toMatchObject({ bills: 1, sales: 14980 });
    expect(data.paymentSales).toEqual([
      { method: "CASH", bills: 1, amount: 14980 },
    ]);
    expect(data.payments).toEqual([
      { method: "CASH", received: 19980, reversed: 5000, net: 14980 },
    ]);
    expect(data.receipts).toHaveLength(2);
    expect(data.options[0]).toMatchObject({ qty: 2, sales: 2000 });
    expect(data.discounts[0].reason).toBe("ทดสอบส่วนลดรายงาน");
    expect(data.taxes).toEqual([
      { rateBps: 700, bills: 1, base: 14000, tax: 980, total: 14980 },
    ]);
    await page.goto(`/reports?${range}`);
    for (const section of reportSections) {
      await page
        .getByRole("navigation", { name: "ประเภทรายงาน" })
        .getByRole("link", { name: section.label, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: section.label, exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("กำลังโหลดรายงาน…")).toHaveCount(0);
      expect(page.url()).toContain(range);
      await noOverflow(page);
    }
    await page.screenshot({ path: "artifacts/reports-desktop.png" });
    await page.goto(`/reports/receipts?${range}`);
    await page.getByLabel("สถานะใบเสร็จ").selectOption("VOIDED");
    await expect(page.getByRole("table")).toContainText(
      `VOID-${voidId.slice(0, 8)}`,
    );
    await expect(page.getByRole("table")).not.toContainText(
      `REPORT-${paidId.slice(0, 8)}`,
    );
    await page.getByLabel("สถานะใบเสร็จ").selectOption("PAID");
    await page.getByLabel("ค้นหาในรายงาน").fill("REPORT-");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "ส่งออก CSV", exact: true }).click();
    const download = await downloadPromise;
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv).toContain('"149.80"');
    expect(csv).toContain('"9.80"');
    expect(csv).not.toContain(`VOID-${voidId.slice(0, 8)}`);
    await page
      .getByRole("link", { name: `REPORT-${paidId.slice(0, 8)}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "บิลต้นทาง" }),
    ).toBeVisible();
    await expect(
      page.getByText("สินค้าทดสอบรายงาน", { exact: false }),
    ).toBeVisible();
    await page.goto(`/reports/products?${range}`);
    await page.getByLabel("วันที่เริ่ม (ค.ศ.)").fill("2001-01-02");
    await page.getByRole("button", { name: "แสดงรายงาน", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "วันเริ่มต้องไม่เกิน" }),
    ).toBeVisible();
    expect(page.url()).toContain(range);
    await page.getByLabel("วันที่เริ่ม (ค.ศ.)").fill("2001-01-01");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const section of reportSections) {
        await page.getByLabel("เลือกรายงาน").selectOption(section.id);
        await expect(
          page
            .getByRole("heading", { name: section.label, exact: true })
            .first(),
        ).toBeVisible();
        await noOverflow(page);
      }
      await page.screenshot({ path: `artifacts/reports-mobile-${width}.png` });
    }
    await page.getByRole("button", { name: "เปิดเมนูหลัก" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("navigation", { name: "ประเภทรายงาน" })
        .getByRole("link"),
    ).toHaveCount(9);
    await page.screenshot({ path: "artifacts/reports-mobile-menu.png" });
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "ใบเสร็จรับเงิน", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/reports/options?from=2000-01-01&to=2000-01-01");
    await expect(page.getByText("ไม่มีข้อมูลในช่วงวันที่เลือก")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await db.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.catalogSnapshot.delete({ where: { id: snapshotId } });
    await db.device.delete({ where: { id: deviceId } });
  }
});

test("reports API rejects an unauthenticated request", async ({ request }) => {
  const result = await request.get(
    "/api/reports?from=2001-01-01&to=2001-01-01",
  );
  expect(result.status()).toBe(403);
});
