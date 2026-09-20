import { z } from "zod";
export const dateRangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => {
    const from = new Date(v.from + "T00:00:00+07:00");
    const to = new Date(v.to + "T00:00:00+07:00");
    return (
      Number.isFinite(from.getTime()) &&
      Number.isFinite(to.getTime()) &&
      from <= to &&
      to.getTime() - from.getTime() <= 366 * 86400000
    );
  }, "เลือกช่วงวันไม่เกิน 366 วัน");
export function dateBounds(from: string, to: string) {
  dateRangeSchema.parse({ from, to });
  return {
    gte: new Date(from + "T00:00:00+07:00"),
    lt: new Date(new Date(to + "T00:00:00+07:00").getTime() + 86400000),
  };
}
export const reportSchema = z.object({
  summary: z.object({
    bills: z.number(),
    sales: z.number(),
    net: z.number(),
    food: z.number(),
    packaging: z.number(),
    profit: z.number(),
    foodCostBps: z.number().nullable(),
  }),
  daily: z.array(
    z.object({
      date: z.string(),
      bills: z.number(),
      sales: z.number(),
      profit: z.number(),
    }),
  ),
  hourly: z.array(
    z.object({ hour: z.number(), bills: z.number(), sales: z.number() }),
  ),
  menus: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      qty: z.number(),
      sales: z.number(),
      food: z.number(),
      packaging: z.number(),
      net: z.number(),
      profit: z.number(),
      foodCostBps: z.number().nullable(),
    }),
  ),
  channels: z.array(
    z.object({
      group: z.string(),
      sales: z.number(),
      net: z.number(),
      food: z.number(),
      packaging: z.number(),
      profit: z.number(),
    }),
  ),
  waste: z.array(
    z.object({
      date: z.string(),
      name: z.string(),
      qty: z.string(),
      value: z.number(),
      reason: z.string(),
    }),
  ),
  variance: z.array(
    z.object({
      date: z.string(),
      name: z.string(),
      qty: z.string(),
      value: z.number(),
      reason: z.string(),
    }),
  ),
  closes: z.array(
    z.object({
      businessDate: z.string(),
      openingCash: z.number(),
      expectedCash: z.number(),
      actualCash: z.number(),
      variance: z.number(),
      reason: z.string(),
    }),
  ),
});
