import { z } from "zod";
import {
  catalogSchema,
  channelSchema,
  lineSchema,
  moneySchema,
} from "./schema";
import { receiptSettingsSchema } from "./printing";

export const receiptSchema = z.object({
  settings: receiptSettingsSchema.optional(),
  shopName: z.string(),
  queueNo: z.string(),
  orderNo: z.string(),
  channel: z.string(),
  createdAt: z.string(),
  copy: z.boolean().optional(),
  voided: z.boolean().optional(),
  pendingSync: z.boolean().optional(),
  lines: z.array(
    z.object({
      name: z.string(),
      qty: z.number(),
      options: z.array(z.string()),
      note: z.string(),
      total: z.number(),
    }),
  ),
  subtotal: z.number(),
  discount: z.number(),
  tax: z.number(),
  total: z.number(),
  tendered: z.number(),
  change: z.number(),
  method: z.string(),
});
export const historyRowSchema = z.object({
  clientUuid: z.string(),
  orderNo: z.string(),
  queueNo: z.string(),
  total: z.number(),
  status: z.enum(["PAID", "VOIDED"]),
  createdAt: z.string(),
  channel: channelSchema,
});
export const historySchema = z.object({
  orders: z.array(historyRowSchema),
  nextCursor: z.string().nullable(),
});
export const orderDetailSchema = historyRowSchema.extend({
  id: z.string(),
  payloadHash: z.string(),
  discount: z.number(),
  receipt: receiptSchema,
  canEdit: z.boolean(),
  catalog: catalogSchema.optional(),
  editLines: z.array(lineSchema),
  replacementId: z.string().nullable(),
  replacesId: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export const amendmentSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedHash: z.string().length(64),
    lines: z.array(lineSchema).min(1).max(100),
    channel: channelSchema,
    discount: moneySchema,
    total: moneySchema,
    reason: z.string().trim().min(3).max(200),
    settled: z.literal(true),
    settlementRef: z.string().trim().max(100),
  })
  .strict();
export type Amendment = z.infer<typeof amendmentSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
