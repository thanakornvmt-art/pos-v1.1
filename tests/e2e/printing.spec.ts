import { test, expect, type Page } from "@playwright/test";
import { boot } from "../fixtures";
import { receiptSettingsSchema } from "../../src/domain/printing";
import type { PrintJob } from "../../src/lib/offline/db";
test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

async function mockApis(page: Page, owner = true) {
  let settings = receiptSettingsSchema.parse({ paperWidth: "58" });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { ...boot.user, role: owner ? "OWNER" : "CASHIER" };
    if (path === "/api/print-settings") {
      if (route.request().method() === "POST") {
        settings = receiptSettingsSchema.parse(
          route.request().postDataJSON().settings,
        );
        await route.fulfill({ json: { ok: true } });
      } else await route.fulfill({ json: { settings, shopName: "ร้านทดสอบ" } });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user,
        expires: new Date(Date.now() + 3600000).toISOString(),
      },
      "/api/bootstrap": {
        ...boot,
        user,
        catalog: {
          ...boot.catalog,
          settings: { ...boot.catalog.settings, receiptConfig: settings },
        },
      },
      "/api/health": { ok: true },
      "/api/sync/audits": { ok: true },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
}
async function seedJob(page: Page) {
  const job: PrintJob = {
    id: "test-printer-job",
    orderId: "00000000-0000-4000-8000-000000000003",
    kind: "CUSTOMER",
    state: "ready",
    receipt: {
      shopName: "ร้านทดสอบ",
      orderNo: "TEST-001",
      queueNo: "1",
      channel: "TAKEAWAY",
      createdAt: new Date().toISOString(),
      lines: [
        {
          name: "โจ๊กหมู",
          qty: 1,
          options: ["ไข่"],
          note: "ร้อน",
          total: 4500,
        },
      ],
      subtotal: 4500,
      discount: 0,
      tax: 0,
      total: 4500,
      tendered: 5000,
      change: 500,
      method: "CASH",
      settings: receiptSettingsSchema.parse({ paperWidth: "58" }),
    },
  };
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("morning-pos-v1");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["printJobs", "meta"], "readwrite");
        tx.objectStore("printJobs").put(value);
        tx.objectStore("meta").put({
          key: "printer-settings",
          value: JSON.stringify({
            service: "000018f0-0000-1000-8000-00805f9b34fb",
            characteristic: "00002af1-0000-1000-8000-00805f9b34fb",
            chunkSize: 180,
            delayMs: 5,
          }),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, job);
  await page.reload();
}

test("ตั้งค่าบิลและตัวอย่างบนมือถือ พร้อม fallback เมื่อไม่มี Web Bluetooth", async ({
  page,
}) => {
  await mockApis(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "bluetooth", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/print");
  await expect(
    page.getByRole("button", { name: "เชื่อมต่อบลูทูธ", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "ตั้งค่าบิล / เครื่องพิมพ์" }).click();
  await expect(page.getByLabel("กระดาษใบเสร็จ")).toHaveValue("58");
  await page.getByLabel("ข้อความท้ายบิล").fill("ขอบคุณที่อุดหนุน");
  await expect(page.getByTestId("receipt-preview")).toContainText(
    "ขอบคุณที่อุดหนุน",
  );
  await page
    .getByRole("button", { name: "บันทึกรูปแบบบิล", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยันบันทึกรูปแบบบิล" }).click();
  await expect(
    page.getByText("บันทึกแล้ว ใช้กับบิลใหม่ บิลเก่ายังคงรูปแบบเดิม"),
  ).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/print-settings-mobile.png" });
});

test("แคชเชียร์ดูได้แต่แก้รูปแบบบิลไม่ได้", async ({ page }) => {
  await mockApis(page, false);
  await page.goto("/print");
  await page.getByRole("button", { name: "ตั้งค่าบิล / เครื่องพิมพ์" }).click();
  await expect(page.getByLabel("ข้อความท้ายบิล")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "บันทึกรูปแบบบิล", exact: true }),
  ).toBeDisabled();
});

test("BLE จำลอง: ส่งข้อมูลภาษาไทย ยืนยันก่อนพิมพ์ซ้ำ และยืนยันกระดาษออก", async ({
  page,
}) => {
  await mockApis(page);
  await page.addInitScript(() => {
    const target = window as Window & { printerBytes?: number };
    target.printerBytes = 0;
    class Device extends EventTarget {
      name = "เครื่องพิมพ์ทดสอบ BLE";
      gatt = {
        connected: false,
        connect: async () => {
          this.gatt.connected = true;
          return {
            getPrimaryService: async () => ({
              getCharacteristic: async () => ({
                properties: { write: true, writeWithoutResponse: false },
                writeValueWithResponse: async (bytes: Uint8Array) => {
                  target.printerBytes =
                    (target.printerBytes ?? 0) + bytes.length;
                },
              }),
            }),
          };
        },
        disconnect: () => {
          this.gatt.connected = false;
          this.dispatchEvent(new Event("gattserverdisconnected"));
        },
      };
    }
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: { requestDevice: async () => new Device() },
    });
  });
  await page.goto("/print");
  await expect(
    page.getByRole("button", { name: "ตั้งค่าบิล / เครื่องพิมพ์" }),
  ).toBeVisible();
  await seedJob(page);
  await page
    .getByRole("button", { name: "เชื่อมต่อบลูทูธ", exact: true })
    .click();
  await expect(
    page.getByText("● เชื่อมต่อแล้ว: เครื่องพิมพ์ทดสอบ BLE"),
  ).toBeVisible();
  await page.getByRole("button", { name: "เปิดใบพิมพ์" }).click();
  await expect(page.getByTestId("receipt-preview")).toContainText("โจ๊กหมู");
  await page
    .getByRole("button", { name: "พิมพ์ผ่านบลูทูธ", exact: true })
    .click();
  await expect(
    page.getByText("ส่งข้อมูลครบแล้ว ตรวจว่ากระดาษออกครบก่อนกดยืนยันพิมพ์แล้ว"),
  ).toBeVisible({ timeout: 20000 });
  expect(
    await page.evaluate(
      () => (window as Window & { printerBytes?: number }).printerBytes,
    ),
  ).toBeGreaterThan(1000);
  await page
    .getByRole("button", { name: "พิมพ์ผ่านบลูทูธ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ยืนยันส่งพิมพ์ซ้ำ?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.screenshot({
    path: "artifacts/bluetooth-queue-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ยืนยันพิมพ์แล้ว", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await expect(page.getByText("ไม่มีงานพิมพ์ค้าง")).toBeVisible();
});
