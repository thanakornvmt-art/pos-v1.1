"use client";
import Link from "next/link";
import { z } from "zod";
import { reportSchema } from "@/domain/reports";
import { formatMoney, moneyToBaht } from "@/domain/pricing";
import { downloadCsv } from "@/lib/csv";
import { thaiDate } from "@/lib/utils";
import { Button } from "./ui/button";
const labels: Record<string, string> = {
  CASH: "เงินสด",
  PROMPTPAY: "PromptPay",
  CARD: "บัตร",
  COD: "เก็บเงินปลายทาง",
  CREDIT: "เครดิต",
};
export function PaymentReport({
  data,
  from,
  to,
}: {
  data: z.infer<typeof reportSchema>;
  from: string;
  to: string;
}) {
  return (
    <section className="space-y-4 rounded-xl bg-white p-5">
      <h2 className="text-xl font-bold">ยอดตามวิธีชำระและรายการยกเลิก</h2>
      <p>
        ยอดรับนับตามวันขาย ยอดยกเลิกนับตามวันที่ยกเลิก (เวลาไทย)
        การคืนเงินจริงต้องตรวจจากเงินสดหรือบัญชีธนาคาร
      </p>
      {data.payments.map((row) => (
        <p key={row.method}>
          {labels[row.method] ?? row.method} · รับ {formatMoney(row.received)} ·
          ยกเลิก {formatMoney(row.reversed)} · ผลต่าง {formatMoney(row.net)}
        </p>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          downloadCsv(`วิธีชำระ-${from}-${to}.csv`, [
            ["วิธีชำระ", "รับ (บาท)", "ยกเลิก (บาท)", "ผลต่าง (บาท)"],
            ...data.payments.map((row) => [
              labels[row.method] ?? row.method,
              moneyToBaht(row.received),
              moneyToBaht(row.reversed),
              moneyToBaht(row.net),
            ]),
          ])
        }
      >
        Export วิธีชำระ CSV
      </Button>
      <h3 className="font-bold">
        ยกเลิกในช่วงที่เลือก {data.voids.length} บิล ·{" "}
        {formatMoney(data.voids.reduce((sum, row) => sum + row.total, 0))}
      </h3>
      {data.voids.map((row) => (
        <div className="border-b py-2" key={row.clientUuid}>
          <Link className="underline" href={`/orders/${row.clientUuid}`}>
            {row.orderNo}
          </Link>{" "}
          · {formatMoney(row.total)}
          <p>
            ขาย {thaiDate(row.createdAt)} · ยกเลิก {thaiDate(row.voidedAt)} ·{" "}
            {row.reason}
          </p>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          downloadCsv(`ยกเลิก-${from}-${to}.csv`, [
            ["บิล", "วันขาย (ไทย)", "วันยกเลิก (ไทย)", "ยอด (บาท)", "เหตุผล"],
            ...data.voids.map((row) => [
              row.orderNo,
              thaiDate(row.createdAt),
              thaiDate(row.voidedAt),
              moneyToBaht(row.total),
              row.reason,
            ]),
          ])
        }
      >
        Export ยกเลิก CSV
      </Button>
    </section>
  );
}
