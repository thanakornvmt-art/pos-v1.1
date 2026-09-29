"use client";
import Decimal from "decimal.js";
import { z } from "zod";
import { reportSchema } from "@/domain/reports";
import { formatMoney, moneyToBaht } from "@/domain/pricing";
import { thaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PaymentReport } from "@/components/payment-report";
import type { ExportReport } from "./report-table";
export function ReportSummary({
  data,
  range,
  exportRows,
}: {
  data: z.infer<typeof reportSchema>;
  range: { from: string; to: string };
  exportRows: ExportReport;
}) {
  return (
    <div className="space-y-6">
      <PaymentReport data={data} from={range.from} to={range.to} />
      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["ยอดขาย", formatMoney(data.summary.sales)],
          ["รับสุทธิหลัง GP", formatMoney(data.summary.net)],
          ["กำไรขั้นต้น", formatMoney(data.summary.profit)],
          [
            "Food cost",
            data.summary.foodCostBps === null
              ? "—"
              : new Decimal(data.summary.foodCostBps).div(100).toFixed(1) + "%",
          ],
        ].map(([label, value]) => (
          <section className="rounded-xl bg-white p-5" key={label}>
            <p>{label}</p>
            <strong className="text-3xl">{value}</strong>
          </section>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() =>
          exportRows(
            "ภาพรวม",
            ["บิล", "ยอดขาย", "รับสุทธิ", "ต้นทุนอาหาร", "บรรจุภัณฑ์", "กำไร"],
            [
              [
                data.summary.bills,
                moneyToBaht(data.summary.sales),
                moneyToBaht(data.summary.net),
                moneyToBaht(data.summary.food),
                moneyToBaht(data.summary.packaging),
                moneyToBaht(data.summary.profit),
              ],
            ],
          )
        }
      >
        Export ภาพรวม CSV
      </Button>
      <section className="rounded-xl bg-white p-5">
        <h2 className="mb-3 text-xl font-bold">ยอดขายรายวัน</h2>
        {data.daily.map((d) => (
          <div key={d.date} className="flex justify-between border-b py-3">
            <span>{thaiDate(d.date + "T00:00:00+07:00")}</span>
            <span>
              {d.bills} บิล · {formatMoney(d.sales)}
            </span>
          </div>
        ))}
        <Button
          variant="outline"
          className="mt-3"
          onClick={() =>
            exportRows(
              "ยอดรายวัน",
              ["วันที่", "บิล", "ยอดขาย", "กำไร"],
              data.daily.map((d) => [
                d.date,
                d.bills,
                moneyToBaht(d.sales),
                moneyToBaht(d.profit),
              ]),
            )
          }
        >
          Export CSV
        </Button>
      </section>
      <section className="rounded-xl bg-white p-5">
        <h2 className="mb-3 text-xl font-bold">ความหนาแน่นรายชั่วโมง</h2>
        <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
          {data.hourly.map((h) => (
            <div
              key={h.hour}
              className="rounded-xl border border-amber-200 p-3"
              style={{
                backgroundColor: `rgba(251,189,20,${0.12 + (0.88 * h.bills) / Math.max(1, ...data.hourly.map((v) => v.bills))})`,
              }}
            >
              <strong>{String(h.hour).padStart(2, "0")}:00</strong>
              <p>{h.bills} บิล</p>
              <p>{formatMoney(h.sales)}</p>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() =>
            exportRows(
              "รายชั่วโมง",
              ["ชั่วโมง", "บิล", "ยอดขาย"],
              data.hourly.map((h) => [h.hour, h.bills, moneyToBaht(h.sales)]),
            )
          }
        >
          Export CSV
        </Button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ["Top 10", data.menus.slice(0, 10)],
          [
            "Bottom 10",
            [...data.menus].sort((a, b) => a.qty - b.qty).slice(0, 10),
          ],
        ].map(([title, rows]) => (
          <section className="rounded-xl bg-white p-5" key={String(title)}>
            <h2 className="mb-3 text-xl font-bold">
              {String(title)} เมนูตามจำนวนขาย
            </h2>
            {typeof rows !== "string" &&
              rows.map((m) => (
                <div className="flex justify-between border-b py-3" key={m.id}>
                  <span>{m.name}</span>
                  <span>
                    {m.qty} จาน · ต้นทุน{" "}
                    {m.foodCostBps === null
                      ? "—"
                      : new Decimal(m.foodCostBps).div(100).toFixed(1) + "%"}
                  </span>
                </div>
              ))}
          </section>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() =>
          exportRows(
            "เมนู",
            [
              "เมนู",
              "จำนวน",
              "ยอดขายก่อนส่วนลด",
              "อาหาร",
              "บรรจุภัณฑ์",
              "รับสุทธิ",
              "กำไร",
              "Food cost %",
            ],
            data.menus.map((m) => [
              m.name,
              m.qty,
              moneyToBaht(m.sales),
              moneyToBaht(m.food),
              moneyToBaht(m.packaging),
              moneyToBaht(m.net),
              moneyToBaht(m.profit),
              m.foodCostBps === null
                ? null
                : new Decimal(m.foodCostBps).div(100).toNumber(),
            ]),
          )
        }
      >
        Export ทุกเมนู CSV
      </Button>
      <section className="rounded-xl bg-white p-5">
        <h2 className="mb-3 text-xl font-bold">กำไรหน้าร้านเทียบเดลิเวอรี่</h2>
        {data.channels.map((c) => (
          <p className="py-3" key={c.group}>
            {c.group} · ยอด {formatMoney(c.sales)} · รับสุทธิ{" "}
            {formatMoney(c.net)} · กำไร {formatMoney(c.profit)}
          </p>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            exportRows(
              "กำไรช่องทาง",
              [
                "กลุ่ม",
                "ยอดขาย",
                "สุทธิหลัง GP",
                "อาหาร",
                "บรรจุภัณฑ์",
                "กำไร",
              ],
              data.channels.map((c) => [
                c.group,
                moneyToBaht(c.sales),
                moneyToBaht(c.net),
                moneyToBaht(c.food),
                moneyToBaht(c.packaging),
                moneyToBaht(c.profit),
              ]),
            )
          }
        >
          Export CSV
        </Button>
      </section>
      {[
        { name: "ของเสีย", rows: data.waste },
        { name: "ผลต่างนับสต็อก", rows: data.variance },
      ].map((section) => (
        <section key={section.name} className="rounded-xl bg-white p-5">
          <h2 className="mb-3 text-xl font-bold">{section.name}</h2>
          {section.rows.map((r, i) => (
            <p key={i} className="border-b py-3">
              {thaiDate(r.date)} · {r.name} · {r.qty} · {formatMoney(r.value)} ·{" "}
              {r.reason}
            </p>
          ))}
          <Button
            className="mt-3"
            variant="outline"
            onClick={() =>
              exportRows(
                section.name,
                ["วันที่", "วัตถุดิบ", "จำนวน", "มูลค่า", "เหตุผล"],
                section.rows.map((r) => [
                  thaiDate(r.date),
                  r.name,
                  r.qty,
                  moneyToBaht(r.value),
                  r.reason,
                ]),
              )
            }
          >
            Export CSV
          </Button>
        </section>
      ))}
      <section className="rounded-xl bg-white p-5">
        <h2 className="mb-3 text-xl font-bold">ปิดร้าน / เงินสด</h2>
        {data.closes.map((c) => (
          <p key={c.businessDate} className="py-3">
            {thaiDate(c.businessDate + "T00:00:00+07:00")} · ควรมี{" "}
            {formatMoney(c.expectedCash)} · นับจริง {formatMoney(c.actualCash)}{" "}
            · ต่าง {formatMoney(c.variance)}
          </p>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            exportRows(
              "ปิดร้าน",
              [
                "วันที่",
                "เงินเปิดลิ้นชัก",
                "ควรมี",
                "นับจริง",
                "ผลต่าง",
                "เหตุผล",
              ],
              data.closes.map((c) => [
                c.businessDate,
                moneyToBaht(c.openingCash),
                moneyToBaht(c.expectedCash),
                moneyToBaht(c.actualCash),
                moneyToBaht(c.variance),
                c.reason,
              ]),
            )
          }
        >
          Export CSV
        </Button>
      </section>
    </div>
  );
}
