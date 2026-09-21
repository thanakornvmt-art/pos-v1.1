import { test, expect, type Page } from "@playwright/test";
import { boot } from "../fixtures";

test.use({ serviceWorkers: "block" });

async function noHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="page-content"]');
    return {
      document: document.documentElement.scrollWidth <= window.innerWidth,
      content: !content || content.scrollWidth <= content.clientWidth,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].every(
        (el) => el.scrollWidth <= el.clientWidth,
      ),
    };
  });
  expect(widths).toEqual({ document: true, content: true, dialogs: true });
}

for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
]) {
  test(`พนักงาน เมนู ตะกร้า และรับเงิน ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const replies: Record<string, unknown> = {
        "/api/auth/session": {
          user: boot.user,
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
        "/api/bootstrap": { ...boot, expiresAt: Date.now() + 3600000 },
        "/api/health": { ok: true },
        "/api/availability": [],
        "/api/employees": {
          currentUserId: "owner",
          employees: [
            {
              ...boot.user,
              active: true,
              failedAttempts: 0,
              lockedUntil: null,
            },
          ],
        },
      };
      await route.fulfill({ json: replies[path] ?? {} });
    });
    await page.goto("/employees");
    await expect(
      page.getByRole("button", { name: "แก้ไขชื่อ / สิทธิ์" }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: `artifacts/responsive-employees-${size.width}.png`,
    });
    await page.getByRole("button", { name: "+ เพิ่มพนักงาน" }).click();
    await expect(page.getByRole("dialog")).toBeInViewport();
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "ปิด", exact: true }).click();
    if (size.width < 768) {
      await page.getByRole("button", { name: "เปิดเมนูหลัก" }).click();
      await page
        .getByRole("navigation", { name: "เมนูหลักมือถือ" })
        .getByRole("link", { name: "หน้าขาย (POS)" })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } else {
      await page
        .getByTestId("app-sidebar")
        .getByRole("link", { name: "หน้าขาย (POS)" })
        .click();
    }
    const checkout = page.getByTestId(
      size.width < 768 ? "checkout-mobile" : "checkout",
    );
    await expect(checkout).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: /โจ๊กหมู.*45/ }).click();
    await expect(checkout).toBeEnabled();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: `artifacts/responsive-pos-${size.width}.png`,
    });
    if (size.width < 768) {
      await page.getByRole("button", { name: "ตะกร้า (1)" }).click();
      await expect(
        page.getByRole("heading", { name: "บิลปัจจุบัน" }),
      ).toBeVisible();
      await expect(checkout).toBeInViewport({ ratio: 1 });
      await noHorizontalOverflow(page);
    }
    await checkout.click();
    await expect(page.getByTestId("confirm-payment")).toBeInViewport({
      ratio: 1,
    });
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "100", exact: true }).click();
    await expect(page.getByTestId("change")).toHaveText("฿55");
    await expect(page.getByTestId("confirm-payment")).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({
      path: `artifacts/responsive-payment-${size.width}.png`,
    });
    // Do not submit payment: these checks exercise layout without creating a sale.
    if (size.width === 390) {
      await page.getByRole("button", { name: "ปิด", exact: true }).click();
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.getByTestId("checkout")).toBeInViewport({ ratio: 1 });
      await expect(page.getByText("1 รายการ", { exact: true })).toBeVisible();
      await expect(page.getByTestId("app-sidebar")).toBeVisible();
      await noHorizontalOverflow(page);
      await page.setViewportSize(size);
      await expect(page.getByTestId("checkout-mobile")).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("button", { name: "ตะกร้า (1)" })).toBeVisible();
    }
  });
}
