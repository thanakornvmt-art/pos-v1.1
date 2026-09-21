import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorized: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/http", () => ({
  authorized: mocks.authorized,
  sameOrigin: (req: Request) => {
    if (req.headers.get("origin") !== "https://test.local")
      throw new Error("origin");
  },
  body: (req: Request) => req.json(),
  fail: () => Response.json({ error: "denied" }, { status: 400 }),
}));
vi.mock("@/lib/db", () => ({
  prisma: { settings: { findUniqueOrThrow: mocks.find } },
}));
vi.mock("@/lib/transaction", () => ({
  serializable: (work: (tx: unknown) => Promise<void>) =>
    work({
      settings: { findUniqueOrThrow: mocks.find, update: mocks.update },
      auditLog: { create: mocks.audit },
    }),
}));
import { POST } from "@/app/api/print-settings/route";
import { receiptSettingsSchema } from "@/domain/printing";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorized.mockResolvedValue({ id: "owner" });
  mocks.find.mockResolvedValue({ receiptConfig: {}, shopName: "ร้าน" });
});
const request = (value: unknown) =>
  new Request("https://test.local/api/print-settings", {
    method: "POST",
    headers: {
      origin: "https://test.local",
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
it("requires owner and explicit confirmation, saves settings and audit together", async () => {
  const settings = receiptSettingsSchema.parse({
    paperWidth: "58",
    footer: "ขอบคุณ",
  });
  expect((await POST(request({ settings, confirmed: true }))).status).toBe(200);
  expect(mocks.authorized).toHaveBeenCalledWith(true);
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: "store" },
    data: { receiptConfig: settings },
  });
  expect(mocks.audit).toHaveBeenCalledWith({
    data: {
      userId: "owner",
      action: "RECEIPT_SETTINGS_UPDATED",
      entity: "Settings",
      entityId: "store",
      beforeJson: {},
      afterJson: settings,
    },
  });
});
it("rejects missing confirmation, invalid fields and forbidden users before writing", async () => {
  for (const value of [
    { settings: {} },
    { settings: { paperWidth: "100" }, confirmed: true },
  ])
    expect((await POST(request(value))).status).toBe(400);
  mocks.authorized.mockRejectedValue(new Error("forbidden"));
  expect((await POST(request({ settings: {}, confirmed: true }))).status).toBe(
    400,
  );
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
