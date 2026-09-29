import { z } from "zod";
import { reportSalesSchema } from "./report-sales";
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "วันที่ไม่มีอยู่จริง");
export const dateRangeSchema = z
  .object({
    from: businessDateSchema,
    to: businessDateSchema,
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
  ...reportSalesSchema.shape,
  payments: z.array(
    z.object({
      method: z.string(),
      received: z.number(),
      reversed: z.number(),
      net: z.number(),
    }),
  ),
  voids: z.array(
    z.object({
      clientUuid: z.string(),
      orderNo: z.string(),
      total: z.number(),
      createdAt: z.string(),
      voidedAt: z.string(),
      reason: z.string(),
    }),
  ),
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
