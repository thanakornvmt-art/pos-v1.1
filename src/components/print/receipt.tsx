import type { Receipt, PrintJob } from "@/lib/offline/db";
import { receiptSettingsSchema, type ReceiptSettings } from "@/domain/printing";
import { channelNames, channelSchema } from "@/domain/schema";
import { formatMoney } from "@/domain/pricing";
import { thaiDate } from "@/lib/utils";

export function ReceiptView({
  receipt,
  kind,
  settings: override,
}: {
  receipt: Receipt;
  kind: PrintJob["kind"];
  settings?: ReceiptSettings;
}) {
  const settings =
    override ?? receiptSettingsSchema.parse(receipt.settings ?? {});
  const channel = channelSchema.safeParse(receipt.channel);
  return (
    <article
      data-testid="receipt-preview"
      className="receipt mx-auto max-w-full break-words bg-white p-3 text-black"
      style={{ width: `${settings.paperWidth}mm` }}
    >
      <h2 className="text-center text-xl font-bold">{receipt.shopName}</h2>
      <p className="text-center">
        {kind === "KITCHEN" ? "ใบครัว" : "ใบเสร็จรับเงิน"}
      </p>
      {kind === "CUSTOMER" && settings.header && (
        <p className="my-2 whitespace-pre-wrap text-center">
          {settings.header}
        </p>
      )}
      {settings.showQueue && (
        <p className="my-3 text-center text-3xl font-bold">
          คิว {receipt.queueNo}
        </p>
      )}
      <p>{thaiDate(receipt.createdAt)}</p>
      <p className="break-all">{receipt.orderNo}</p>
      <p>{channel.success ? channelNames[channel.data] : receipt.channel}</p>
      {receipt.lines.map((line, index) => (
        <div key={index} className="border-b border-black py-2">
          <strong>
            {line.qty} × {line.name}
          </strong>
          {(kind === "KITCHEN" || settings.showOptions) && (
            <p>{line.options.join(", ")}</p>
          )}
          {line.note && <p>{line.note}</p>}
          {kind === "CUSTOMER" && (
            <p className="text-right">{formatMoney(line.total)}</p>
          )}
        </div>
      ))}
      {kind === "CUSTOMER" && (
        <div className="space-y-2 py-3">
          <p>ยอดรายการ {formatMoney(receipt.subtotal)}</p>
          <p>ส่วนลด {formatMoney(receipt.discount)}</p>
          <p>ภาษี {formatMoney(receipt.tax)}</p>
          <p className="text-2xl font-bold">รวม {formatMoney(receipt.total)}</p>
          <p>
            รับ {formatMoney(receipt.tendered)} · ทอน{" "}
            {formatMoney(receipt.change)}
          </p>
          {settings.footer && (
            <p className="whitespace-pre-wrap text-center">{settings.footer}</p>
          )}
        </div>
      )}
    </article>
  );
}
