import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  priceOrder,
  inputMoney,
  suggestedDeliveryPrice,
  allocateMoney,
} from "../../src/domain/pricing";
import { explodeBom, receiveCost } from "../../src/domain/inventory";
import { promptpayPayload, crc16 } from "../../src/domain/promptpay";
import { csvText } from "../../src/lib/csv";
import { catalog, line } from "../fixtures";
describe("เงินและราคา", () => {
  it("แปลงสตางค์โดยไม่เกิด float drift", () => {
    expect(inputMoney("0.29")).toBe(29);
    expect(() => inputMoney("1.001")).toThrow();
  });
  it("คิดตัวเลือก ส่วนลด GP เป็นสตางค์", () => {
    const p = priceOrder(
      catalog,
      "GRAB",
      [{ ...line, qty: 2, optionIds: ["egg"] }],
      { kind: "PERCENT", value: 1000, reason: "ลูกค้าประจำ" },
    );
    expect(p.subtotal).toBe(11000);
    expect(p.total).toBe(9900);
    expect(p.netPayout).toBe(6930);
  });
  it("ปฏิเสธตัวเลือกปลอม ซ้ำ และส่วนลดเกินยอด", () => {
    expect(() =>
      priceOrder(catalog, "TAKEAWAY", [{ ...line, optionIds: ["fake"] }]),
    ).toThrow();
    expect(() =>
      priceOrder(catalog, "TAKEAWAY", [{ ...line, optionIds: ["egg", "egg"] }]),
    ).toThrow();
    expect(() =>
      priceOrder(catalog, "DINE_IN", [line], {
        kind: "BAHT",
        value: 9000,
        reason: "ทดสอบ",
      }),
    ).toThrow();
  });
  it("ราคา GP และการปันส่วนรวมกลับได้พอดี", () => {
    expect(suggestedDeliveryPrice(7000, 3000)).toBe(10000);
    expect(allocateMoney(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});
describe("สูตรและสต็อก", () => {
  it("คลี่สูตรซ้อนตาม output qty และรวมวัตถุดิบซ้ำ", () => {
    const result = explodeBom(
      [{ ingredientId: null, subRecipeId: "a", qty: "2" }],
      [
        {
          id: "a",
          outputQty: "4",
          lines: [
            { ingredientId: null, subRecipeId: "b", qty: "8" },
            { ingredientId: "rice", subRecipeId: null, qty: "2" },
          ],
        },
        {
          id: "b",
          outputQty: "2",
          lines: [{ ingredientId: "rice", subRecipeId: null, qty: "3" }],
        },
      ],
    );
    expect(result.get("rice")?.toString()).toBe("7");
  });
  it("ป้องกันวงจรและ BOM กำกวม", () => {
    expect(() =>
      explodeBom(
        [{ ingredientId: null, subRecipeId: "a", qty: "1" }],
        [
          {
            id: "a",
            outputQty: "1",
            lines: [{ ingredientId: null, subRecipeId: "a", qty: "1" }],
          },
        ],
      ),
    ).toThrow("สูตรวนซ้ำ");
    expect(() =>
      explodeBom([{ ingredientId: "a", subRecipeId: "b", qty: "1" }], []),
    ).toThrow();
  });
  it("yield และ weighted average ตามหน่วยใช้จริง", () => {
    const r = receiveCost("1000", "10", "2", 24000, "1000", "80");
    expect(r.receivedQty.toString()).toBe("1600");
    expect(r.unitCost.toString()).toBe("15");
    expect(r.avgCost.eq(new Decimal(34000).div(2600))).toBe(true);
  });
});
describe("QR และ export", () => {
  it("CRC CCITT-FALSE known vector", () =>
    expect(crc16("123456789")).toBe("29B1"));
  it("EMV payload มี mobile proxy ยอด และ checksum", () => {
    const qr = promptpayPayload("0812345678", 5525);
    expect(qr).toContain("01130066812345678");
    expect(qr).toContain("540555.25");
    expect(qr.slice(-4)).toBe(crc16(qr.slice(0, -4)));
    expect(qr).toContain("010212");
  });
  it("CSV ป้องกัน spreadsheet formula injection", () =>
    expect(csvText([['=HYPERLINK("x")', "a,b"]])).toContain(
      '"\'=HYPERLINK(""x"")"',
    ));
});
