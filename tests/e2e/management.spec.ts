import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
test.beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes("/morning_pos_test")) throw new Error("Use isolated test database");
});
test.afterAll(async () => { await db.$disconnect(); });
async function login(page: Page, id = "owner", pin = "1234") {
  await page.goto("/login");
  await page.getByLabel("ผู้ใช้งาน").selectOption(id);
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "เข้าขายหน้าร้าน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "บิลปัจจุบัน" })).toBeVisible();
}
test("owner manages employees, reset invalidates session, deactivate preserves audit", async ({ page, browser }) => {
  await login(page);
  await page.getByRole("link", { name: "ตั้งค่าร้าน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ตั้งค่าร้าน" })).toBeVisible();
  await page.getByRole("link", { name: "จัดการพนักงาน", exact: true }).click();
  await page.getByRole("button", { name: "+ เพิ่มพนักงาน" }).click();
  const name = `ทดสอบพนักงาน ${Date.now()}`;
  await page.getByLabel("ชื่อพนักงาน").fill(name);
  await page.getByLabel("PIN ใหม่", { exact: true }).fill("6789");
  await page.getByLabel("ยืนยัน PIN ใหม่").fill("6780");
  await page.getByRole("button", { name: "ตรวจสอบและบันทึก" }).click();
  await expect(page.getByText("PIN ทั้งสองช่องไม่ตรงกัน")).toBeVisible();
  await page.getByLabel("ยืนยัน PIN ใหม่").fill("6789");
  await page.getByRole("button", { name: "ตรวจสอบและบันทึก" }).click();
  await page.getByRole("button", { name: "ยืนยันบันทึกพนักงาน" }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toBeVisible();
  const employee = await db.user.findFirstOrThrow({ where: { name } });
  const staffContext = await browser.newContext(); const staff = await staffContext.newPage();
  try {
    await login(staff, employee.id, "6789");
    expect((await staff.request.get("/api/employees")).status()).toBe(403);
    await card.getByRole("button", { name: "เปลี่ยน PIN" }).click();
    await page.getByLabel("PIN ใหม่", { exact: true }).fill("7890");
    await page.getByLabel("ยืนยัน PIN ใหม่").fill("7890");
    await page.getByLabel("เหตุผล", { exact: true }).fill("เปลี่ยนเพื่อทดสอบ");
    await page.getByRole("button", { name: "ตรวจสอบและบันทึก" }).click();
    await page.getByRole("button", { name: "ยืนยันบันทึกพนักงาน" }).click();
    await expect(page.getByText("บันทึกข้อมูลพนักงานแล้ว")).toBeVisible();
    expect((await staff.request.get("/api/manage")).status()).toBe(403);
    const denied = await staff.request.post("/api/bootstrap", { headers: { Origin: new URL(staff.url()).origin }, data: { deviceId: crypto.randomUUID() } });
    expect(denied.ok()).toBeFalsy();
    await login(staff, employee.id, "7890");
    await card.getByRole("button", { name: "ปิดใช้งาน", exact: true }).click();
    await page.getByLabel("เหตุผล", { exact: true }).fill("จบทดสอบบัญชี");
    await page.getByRole("button", { name: "ตรวจสอบและบันทึก" }).click();
    await page.getByRole("button", { name: "ยืนยันบันทึกพนักงาน" }).click();
    await expect(card.getByRole("button", { name: "เปิดใช้งาน", exact: true })).toBeVisible();
    await staff.goto("/login");
    await expect(staff.getByLabel("ผู้ใช้งาน").locator(`option[value="${employee.id}"]`)).toHaveCount(0);
    const origin = new URL(page.url()).origin;
    const self = await page.request.post("/api/employees", { headers: { Origin: origin }, data: { action: "active", id: "owner", active: false, reason: "ทดสอบป้องกัน", confirmed: true } });
    expect(self.ok()).toBeFalsy();
    const audit = await db.auditLog.findMany({ where: { entityId: employee.id } });
    expect(audit.filter(a => a.action !== "LOGIN")).toHaveLength(3);
    expect(JSON.stringify(audit.map(a => [a.beforeJson, a.afterJson]))).not.toMatch(/6789|7890|pinHash/);
    await page.screenshot({ path: "artifacts/employees.png", fullPage: true });
  } finally { await staffContext.close(); }
});

test("menu image upload, cache offline, remove with audit and reject invalid input", async ({ page, context }) => {
  await login(page);
  const menu = await db.menuItem.findFirstOrThrow({ orderBy: { sku: "asc" } });
  try {
    await page.getByRole("link", { name: "สูตรและต้นทุน", exact: true }).click();
    await expect(page.getByRole("button", { name: "ตั้งค่าร้าน", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "รูปเมนู", exact: true }).click();
    await page.getByRole("button", { name: `เพิ่ม / เปลี่ยนรูป ${menu.name}`, exact: true }).click();
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 100, height: 100 } });
    await page.getByLabel("เลือกรูปเมนู").setInputFiles({ name: "menu.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("button", { name: "บันทึกรูป", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "บันทึกรูป", exact: true }).click();
    await page.getByRole("dialog", { name: "ยืนยันเปลี่ยนรูปเมนู?" }).getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: menu.id } });
    expect(updated.imageUrl).toMatch(/^\/menu\/uploads\//);
    const response = await page.request.get(updated.imageUrl);
    expect(response.headers()["content-type"]).toBe("image/jpeg");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(async () => page.evaluate(async url => Boolean(await caches.match(url)), updated.imageUrl)).toBeTruthy();
    await context.setOffline(true);
    expect(await page.evaluate(async url => (await fetch(url)).ok, updated.imageUrl)).toBeTruthy();
    await context.setOffline(false);
    await page.getByRole("button", { name: `เพิ่ม / เปลี่ยนรูป ${menu.name}`, exact: true }).click();
    await page.getByRole("button", { name: "เอารูปออก", exact: true }).click();
    await page.getByRole("button", { name: "บันทึกรูป", exact: true }).click();
    await page.getByRole("dialog", { name: "ยืนยันเอารูปเมนูออก?" }).getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: menu.id } })).imageUrl).toBe("");
    const bad = await page.request.post("/api/menu-image", { headers: { Origin: new URL(page.url()).origin }, data: { menuId: menu.id, image: "data:image/jpeg;base64,aGVsbG8=", confirmed: true } });
    expect(bad.ok()).toBeFalsy();
    await page.screenshot({ path: "artifacts/menu-images.png", fullPage: true });
  } finally {
    await context.setOffline(false);
    await db.menuItem.update({ where: { id: menu.id }, data: { imageUrl: menu.imageUrl } });
  }
});
