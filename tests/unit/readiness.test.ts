import { describe, expect, it } from "vitest";
import { readJson } from "../../src/lib/read-json";
import { assertSameOrigin } from "../../src/lib/request-origin";
import { redactAudit, auditQuerySchema } from "../../src/domain/audit";
import { paymentReport } from "../../src/domain/payment-report";
import { dateBounds, dateRangeSchema } from "../../src/domain/reports";
describe("production readiness", () => {
  it("accepts configured public origin behind a proxy, rejects forged origins", () => {
    const request = (origin?: string) =>
      new Request("http://localhost:3000/api/bootstrap", {
        headers: origin ? { origin } : {},
      });
    expect(() =>
      assertSameOrigin(request("https://pos.example"), "https://pos.example"),
    ).not.toThrow();
    for (const origin of [
      undefined,
      "null",
      "https://evil.example",
      "http://pos.example",
      "https://pos.example.evil",
    ])
      expect(() =>
        assertSameOrigin(request(origin), "https://pos.example"),
      ).toThrow("ต้นทาง");
  });
  it("keeps receipt and reversal days independent and amounts in satang", () => {
    expect(
      paymentReport(
        [
          { method: "CASH", amount: 4500 },
          { method: "CARD", amount: 1029 },
        ],
        [{ method: "CASH", amount: 6000 }],
      ),
    ).toEqual([
      { method: "CARD", received: 1029, reversed: 0, net: 1029 },
      { method: "CASH", received: 4500, reversed: 6000, net: -1500 },
    ]);
  });
  it("uses Bangkok midnight and rejects normalized impossible dates", () => {
    expect(dateBounds("2026-09-27", "2026-09-27")).toEqual({
      gte: new Date("2026-09-26T17:00:00Z"),
      lt: new Date("2026-09-27T17:00:00Z"),
    });
    expect(
      dateRangeSchema.safeParse({ from: "2026-02-30", to: "2026-03-02" })
        .success,
    ).toBe(false);
    expect(
      dateRangeSchema.safeParse({ from: "2024-02-29", to: "2024-02-29" })
        .success,
    ).toBe(true);
    expect(
      auditQuerySchema.safeParse({
        from: "2026-09-27",
        to: "2026-09-27",
        cursor: "bad",
      }).success,
    ).toBe(false);
  });
  it("redacts nested credential fields in audit details", () => {
    expect(
      redactAudit({
        pinHash: "private",
        nested: [{ permit: "private", name: "owner" }],
      }),
    ).toEqual({
      pinHash: "[ปกปิด]",
      nested: [{ permit: "[ปกปิด]", name: "owner" }],
    });
  });
  it("reads valid UTF-8 JSON", async () => {
    expect(
      await readJson(
        new Request("http://local", {
          method: "POST",
          body: JSON.stringify({ name: "โจ๊ก" }),
        }),
      ),
    ).toEqual({ name: "โจ๊ก" });
  });
  it("limits bytes even without content-length", async () => {
    await expect(
      readJson(
        new Request("http://local", { method: "POST", body: '"กกก"' }),
        8,
      ),
    ).rejects.toThrow("ข้อมูลใหญ่เกินกำหนด");
  });
  it("does not echo invalid JSON or credentials", async () => {
    await expect(
      readJson(
        new Request("http://local", {
          method: "POST",
          body: '{"secret":"private"',
        }),
      ),
    ).rejects.toThrow(/^ข้อมูล JSON ไม่ถูกต้อง$/);
  });
});
