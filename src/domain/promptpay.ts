import { z } from "zod";
export const promptpaySchema = z
  .string()
  .regex(/^(0\d{9}|\d{13})$/, "ใช้เบอร์โทร 10 หลัก หรือเลขประจำตัว 13 หลัก");
function tlv(tag: string, value: string) {
  return tag + String(value.length).padStart(2, "0") + value;
}
export function crc16(input: string) {
  let crc = 0xffff;
  for (const char of input) {
    crc ^= char.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
export function promptpayPayload(recipient: string, satang: number) {
  promptpaySchema.parse(recipient);
  z.number().int().positive().max(100_000_000).parse(satang);
  const id =
    recipient.length === 10
      ? tlv("01", "0066" + recipient.slice(1))
      : tlv("02", recipient);
  const amount = `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, "0")}`;
  const base =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("29", tlv("00", "A000000677010111") + id) +
    tlv("58", "TH") +
    tlv("53", "764") +
    tlv("54", amount) +
    "6304";
  return base + crc16(base);
}
