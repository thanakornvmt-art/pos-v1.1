import { receiptSettingsSchema } from "@/domain/printing";
import { channelNames, channelSchema } from "@/domain/schema";
import { formatMoney } from "@/domain/pricing";
import type { Receipt, PrintJob } from "@/lib/offline/db";
import { thaiDate } from "@/lib/utils";

// ESC/POS GS v 0 raster: one bit per pixel, high bit is the leftmost pixel.
export function rasterCommand(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    width > 576 ||
    width % 8 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 256 ||
    rgba.length !== width * height * 4
  )
    throw new Error("ขนาดภาพพิมพ์ไม่ถูกต้อง");
  const rowBytes = width / 8;
  const result = new Uint8Array(8 + rowBytes * height);
  result.set([
    0x1d,
    0x76,
    0x30,
    0,
    rowBytes & 255,
    rowBytes >> 8,
    height & 255,
    height >> 8,
  ]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const gray = (rgba[index] + rgba[index + 1] + rgba[index + 2]) / 3;
      const alpha = rgba[index + 3] / 255;
      if (gray * alpha + 255 * (1 - alpha) < 160)
        result[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  return result;
}
export async function encodeReceipt(
  receipt: Receipt,
  kind: PrintJob["kind"],
  test = false,
) {
  const settings = receiptSettingsSchema.parse(receipt.settings ?? {});
  await document.fonts.load('24px "Noto Sans Thai"');
  await document.fonts.load('700 32px "Noto Sans Thai"');
  if (!document.fonts.check('24px "Noto Sans Thai"'))
    throw new Error(
      "ฟอนต์ภาษาไทยยังไม่พร้อม กรุณาเปิดเว็บออนไลน์หนึ่งครั้งก่อนพิมพ์",
    );
  const width = settings.paperWidth === "58" ? 384 : 576;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("อุปกรณ์ไม่รองรับการสร้างภาพใบเสร็จ");
  const commands: Uint8Array[] = [Uint8Array.of(0x1b, 0x40)];
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  function row(text: string, large = false) {
    const size = large ? 32 : 24;
    const font = `${large ? "700" : "400"} ${size}px "Noto Sans Thai"`;
    function draw(value: string) {
      canvas.height = size + 20;
      context!.fillStyle = "white";
      context!.fillRect(0, 0, width, canvas.height);
      context!.font = font;
      context!.fillStyle = "black";
      context!.textBaseline = "alphabetic";
      context!.fillText(value, 8, size + 4);
      commands.push(
        rasterCommand(
          context!.getImageData(0, 0, width, canvas.height).data,
          width,
          canvas.height,
        ),
      );
    }
    for (const paragraph of text.split("\n")) {
      context!.font = font;
      let line = "";
      for (const { segment } of segmenter.segment(paragraph)) {
        if (line && context!.measureText(line + segment).width > width - 16) {
          draw(line);
          line = "";
          context!.font = font;
        }
        line += segment;
      }
      draw(line);
    }
  }
  if (test) row("*** ทดสอบเครื่องพิมพ์ ***", true);
  row(receipt.shopName, true);
  row(kind === "KITCHEN" ? "ใบครัว" : "ใบเสร็จรับเงิน");
  if (kind === "CUSTOMER" && settings.header) row(settings.header);
  if (settings.showQueue) row(`คิว ${receipt.queueNo}`, true);
  row(thaiDate(receipt.createdAt));
  row(receipt.orderNo);
  const channel = channelSchema.safeParse(receipt.channel);
  row(channel.success ? channelNames[channel.data] : receipt.channel);
  for (const line of receipt.lines) {
    row(`${line.qty} × ${line.name}`, true);
    if ((kind === "KITCHEN" || settings.showOptions) && line.options.length)
      row(line.options.join(", "));
    if (line.note) row(line.note);
    if (kind === "CUSTOMER") row(formatMoney(line.total));
  }
  if (kind === "CUSTOMER") {
    row(`ยอดรายการ ${formatMoney(receipt.subtotal)}`);
    row(
      `ส่วนลด ${formatMoney(receipt.discount)} · ภาษี ${formatMoney(receipt.tax)}`,
    );
    row(`รวม ${formatMoney(receipt.total)}`, true);
    row(
      `รับ ${formatMoney(receipt.tendered)} · ทอน ${formatMoney(receipt.change)}`,
    );
    if (settings.footer) row(settings.footer);
  }
  commands.push(Uint8Array.of(0x1b, 0x64, 3));
  const bytes = new Uint8Array(
    commands.reduce((total, command) => total + command.length, 0),
  );
  let offset = 0;
  for (const command of commands) {
    bytes.set(command, offset);
    offset += command.length;
  }
  return bytes;
}
