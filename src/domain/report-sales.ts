import { z } from "zod";

export const reportSalesSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      qty: z.number(),
      bills: z.number(),
      gross: z.number(),
      discount: z.number(),
      tax: z.number(),
      sales: z.number(),
      net: z.number(),
      profit: z.number(),
    }),
  ),
  employees: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      bills: z.number(),
      sales: z.number(),
      discount: z.number(),
      net: z.number(),
      profit: z.number(),
    }),
  ),
  paymentSales: z.array(
    z.object({ method: z.string(), bills: z.number(), amount: z.number() }),
  ),
  receipts: z.array(
    z.object({
      id: z.string(),
      orderNo: z.string(),
      date: z.string(),
      employee: z.string(),
      channel: z.string(),
      status: z.enum(["PAID", "VOIDED"]),
      subtotal: z.number(),
      discount: z.number(),
      tax: z.number(),
      total: z.number(),
      methods: z.array(z.string()),
    }),
  ),
  options: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      group: z.string(),
      qty: z.number(),
      bills: z.number(),
      sales: z.number(),
    }),
  ),
  discounts: z.array(
    z.object({
      id: z.string(),
      orderNo: z.string(),
      date: z.string(),
      employee: z.string(),
      subtotal: z.number(),
      discount: z.number(),
      total: z.number(),
      reason: z.string(),
      kind: z.string(),
    }),
  ),
  taxes: z.array(
    z.object({
      rateBps: z.number().nullable(),
      bills: z.number(),
      base: z.number(),
      tax: z.number(),
      total: z.number(),
    }),
  ),
});
export type ReportSales = z.infer<typeof reportSalesSchema>;
