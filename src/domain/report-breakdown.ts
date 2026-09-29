import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { allocateMoney } from "./pricing";
import type { ReportSales } from "./report-sales";

export type ReportOrder = Prisma.OrderGetPayload<{
  include: { lines: true; payments: true; user: { select: { name: true } } };
}>;
const snapshotSchema = z.object({
  settings: z.object({ taxBps: z.number() }),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  menus: z.array(
    z.object({
      id: z.string(),
      categoryId: z.string(),
      groups: z.array(
        z.object({
          name: z.string(),
          items: z.array(z.object({ id: z.string() })),
        }),
      ),
    }),
  ),
});
const optionsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), priceDelta: z.number() }),
);
const discountSchema = z.object({ reason: z.string(), kind: z.string() });

// Use saved satang amounts and catalog snapshots, never today's prices or tax settings.
export function reportBreakdown(
  orders: ReportOrder[],
  snapshots: { id: string; data: unknown }[],
  discountLogs: { entityId: string; afterJson: unknown }[],
): ReportSales {
  const catalogs = new Map(
    snapshots.map((snapshot) => {
      const data = snapshotSchema.parse(snapshot.data);
      return [
        snapshot.id,
        {
          taxBps: data.settings.taxBps,
          categories: new Map(data.categories.map((c) => [c.id, c.name])),
          menus: new Map(data.menus.map((m) => [m.id, m])),
        },
      ];
    }),
  );
  const logs = new Map(
    discountLogs.map((log) => [
      log.entityId,
      discountSchema.safeParse(log.afterJson),
    ]),
  );
  const categories = new Map<string, ReportSales["categories"][number]>();
  const employees = new Map<string, ReportSales["employees"][number]>();
  const paymentSales = new Map<string, ReportSales["paymentSales"][number]>();
  const options = new Map<string, ReportSales["options"][number]>();
  const taxes = new Map<number | null, ReportSales["taxes"][number]>();
  const receipts: ReportSales["receipts"] = [];
  const discounts: ReportSales["discounts"] = [];
  for (const order of orders) {
    receipts.push({
      id: order.clientUuid,
      orderNo: order.orderNo,
      date: order.createdAt.toISOString(),
      employee: order.user.name,
      channel: order.channel,
      status: order.status,
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      total: order.total,
      methods: [...new Set(order.payments.map((p) => p.method))],
    });
    if (order.status !== "PAID") continue;
    const catalog = catalogs.get(order.catalogId);
    const employee = employees.get(order.createdBy) ?? {
      id: order.createdBy,
      name: order.user.name,
      bills: 0,
      sales: 0,
      discount: 0,
      net: 0,
      profit: 0,
    };
    employee.bills++;
    employee.sales += order.total;
    employee.discount += order.discount;
    employee.net += order.netPayout;
    employee.profit += order.grossProfit;
    employees.set(employee.id, employee);
    const paymentMethods = new Set<string>();
    for (const payment of order.payments) {
      if (payment.reversedAt) continue;
      const row = paymentSales.get(payment.method) ?? {
        method: payment.method,
        bills: 0,
        amount: 0,
      };
      row.amount += payment.amount; // Tendered cash includes change and is not revenue.
      if (!paymentMethods.has(payment.method)) row.bills++;
      paymentMethods.add(payment.method);
      paymentSales.set(payment.method, row);
    }
    if (order.discount > 0) {
      const log = logs.get(order.id);
      discounts.push({
        id: order.clientUuid,
        orderNo: order.orderNo,
        date: order.createdAt.toISOString(),
        employee: order.user.name,
        subtotal: order.subtotal,
        discount: order.discount,
        total: order.total,
        reason: log?.success ? log.data.reason : "ไม่พบเหตุผลในประวัติ",
        kind: log?.success ? log.data.kind : "UNKNOWN",
      });
    }
    const rate = catalog?.taxBps ?? null;
    const tax = taxes.get(rate) ?? {
      rateBps: rate,
      bills: 0,
      base: 0,
      tax: 0,
      total: 0,
    };
    tax.bills++;
    tax.base += order.subtotal - order.discount;
    tax.tax += order.tax;
    tax.total += order.total;
    taxes.set(rate, tax);
    const weights = order.lines.map((l) => l.lineTotal);
    const lineDiscounts = allocateMoney(order.discount, weights);
    const lineTaxes = allocateMoney(order.tax, weights);
    const seenCategories = new Set<string>();
    const seenOptions = new Set<string>();
    order.lines.forEach((line, index) => {
      const menu = catalog?.menus.get(line.menuItemId);
      const categoryId = menu?.categoryId ?? "unknown";
      const category = categories.get(categoryId) ?? {
        id: categoryId,
        name: catalog?.categories.get(categoryId) ?? "ไม่พบหมวดหมู่ในประวัติ",
        qty: 0,
        bills: 0,
        gross: 0,
        discount: 0,
        tax: 0,
        sales: 0,
        net: 0,
        profit: 0,
      };
      category.qty += line.qty;
      category.gross += line.lineTotal;
      category.discount += lineDiscounts[index];
      category.tax += lineTaxes[index];
      category.sales +=
        line.lineTotal - lineDiscounts[index] + lineTaxes[index];
      category.net += line.netPayout;
      category.profit +=
        line.netPayout - line.ingredientCost - line.packagingCost;
      if (!seenCategories.has(categoryId)) category.bills++;
      seenCategories.add(categoryId);
      categories.set(categoryId, category);
      for (const option of optionsSchema.parse(line.optionsJson)) {
        const row = options.get(option.id) ?? {
          id: option.id,
          name: option.name,
          group:
            menu?.groups.find((g) => g.items.some((o) => o.id === option.id))
              ?.name ?? "ตัวเลือกเพิ่มเติม",
          qty: 0,
          bills: 0,
          sales: 0,
        };
        row.qty += line.qty;
        row.sales += option.priceDelta * line.qty;
        if (!seenOptions.has(option.id)) row.bills++;
        seenOptions.add(option.id);
        options.set(option.id, row);
      }
    });
  }
  const newest = (a: { date: string }, b: { date: string }) =>
    b.date.localeCompare(a.date);
  return {
    categories: [...categories.values()].sort((a, b) => b.sales - a.sales),
    employees: [...employees.values()].sort((a, b) => b.sales - a.sales),
    paymentSales: [...paymentSales.values()].sort(
      (a, b) => b.amount - a.amount,
    ),
    options: [...options.values()].sort((a, b) => b.qty - a.qty),
    taxes: [...taxes.values()].sort(
      (a, b) => (a.rateBps ?? -1) - (b.rateBps ?? -1),
    ),
    receipts: receipts.sort(newest),
    discounts: discounts.sort(newest),
  };
}
