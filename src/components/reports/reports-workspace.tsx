"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw } from "lucide-react";
import { localDb } from "@/lib/offline/db";
import { dateRangeSchema, reportSchema } from "@/domain/reports";
import { reportSections, type ReportView } from "@/domain/report-sections";
import { apiGet, apiPost } from "@/lib/client-api";
import { inputMoney, formatMoney } from "@/domain/pricing";
import { downloadCsv } from "@/lib/csv";
import { thaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminShell } from "@/components/admin-shell";
import { ReportSummary } from "./report-summary";
import { ReportDetails } from "./report-details";
import type { ExportReport } from "./report-table";

const today = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
export function ReportsWorkspace({ view = "summary" }: { view?: ReportView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const parsed = dateRangeSchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
  });
  const range = parsed.success ? parsed.data : { from: today(), to: today() };
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [rangeError, setRangeError] = useState("");
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState("");
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["reports", range],
    queryFn: () =>
      apiGet(`/api/reports?${new URLSearchParams(range)}`, reportSchema),
  });
  const data = query.data;
  const section = reportSections.find((s) => s.id === view)!;
  const alreadyClosed = data?.closes.some((c) => c.businessDate === range.to);
  const exportRows: ExportReport = (name, headers, rows) =>
    downloadCsv(`${name}-${range.from}-${range.to}.csv`, [headers, ...rows]);
  function applyRange(next = { from, to }) {
    const valid = dateRangeSchema.safeParse(next);
    if (!valid.success) {
      setRangeError(
        "กรอกวันที่ให้ถูกต้อง วันเริ่มต้องไม่เกินวันสิ้นสุด และช่วงวันไม่เกิน 366 วัน",
      );
      return;
    }
    setRangeError("");
    setFrom(next.from);
    setTo(next.to);
    if (next.from === range.from && next.to === range.to) void query.refetch();
    else
      router.replace(`${pathname}?${new URLSearchParams(next)}`, {
        scroll: false,
      });
  }
  function preset(kind: "today" | "week" | "month") {
    const end = today();
    const start =
      kind === "today"
        ? end
        : kind === "month"
          ? end.slice(0, 8) + "01"
          : new Date(new Date(end + "T00:00:00Z").getTime() - 6 * 86400000)
              .toISOString()
              .slice(0, 10);
    applyRange({ from: start, to: end });
  }
  async function closeDay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (reason.trim().length < 3)
        throw new Error("กรอกหมายเหตุอย่างน้อย 3 ตัวอักษร");
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
    <AdminShell title={section.label}>
      <label className="mb-5 xl:hidden">
        เลือกรายงาน
        <select
          value={view}
          onChange={(e) =>
            router.push(
              `${reportSections.find((s) => s.id === e.target.value)!.href}?${new URLSearchParams(range)}`,
            )
          }
        >
          {reportSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <section
        className="mb-5 rounded-2xl border border-stone-200 bg-white p-3 sm:p-5"
        aria-label="ช่วงวันที่รายงาน"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CalendarDays size={19} />
          <span className="mr-2 font-semibold">ช่วงวันที่</span>
          {(
            [
              ["today", "วันนี้"],
              ["week", "7 วันล่าสุด"],
              ["month", "เดือนนี้"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className="min-h-11 rounded-full border border-stone-300 px-4 text-sm hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-500"
              onClick={() => preset(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            applyRange();
          }}
        >
          <label className="min-w-0 flex-1 basis-44">
            วันที่เริ่ม (ค.ศ.)
            <input
              aria-describedby={rangeError ? "range-error" : undefined}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <label className="min-w-0 flex-1 basis-44">
            วันที่สิ้นสุด (ค.ศ.)
            <input
              aria-describedby={rangeError ? "range-error" : undefined}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={query.isFetching}>
            <RefreshCw
              size={18}
              className={query.isFetching ? "animate-spin" : ""}
            />
            แสดงรายงาน
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              !data || query.isFetching || alreadyClosed || range.to > today()
            }
            onClick={() => {
              setError("");
              setClosing(true);
            }}
          >
            {alreadyClosed ? "บันทึกปิดร้านแล้ว" : "สรุปปิดร้าน"}
          </Button>
        </form>
        {rangeError && (
          <p id="range-error" role="alert" className="mt-3 text-red-700">
            {rangeError}
          </p>
        )}
        <p className="mt-4 text-sm text-stone-600">
          {thaiDate(range.from + "T00:00:00+07:00")} –{" "}
          {thaiDate(range.to + "T23:59:59+07:00")} · เวลาไทย · จำนวนเงินเป็นบาท
        </p>
      </section>
      {query.isPending && (
        <p role="status" className="py-10 text-center">
          กำลังโหลดรายงาน…
        </p>
      )}
      {query.error && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-red-700"
        >
          <p>โหลดรายงานไม่สำเร็จ: {query.error.message}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            ลองอีกครั้ง
          </Button>
        </div>
      )}
      {data && (
        <div className="space-y-5" aria-busy={query.isFetching}>
          {view === "summary" && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ["บิลที่ชำระแล้ว", `${data.summary.bills} บิล`],
                  [
                    "ยอดก่อนส่วนลด",
                    formatMoney(
                      data.receipts
                        .filter((r) => r.status === "PAID")
                        .reduce((n, r) => n + r.subtotal, 0),
                    ),
                  ],
                  [
                    "ส่วนลดรวม",
                    formatMoney(
                      data.discounts.reduce((n, d) => n + d.discount, 0),
                    ),
                  ],
                  [
                    "ภาษีรวม",
                    formatMoney(data.taxes.reduce((n, t) => n + t.tax, 0)),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl bg-emerald-50 p-4"
                  >
                    <p className="text-sm text-emerald-900">{label}</p>
                    <strong className="mt-2 block break-words text-xl tabular-nums">
                      {value}
                    </strong>
                  </div>
                ))}
              </div>
              {data.summary.bills === 0 && (
                <p role="status" className="rounded-xl bg-white p-5">
                  ยังไม่มีบิลชำระแล้วในช่วงวันที่เลือก
                </p>
              )}
              <p className="text-sm text-stone-600">
                รวมเฉพาะบิลชำระแล้วที่ไม่ยกเลิก · Food cost
                ใช้ยอดอาหารก่อนส่วนลดและภาษี
              </p>
              <ReportSummary
                data={data}
                range={range}
                exportRows={exportRows}
              />
            </>
          )}
          {view !== "summary" && (
            <ReportDetails
              key={`${view}-${range.from}-${range.to}`}
              view={view}
              data={data}
              exportRows={exportRows}
            />
          )}
        </div>
      )}
      <Dialog
        open={closing}
        onOpenChange={(open) => {
          if (!busy) setClosing(open);
        }}
        title={`ยืนยันปิดร้าน · ${thaiDate(range.to + "T00:00:00+07:00")}`}
        description="ปิดร้านสำหรับวันสิ้นสุดที่เลือก ส่งบิลทุกเครื่องให้ครบก่อนบันทึก ยอดควรมี = เงินเปิดลิ้นชัก + รับเงินสด − เงินสดคืนลูกค้าในวันนั้น"
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
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p role="status" className="text-red-700">
            {error}
          </p>
          <Button disabled={busy} onClick={() => void closeDay()}>
            {busy ? "กำลังบันทึก…" : "ยืนยันยอดและบันทึก"}
          </Button>
        </div>
      </Dialog>
    </AdminShell>
  );
}
