"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { reportSchema } from "@/domain/reports";
import type { ReportSales } from "@/domain/report-sales";
import { channelNames, type Channel } from "@/domain/schema";
import {
  paymentNames,
  reportSections,
  type ReportView,
} from "@/domain/report-sections";
import { formatMoney, moneyToBaht } from "@/domain/pricing";
import {
  ReportTable,
  type ReportCell,
  type ReportRow,
  type ExportReport,
} from "./report-table";

type ReportData = z.infer<typeof reportSchema> & ReportSales;
const money = (value: number): ReportCell => ({
  value: moneyToBaht(value),
  display: formatMoney(value),
});
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
const bill = (id: string, orderNo: string): ReportCell => ({
  value: orderNo,
  display: (
    <Link
      className="font-semibold text-emerald-800 underline underline-offset-4"
      href={`/orders/${id}`}
    >
      {orderNo}
    </Link>
  ),
});

export function ReportDetails({
  view,
  data,
  exportRows,
}: {
  view: Exclude<ReportView, "summary">;
  data: ReportData;
  exportRows: ExportReport;
}) {
  const [status, setStatus] = useState("ALL");
  let headers: string[] = [];
  let rows: ReportRow[] = [];
  let description = "เฉพาะบิลชำระแล้วที่ไม่ยกเลิก · จำนวนเงินเป็นบาท";
  switch (view) {
    case "products":
      headers = [
        "สินค้า",
        "จำนวนขาย",
        "ยอดก่อนส่วนลด (บาท)",
        "ต้นทุนอาหาร (บาท)",
        "บรรจุภัณฑ์ (บาท)",
        "รับสุทธิหลัง GP (บาท)",
        "กำไรขั้นต้น (บาท)",
        "Food cost (%)",
      ];
      rows = data.menus.map((m) => ({
        id: m.id,
        cells: [
          m.name,
          m.qty,
          money(m.sales),
          money(m.food),
          money(m.packaging),
          money(m.net),
          money(m.profit),
          m.foodCostBps === null ? "—" : (m.foodCostBps / 100).toFixed(1),
        ],
      }));
      description +=
        " · ยอดก่อนส่วนลดรวมตัวเลือกเพิ่มเติม เรียงตามจำนวนขาย รวมสินค้าที่ยังไม่มียอดขาย";
      break;
    case "categories":
      headers = [
        "หมวดหมู่",
        "จำนวนขาย",
        "บิล",
        "ก่อนส่วนลด (บาท)",
        "ส่วนลด (บาท)",
        "ภาษี (บาท)",
        "ยอดขาย (บาท)",
        "กำไรขั้นต้น (บาท)",
      ];
      rows = data.categories.map((c) => ({
        id: c.id,
        cells: [
          c.name,
          c.qty,
          c.bills,
          money(c.gross),
          money(c.discount),
          money(c.tax),
          money(c.sales),
          money(c.profit),
        ],
      }));
      description +=
        " · ใช้หมวดหมู่ ณ วันขาย จัดสรรส่วนลดและภาษีตามมูลค่าสินค้า บิลเดียวอาจอยู่หลายหมวดหมู่";
      break;
    case "employees":
      headers = [
        "พนักงาน",
        "บิล",
        "ยอดขาย (บาท)",
        "ส่วนลด (บาท)",
        "เฉลี่ยต่อบิล (บาท)",
        "รับสุทธิหลัง GP (บาท)",
        "กำไรขั้นต้น (บาท)",
      ];
      rows = data.employees.map((e) => ({
        id: e.id,
        cells: [
          e.name,
          e.bills,
          money(e.sales),
          money(e.discount),
          money(Math.round(e.sales / Math.max(1, e.bills))),
          money(e.net),
          money(e.profit),
        ],
      }));
      description +=
        " · แยกตามผู้รับชำระบิล แสดงชื่อพนักงานปัจจุบัน รวมบัญชีที่ปิดใช้งานแล้ว";
      break;
    case "payments":
      headers = ["ประเภทการชำระเงิน", "บิล", "ยอดขายรับชำระ (บาท)"];
      rows = data.paymentSales.map((p) => ({
        id: p.method,
        cells: [paymentNames[p.method] ?? p.method, p.bills, money(p.amount)],
      }));
      description += " · เงินสดหักเงินทอนแล้ว ไม่รวมเงินเปิดลิ้นชัก";
      break;
    case "receipts":
      headers = [
        "เลขที่ใบเสร็จ",
        "วันเวลา",
        "พนักงาน",
        "ช่องทาง",
        "การชำระเงิน",
        "สถานะ",
        "ก่อนส่วนลด (บาท)",
        "ส่วนลด (บาท)",
        "ภาษี (บาท)",
        "ยอดรวม (บาท)",
      ];
      rows = data.receipts
        .filter((r) => status === "ALL" || r.status === status)
        .map((r) => ({
          id: r.id,
          cells: [
            bill(r.id, r.orderNo),
            dateTime(r.date),
            r.employee,
            channelNames[r.channel as Channel] ?? r.channel,
            r.methods.map((m) => paymentNames[m] ?? m).join(", "),
            {
              value: r.status === "PAID" ? "ชำระแล้ว" : "ยกเลิกแล้ว",
              display: (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${r.status === "PAID" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
                >
                  {r.status === "PAID" ? "ชำระแล้ว" : "ยกเลิกแล้ว"}
                </span>
              ),
            },
            money(r.subtotal),
            money(r.discount),
            money(r.tax),
            money(r.total),
          ],
        }));
      description =
        "เรียงจากบิลล่าสุดตามวันขาย · กดเลขที่ใบเสร็จเพื่อเปิดบิลต้นทาง · บิลยกเลิกแสดงเพื่อดูประวัติ และไม่นับในยอดขาย";
      break;
    case "options":
      headers = [
        "ตัวเลือกเพิ่มเติม",
        "กลุ่มตัวเลือก",
        "จำนวนขาย",
        "บิล",
        "ยอดเพิ่มก่อนส่วนลด (บาท)",
      ];
      rows = data.options.map((o) => ({
        id: o.id,
        cells: [o.name, o.group, o.qty, o.bills, money(o.sales)],
      }));
      description +=
        " · ใช้ราคาตัวเลือก ณ วันขาย คูณจำนวนสินค้า รวมตัวเลือกฟรี ยอดนี้รวมอยู่ในยอดขายสินค้าแล้ว";
      break;
    case "discounts":
      headers = [
        "เลขที่ใบเสร็จ",
        "วันเวลา",
        "พนักงาน",
        "รูปแบบ",
        "เหตุผล",
        "ก่อนส่วนลด (บาท)",
        "ส่วนลด (บาท)",
        "ยอดรวม (บาท)",
      ];
      rows = data.discounts.map((d) => ({
        id: d.id,
        cells: [
          bill(d.id, d.orderNo),
          dateTime(d.date),
          d.employee,
          d.kind === "BAHT"
            ? "จำนวนเงิน"
            : d.kind === "PERCENT"
              ? "เปอร์เซ็นต์"
              : "ไม่ระบุ",
          d.reason,
          money(d.subtotal),
          money(d.discount),
          money(d.total),
        ],
      }));
      description += " · แสดงส่วนลดที่ใช้จริงและเหตุผลจากประวัติการทำรายการ";
      break;
    case "taxes":
      headers = [
        "อัตราภาษี",
        "บิล",
        "ฐานหลังส่วนลด (บาท)",
        "ภาษีที่บันทึก (บาท)",
        "รวมภาษี (บาท)",
      ];
      rows = data.taxes.map((t) => ({
        id: String(t.rateBps),
        cells: [
          t.rateBps === null ? "ไม่พบอัตราในประวัติ" : `${t.rateBps / 100}%`,
          t.bills,
          money(t.base),
          money(t.tax),
          money(t.total),
        ],
      }));
      description +=
        " · อัตราภาษี ณ วันขาย รวมภาษีที่บันทึกในแต่ละบิลหลังปัดเศษแล้ว";
      break;
  }
  return (
    <div className="space-y-4">
      {view === "receipts" && (
        <label className="max-w-xs">
          สถานะใบเสร็จ
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">ทั้งหมด</option>
            <option value="PAID">ชำระแล้ว</option>
            <option value="VOIDED">ยกเลิกแล้ว</option>
          </select>
        </label>
      )}
      {view === "discounts" && (
        <p className="rounded-xl bg-amber-50 p-4 font-semibold">
          ส่วนลดรวม{" "}
          {formatMoney(data.discounts.reduce((sum, d) => sum + d.discount, 0))}{" "}
          · {data.discounts.length} บิล
        </p>
      )}
      {view === "taxes" && (
        <p className="rounded-xl bg-amber-50 p-4 font-semibold">
          ภาษีรวม {formatMoney(data.taxes.reduce((sum, t) => sum + t.tax, 0))}
        </p>
      )}
      <ReportTable
        key={`${view}-${status}`}
        title={reportSections.find((s) => s.id === view)!.label}
        description={description}
        headers={headers}
        rows={rows}
        exportRows={exportRows}
      />
      {view === "payments" && (
        <ReportTable
          title="เงินรับและคืนเงินตามวันที่เกิดรายการ"
          description="แสดงเงินรับตามวันขาย และเงินคืนตามวันที่ยกเลิก จึงอาจต่างจากยอดขายของบิลที่ยังไม่ยกเลิก"
          headers={[
            "ประเภทการชำระเงิน",
            "รับเงิน (บาท)",
            "คืนเงิน (บาท)",
            "เงินรับสุทธิ (บาท)",
          ]}
          rows={data.payments.map((p) => ({
            id: p.method,
            cells: [
              paymentNames[p.method] ?? p.method,
              money(p.received),
              money(p.reversed),
              money(p.net),
            ],
          }))}
          exportRows={exportRows}
        />
      )}
    </div>
  );
}
