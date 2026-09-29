import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  reportBreakdown,
  type ReportOrder,
} from "../../src/domain/report-breakdown";
import { dateBounds, dateRangeSchema } from "../../src/domain/reports";
import { reportSalesSchema } from "../../src/domain/report-sales";

const snapshot = {
  id: "old-catalog",
  data: {
    settings: { taxBps: 700 },
    categories: [
      { id: "food", name: "อาหาร ณ วันขาย" },
      { id: "drink", name: "เครื่องดื่ม" },
    ],
    menus: [
      {
        id: "porridge",
        categoryId: "food",
        groups: [{ name: "ไข่", items: [{ id: "egg" }, { id: "free" }] }],
      },
      { id: "tea", categoryId: "drink", groups: [] },
    ],
  },
};
const date = new Date("2026-09-26T17:01:00Z");
function order(overrides: Partial<ReportOrder> = {}): ReportOrder {
  const line = {
    id: "l1",
    orderId: "o1",
    menuItemId: "porridge",
    menuName: "โจ๊ก",
    qty: 2,
    unitPrice: 6000,
    lineTotal: 12000,
    optionsJson: [
      { id: "egg", name: "ไข่ไก่เดิม", priceDelta: 1000 },
      { id: "free", name: "ไม่ใส่ขิง", priceDelta: 0 },
    ],
    ingredientCost: 3000,
    packagingCost: 0,
    netPayout: 11770,
    note: "",
  };
  return {
    id: "o1",
    clientUuid: "00000000-0000-4000-8000-000000000001",
    payloadHash: "hash",
    deviceId: "dev",
    catalogId: "old-catalog",
    orderNo: "TEST-000001",
    localSequence: 1,
    queueNo: "1",
    channel: "DINE_IN",
    status: "PAID",
    fulfillmentStage: "RECEIVED",
    subtotal: 15000,
    discount: 1000,
    tax: 980,
    total: 14980,
    platformFeePercent: new Decimal(0),
    platformFee: 0,
    netPayout: 14980,
    ingredientCost: 3500,
    packagingCost: 0,
    grossProfit: 11480,
    createdBy: "owner",
    createdAt: date,
    syncedAt: date,
    voidedAt: null,
    voidReason: null,
    deletedAt: null,
    user: { name: "เจ้าของ" },
    lines: [
      line,
      {
        ...line,
        id: "l2",
        menuItemId: "tea",
        menuName: "ชา",
        qty: 1,
        unitPrice: 3000,
        lineTotal: 3000,
        optionsJson: [],
        ingredientCost: 500,
        netPayout: 3210,
      },
    ],
    payments: [
      {
        id: "p1",
        orderId: "o1",
        method: "CASH",
        amount: 14980,
        tendered: 20000,
        change: 5020,
        refNo: null,
        reversedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("sales report totals", () => {
  it("reconciles allocated category totals, employees, payments and taxes to a paid receipt", () => {
    const result = reportBreakdown(
      [order()],
      [snapshot],
      [
        {
          entityId: "o1",
          afterJson: { kind: "BAHT", reason: "ส่วนลดลูกค้าประจำ" },
        },
      ],
    );
    expect(reportSalesSchema.safeParse(result).success).toBe(true);
    expect(result.categories.reduce((sum, c) => sum + c.sales, 0)).toBe(14980);
    expect(result.categories.reduce((sum, c) => sum + c.discount, 0)).toBe(
      1000,
    );
    expect(result.categories.reduce((sum, c) => sum + c.tax, 0)).toBe(980);
    expect(result.categories[0]).toMatchObject({
      name: "อาหาร ณ วันขาย",
      qty: 2,
      bills: 1,
      gross: 12000,
      discount: 800,
      tax: 784,
      sales: 11984,
    });
    expect(result.employees[0]).toMatchObject({
      bills: 1,
      sales: 14980,
      discount: 1000,
    });
    expect(result.paymentSales).toEqual([
      { method: "CASH", bills: 1, amount: 14980 },
    ]);
    expect(result.taxes).toEqual([
      { rateBps: 700, bills: 1, base: 14000, tax: 980, total: 14980 },
    ]);
    expect(result.discounts[0]).toMatchObject({
      reason: "ส่วนลดลูกค้าประจำ",
      discount: 1000,
      kind: "BAHT",
    });
  });
  it("includes voids in receipts but excludes them from every sales aggregation", () => {
    const result = reportBreakdown(
      [order({ status: "VOIDED", voidedAt: date })],
      [snapshot],
      [],
    );
    expect(result.receipts).toHaveLength(1);
    for (const key of [
      "categories",
      "employees",
      "paymentSales",
      "options",
      "discounts",
      "taxes",
    ] as const)
      expect(result[key]).toEqual([]);
  });
  it("counts options by item quantity, keeps free options, and counts each bill once", () => {
    const first = order();
    const result = reportBreakdown(
      [
        order({
          lines: [...first.lines, { ...first.lines[0], id: "l3", qty: 3 }],
        }),
      ],
      [snapshot],
      [],
    );
    expect(result.options.find((o) => o.id === "egg")).toMatchObject({
      name: "ไข่ไก่เดิม",
      qty: 5,
      bills: 1,
      sales: 5000,
    });
    expect(result.options.find((o) => o.id === "free")).toMatchObject({
      qty: 5,
      sales: 0,
    });
    expect(result.categories.find((c) => c.id === "food")?.bills).toBe(1);
  });
  it("retains every satang when discount and tax do not divide evenly", () => {
    const first = order();
    const result = reportBreakdown(
      [
        order({
          subtotal: 3,
          discount: 1,
          tax: 1,
          total: 3,
          lines: first.lines.map((l, i) => ({ ...l, lineTotal: i + 1 })),
        }),
      ],
      [snapshot],
      [],
    );
    expect(result.categories.reduce((n, c) => n + c.sales, 0)).toBe(3);
    expect(result.categories.reduce((n, c) => n + c.discount, 0)).toBe(1);
    expect(result.categories.reduce((n, c) => n + c.tax, 0)).toBe(1);
  });
  it("counts split payments by method once and ignores reversed payment rows", () => {
    const p = order().payments[0];
    const result = reportBreakdown(
      [
        order({
          payments: [
            { ...p, amount: 1000 },
            { ...p, id: "p2", amount: 2000 },
            { ...p, id: "p3", method: "CARD", amount: 11980 },
            { ...p, id: "p4", amount: 999, reversedAt: date },
          ],
        }),
      ],
      [snapshot],
      [],
    );
    expect(result.paymentSales).toEqual([
      { method: "CARD", bills: 1, amount: 11980 },
      { method: "CASH", bills: 1, amount: 3000 },
    ]);
  });
  it("keeps tax rates from different catalog versions and handles fully discounted bills", () => {
    const zeroSnapshot = {
      id: "zero",
      data: { ...snapshot.data, settings: { taxBps: 0 } },
    };
    const result = reportBreakdown(
      [
        order(),
        order({
          id: "o2",
          catalogId: "zero",
          discount: 15000,
          total: 0,
          tax: 0,
        }),
      ],
      [snapshot, zeroSnapshot],
      [],
    );
    expect(result.taxes).toEqual([
      { rateBps: 0, bills: 1, base: 0, tax: 0, total: 0 },
      { rateBps: 700, bills: 1, base: 14000, tax: 980, total: 14980 },
    ]);
  });
  it("returns honest unknown labels for missing history and empty arrays for no sales", () => {
    const result = reportBreakdown([order()], [], []);
    expect(result.taxes[0].rateBps).toBeNull();
    expect(result.categories[0].name).toBe("ไม่พบหมวดหมู่ในประวัติ");
    expect(result.discounts[0].reason).toBe("ไม่พบเหตุผลในประวัติ");
    expect(
      Object.values(reportBreakdown([], [], [])).every(
        (rows) => rows.length === 0,
      ),
    ).toBe(true);
  });
});
describe("report dates", () => {
  it("uses inclusive Thai business dates with an exclusive next-day upper bound", () => {
    const bounds = dateBounds("2026-09-27", "2026-09-27");
    expect(bounds.gte.toISOString()).toBe("2026-09-26T17:00:00.000Z");
    expect(bounds.lt.toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });
  it.each([
    { from: "2026-02-30", to: "2026-03-02" },
    { from: "2026-09-28", to: "2026-09-27" },
    { from: "2024-01-01", to: "2026-09-27" },
  ])("rejects invalid range %j", (range) =>
    expect(dateRangeSchema.safeParse(range).success).toBe(false),
  );
});
