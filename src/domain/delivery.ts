import { z } from "zod";
import { channelSchema, lineSchema, catalogSchema } from "./schema";
export const stages = [
  "RECEIVED",
  "COOKING",
  "WAITING_DRIVER",
  "SENT",
] as const;
export const stageNames = {
  RECEIVED: "รับออเดอร์",
  COOKING: "กำลังทำ",
  WAITING_DRIVER: "รอคนขับ",
  SENT: "ส่งแล้ว",
};
export const ticketSchema = z.object({
  id: z.string().uuid(),
  channel: channelSchema,
  externalRef: z.string(),
  lines: z.array(lineSchema),
  total: z.number().int(),
  netPayout: z.number().int(),
  stage: z.enum(stages),
  paidOrderUuid: z.string().nullable(),
  createdAt: z.string(),
  catalogId: z.string(),
});
export const deliveryView = z.object({
  tickets: z.array(ticketSchema),
  catalog: catalogSchema,
  catalogId: z.string(),
  availability: z.array(
    z.object({ id: z.string(), name: z.string(), soldOut: z.boolean() }),
  ),
});
