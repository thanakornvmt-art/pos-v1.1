import { z } from "zod";

export const receiptSettingsSchema = z
  .object({
    paperWidth: z.enum(["58", "80"]).default("80"),
    header: z.string().trim().max(300).default(""),
    footer: z.string().trim().max(300).default(""),
    showQueue: z.boolean().default(true),
    showOptions: z.boolean().default(true),
  })
  .strict();
export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>;
export const receiptSettingsResponse = z.object({
  settings: receiptSettingsSchema,
  shopName: z.string(),
});

const uuid = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "UUID บลูทูธไม่ถูกต้อง",
  );
// Generic BLE receipt-printer service, documented by WebBluetoothReceiptPrinter.
export const printerSettingsSchema = z
  .object({
    service: uuid.default("000018f0-0000-1000-8000-00805f9b34fb"),
    characteristic: uuid.default("00002af1-0000-1000-8000-00805f9b34fb"),
    chunkSize: z.number().int().min(20).max(180).default(20),
    delayMs: z.number().int().min(5).max(100).default(10),
  })
  .strict();
export type PrinterSettings = z.infer<typeof printerSettingsSchema>;
