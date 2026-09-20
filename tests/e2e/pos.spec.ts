import { test, expect, type Page } from "@playwright/test";

test("แถบบนและซ้ายคงอยู่เมื่อเปลี่ยนหน้า และกลับมาแล้วตะกร้ายังอยู่", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: /โจ๊กหมู ฿45/ })
    .first()
    .click();
  await page
    .getByTestId("app-header")
    .evaluate((el) => el.setAttribute("data-persistent-marker", "header"));
  await page
    .getByTestId("app-sidebar")
    .evaluate((el) => el.setAttribute("data-persistent-marker", "sidebar"));
  for (const [label, path] of [
    ["สูตรและต้นทุน", "/manage"],
    ["จัดการสต็อก", "/stock"],
    ["รายงาน", "/reports"],
    ["เดลิเวอรี่", "/delivery"],
    ["คิวพิมพ์", "/print"],
    ["หน้าขาย (POS)", "/pos"],
  ]) {
    await page
      .getByRole("navigation", { name: "เมนูหลัก" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(path + "$"));
    await expect(page.getByTestId("app-header")).toHaveAttribute(
      "data-persistent-marker",
      "header",
    );
    await expect(page.getByTestId("app-sidebar")).toHaveAttribute(
      "data-persistent-marker",
      "sidebar",
    );
    await expect(
      page
        .getByRole("navigation", { name: "เมนูหลัก" })
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
  await expect(page.getByTestId("checkout")).toBeInViewport();
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "จัดการสต็อก", exact: true })
    .click();
  await page.getByTestId("page-content").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId("app-header")).toBeInViewport();
  await expect(page.getByTestId("app-sidebar")).toBeInViewport();
  await page.screenshot({
    path: "artifacts/shared-shell-stock.png",
    fullPage: true,
  });
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
test("เงินสดสามแตะ ปุ่มไม่หลุดจอ ตัวเลือกแก้รายการเดิม และหน้าผู้จัดการ", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: /โจ๊กหมู ฿45/ })
    .first()
    .click();
  await expect(page.getByTestId("checkout")).toBeInViewport();
  await page.getByTestId("checkout").click();
  await page.getByRole("button", { name: "100", exact: true }).click();
  await expect(page.getByTestId("change")).toContainText("55");
  await page.getByTestId("confirm-payment").click();
  await expect(
    page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ขายบิลถัดไป" }).click();
  await page.screenshot({ path: "artifacts/pos-tablet.png", fullPage: true });
  await page.goto("/manage");
  await expect(
    page.getByRole("heading", { name: "สูตรและต้นทุน", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ เพิ่มวัตถุดิบ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "กำไรรายเมนู", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.goto("/stock");
  await expect(page.getByText(/ต่ำกว่า Par/)).toBeVisible();
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "รายงานเจ้าของร้าน" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ยอดขายรายวัน" }),
  ).toBeVisible();
});
test("ออฟไลน์หลัง reload เก็บบิล แล้วกลับมา sync ไม่ซ้ำ", async ({
  page,
  context,
}) => {
  await login(page);
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
  await page
    .getByRole("button", { name: /โจ๊กหมู ฿45/ })
    .first()
    .click();
  await page.getByTestId("checkout").click();
  await page.getByTestId("confirm-payment").click();
  await expect(
    page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ขายบิลถัดไป" }).click();
  await expect(page.getByText("รอส่ง 1 บิล")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("รอส่ง 0 บิล")).toBeVisible({ timeout: 25000 });
});
test("แคชเชียร์เปิด API รายงานและสต็อกไม่ได้", async ({ page }) => {
  await login(page, "cashier", "2345");
  const statuses = await page.evaluate(async () => {
    const reports = await fetch("/api/reports?from=2026-09-19&to=2026-09-19");
    const stock = await fetch("/api/stock");
    return [reports.status, stock.status];
  });
  expect(statuses).toEqual([403, 403]);
});

test("แก้ตัวเลือก แยกบิล รวมบิล และยืนยันส่วนลดมีเหตุผล", async ({ page }) => {
  await login(page);
  await page
    .getByRole("button", { name: /โจ๊กหมู ฿45/ })
    .first()
    .click();
  await page.getByRole("button", { name: "ตัวเลือก", exact: true }).click();
  await page.getByRole("button", { name: /ไข่ไก่/ }).click();
  await page
    .getByRole("button", { name: "บันทึกตัวเลือก", exact: true })
    .click();
  await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "เพิ่ม โจ๊กหมู", exact: true })
    .click();
  await page.getByRole("button", { name: "แยกบิล", exact: true }).click();
  await page.getByRole("spinbutton").fill("1");
  await page
    .getByRole("button", { name: "แยกเป็นบิลใหม่", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await page.getByRole("button", { name: "พัก / รวมบิล", exact: true }).click();
  await page
    .getByRole("button", { name: "รวมเข้าบิลนี้", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await expect(page.getByText("2 รายการ", { exact: true })).toBeVisible();
  await page.getByTestId("checkout").click();
  await page.getByRole("button", { name: "ส่วนลด / เหตุผล" }).click();
  await page.getByLabel("จำนวน", { exact: true }).fill("10");
  await page.getByLabel("เหตุผล", { exact: true }).fill("ทดสอบลูกค้าประจำ");
  await page.getByRole("button", { name: "ยืนยันส่วนลด", exact: true }).click();
  await page.getByTestId("confirm-payment").click();
  await expect(
    page.getByRole("heading", { name: "รับเงินแล้ว บันทึกบิลเรียบร้อย" }),
  ).toBeVisible();
});

test("ปุ่มชำระอยู่ในจอแท็บเล็ตแนวนอนและแนวตั้ง", async ({ page }) => {
  await login(page);
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("checkout")).toBeInViewport();
  }
});

test("บัญชีครัวเข้าคิวครัวและไม่มีสิทธิ์รายงาน", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption("kitchen");
  for (const n of "3456")
    await page.getByRole("button", { name: n, exact: true }).click();
  await page
    .getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "คิวครัว", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get("/api/reports?from=2026-09-19&to=2026-09-20")
    ).status(),
  ).toBe(403);
});
