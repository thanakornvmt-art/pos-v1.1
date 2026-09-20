import Decimal from "decimal.js";
import {
  catalogSchema,
  lineSchema,
  discountSchema,
  type CartLine,
  type Catalog,
  type Channel,
  type Discount,
} from "./schema";
export const roundMoney = (n: Decimal.Value): number =>
  new Decimal(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
export function allocateMoney(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (!sum) return weights.map((_, i) => (i === 0 ? amount : 0));
  const shares = weights.map((w) =>
    new Decimal(amount).mul(w).div(sum).floor().toNumber(),
  );
  let remainder = amount - shares.reduce((n, w) => n + w, 0);
  for (let i = 0; remainder > 0; i++, remainder--) shares[i % shares.length]++;
  return shares;
}
export function formatMoney(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: satang % 100 === 0 ? 0 : 2,
  }).format(new Decimal(satang).div(100).toNumber());
}
export function inputMoney(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value))
    throw new Error("กรอกจำนวนเงินให้ถูกต้อง");
  return roundMoney(new Decimal(value).mul(100));
}
export function suggestedDeliveryPrice(
  storePrice: number,
  feeBps: number,
): number {
  if (feeBps < 0 || feeBps >= 10000) throw new Error("GP ต้องน้อยกว่า 100%");
  return roundMoney(
    new Decimal(storePrice).div(
      new Decimal(1).minus(new Decimal(feeBps).div(10000)),
    ),
  );
}
export function priceOrder(
  catalog: Catalog,
  channel: Channel,
  input: CartLine[],
  discount: Discount | null = null,
) {
  catalogSchema.parse(catalog);
  const lines = input.map((raw) => {
    const line = lineSchema.parse(raw);
    const menu = catalog.menus.find((m) => m.id === line.menuItemId);
    if (!menu) throw new Error("ไม่พบเมนูในชุดราคานี้");
    const base = menu.prices.find((p) => p.channel === channel);
    if (!base) throw new Error("ไม่มีราคาสำหรับช่องทางนี้");
    if (new Set(line.optionIds).size !== line.optionIds.length)
      throw new Error("ตัวเลือกซ้ำ");
    const allowed = menu.groups.flatMap((g) => g.items);
    const options = line.optionIds.map((id) => {
      const option = allowed.find((o) => o.id === id);
      if (!option) throw new Error("ตัวเลือกไม่ตรงกับเมนู");
      return option;
    });
    for (const g of menu.groups) {
      const count = options.filter((o) =>
        g.items.some((i) => i.id === o.id),
      ).length;
      if (
        count < Math.max(g.minSelect, g.isRequired ? 1 : 0) ||
        count > g.maxSelect
      )
        throw new Error(`กรุณาเลือก ${g.name} ให้ครบตามกำหนด`);
    }
    const unitPrice = options.reduce((p, o) => p + o.priceDelta, base.price);
    return {
      ...line,
      menu,
      options,
      unitPrice,
      lineTotal: roundMoney(new Decimal(unitPrice).mul(line.qty)),
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  if (discount) discountSchema.parse(discount);
  const reduction = discount
    ? discount.kind === "BAHT"
      ? discount.value
      : roundMoney(new Decimal(subtotal).mul(discount.value).div(10000))
    : 0;
  if (reduction > subtotal) throw new Error("ส่วนลดเกินยอดบิล");
  const tax = roundMoney(
    new Decimal(subtotal - reduction).mul(catalog.settings.taxBps).div(10000),
  );
  const total = subtotal - reduction + tax;
  if (!Number.isSafeInteger(total) || total > 100_000_000)
    throw new Error("ยอดบิลเกินขีดจำกัด");
  const feeBps = catalog.fees.find((f) => f.channel === channel)?.feeBps;
  if (feeBps === undefined) throw new Error("ไม่พบการตั้งค่าช่องทาง");
  const platformFee = roundMoney(new Decimal(total).mul(feeBps).div(10000));
  return {
    lines,
    subtotal,
    discount: reduction,
    tax,
    total,
    platformFee,
    feeBps,
    netPayout: total - platformFee,
  };
}
