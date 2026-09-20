"use client";
import { localDb } from "@/lib/offline/db";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { reportSchema } from "@/domain/reports";
import { apiGet, apiPost } from "@/lib/client-api";
import { formatMoney, inputMoney } from "@/domain/pricing";
import { downloadCsv } from "@/lib/csv";
import { thaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminShell } from "@/components/admin-shell";
const today = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
export default function Reports() {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from, to });
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState("");
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["reports", range],
    queryFn: () =>
      apiGet(`/api/reports?from=${range.from}&to=${range.to}`, reportSchema),
  });
  const data = query.data;
  function exportRows(
    name: string,
    headers: string[],
    rows: (string | number | null)[][],
  ) {
    downloadCsv(`${name}-${range.from}-${range.to}.csv`, [headers, ...rows]);
  }
  async function closeDay() {
    if (busy) return;
    setBusy(true);
    try {
      if (await localDb.orders.where("state").anyOf("pending", "error").count())
        throw new Error("ส่งบิลค้างในเครื่องให้ครบก่อนปิดร้าน");
      await apiPost("/api/reports", {
        businessDate: range.to,
        openingCash: inputMoney(opening),
        actualCash: inputMoney(actual),
        reason,
        confirmed: true,
      });
      setClosing(false);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ปิดร้านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminShell title="รายงานเจ้าของร้าน">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label>
          เริ่ม (ค.ศ. ขณะกรอก)
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          ถึง
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button onClick={() => setRange({ from, to })}>แสดงรายงาน</Button>
        <Button variant="outline" onClick={() => setClosing(true)}>
          สรุปปิดร้าน
        </Button>
      </div>
      <p className="mb-4">
        {thaiDate(range.from + "T00:00:00+07:00")} –{" "}
        {thaiDate(range.to + "T23:59:59+07:00")} ·
        รวมเฉพาะบิลชำระแล้วที่ไม่ยกเลิก · Food cost ใช้ยอดอาหารก่อนส่วนลดและภาษี
      </p>
      {query.error && <p className="text-red-700">{query.error.message}</p>}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["ยอดขาย", formatMoney(data.summary.sales)],
              ["รับสุทธิหลัง GP", formatMoney(data.summary.net)],
              ["กำไรขั้นต้น", formatMoney(data.summary.profit)],
              [
                "Food cost",
                data.summary.foodCostBps === null
                  ? "—"
                  : new Decimal(data.summary.foodCostBps).div(100).toFixed(1) +
                    "%",
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
                [
                  "บิล",
                  "ยอดขายสตางค์",
                  "รับสุทธิ",
                  "ต้นทุนอาหาร",
                  "บรรจุภัณฑ์",
                  "กำไร",
                ],
                [
                  [
                    data.summary.bills,
                    data.summary.sales,
                    data.summary.net,
                    data.summary.food,
                    data.summary.packaging,
                    data.summary.profit,
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
                  ["วันที่", "บิล", "ยอดขายสตางค์", "กำไร"],
                  data.daily.map((d) => [d.date, d.bills, d.sales, d.profit]),
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
                  ["ชั่วโมง", "บิล", "ยอดขายสตางค์"],
                  data.hourly.map((h) => [h.hour, h.bills, h.sales]),
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
                    <div
                      className="flex justify-between border-b py-3"
                      key={m.id}
                    >
                      <span>{m.name}</span>
                      <span>
                        {m.qty} จาน · ต้นทุน{" "}
                        {m.foodCostBps === null
                          ? "—"
                          : new Decimal(m.foodCostBps).div(100).toFixed(1) +
                            "%"}
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
                  "ยอดขายก่อนส่วนลดสตางค์",
                  "อาหาร",
                  "บรรจุภัณฑ์",
                  "รับสุทธิ",
                  "กำไร",
                  "Food cost %",
                ],
                data.menus.map((m) => [
                  m.name,
                  m.qty,
                  m.sales,
                  m.food,
                  m.packaging,
                  m.net,
                  m.profit,
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
            <h2 className="mb-3 text-xl font-bold">
              กำไรหน้าร้านเทียบเดลิเวอรี่
            </h2>
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
                    "ยอดขายสตางค์",
                    "สุทธิหลัง GP",
                    "อาหาร",
                    "บรรจุภัณฑ์",
                    "กำไร",
                  ],
                  data.channels.map((c) => [
                    c.group,
                    c.sales,
                    c.net,
                    c.food,
                    c.packaging,
                    c.profit,
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
                  {thaiDate(r.date)} · {r.name} · {r.qty} ·{" "}
                  {formatMoney(r.value)} · {r.reason}
                </p>
              ))}
              <Button
                className="mt-3"
                variant="outline"
                onClick={() =>
                  exportRows(
                    section.name,
                    ["วันที่", "วัตถุดิบ", "จำนวน", "มูลค่าสตางค์", "เหตุผล"],
                    section.rows.map((r) => [
                      thaiDate(r.date),
                      r.name,
                      r.qty,
                      r.value,
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
                {formatMoney(c.expectedCash)} · นับจริง{" "}
                {formatMoney(c.actualCash)} · ต่าง {formatMoney(c.variance)}
              </p>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                exportRows(
                  "ปิดร้าน",
                  [
                    "วันที่",
                    "เงินเปิดลิ้นชักสตางค์",
                    "ควรมี",
                    "นับจริง",
                    "ผลต่าง",
                    "เหตุผล",
                  ],
                  data.closes.map((c) => [
                    c.businessDate,
                    c.openingCash,
                    c.expectedCash,
                    c.actualCash,
                    c.variance,
                    c.reason,
                  ]),
                )
              }
            >
              Export CSV
            </Button>
          </section>
        </div>
      )}
      <Dialog
        open={closing}
        onOpenChange={setClosing}
        title={`ยืนยันปิดร้าน · ${thaiDate(range.to + "T00:00:00+07:00")}`}
        description="ส่งบิลทุกเครื่องให้ครบก่อนปิดร้าน ยอดควรมี = เงินเปิดลิ้นชัก + รับเงินสด − เงินสดคืนลูกค้าในวันนั้น ไม่รวมเงินเข้า/ออกอื่น"
      >
        <div className="space-y-3">
          <label>
            เงินเปิดลิ้นชัก (บาท)
            <input
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          <label>
            เงินนับจริง (บาท)
            <input
              inputMode="decimal"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </label>
          <label>
            หมายเหตุ / เหตุผลผลต่าง
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p role="status" className="text-red-700">
            {error}
          </p>
          <Button disabled={busy} onClick={() => void closeDay()}>
            ยืนยันยอดและบันทึก audit log
          </Button>
        </div>
      </Dialog>
    </AdminShell>
  );
}
