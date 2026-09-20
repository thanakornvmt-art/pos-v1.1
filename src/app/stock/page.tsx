"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { stockViewSchema } from "@/domain/stock";
import { apiGet, apiPost } from "@/lib/client-api";
import { formatMoney, inputMoney, roundMoney } from "@/domain/pricing";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { thaiDate } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
export default function Stock() {
  const query = useQuery({
    queryKey: ["stock"],
    queryFn: () => apiGet("/api/stock", stockViewSchema),
  });
  const [tab, setTab] = useState("dashboard");
  const [supplierId, setSupplierId] = useState("");
  const [rows, setRows] = useState<
    {
      ingredientId: string;
      purchaseQty: string;
      price: string;
      expiry: string;
    }[]
  >([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [waste, setWaste] = useState({
    ingredientId: "",
    qty: "",
    reason: "หมดอายุ",
  });
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = query.data;
  if (!data)
    return (
      <AdminShell title="จัดการสต็อก">
        <p>{query.error?.message ?? "กำลังโหลด…"}</p>
      </AdminShell>
    );
  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/stock", pending);
      await query.refetch();
      setPending(null);
      setRows([]);
      setCounts({});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  const low = data.ingredients.filter((i) =>
    new Decimal(i.currentQty).lt(i.parLevel),
  );
  const expiring = data.batches.filter(
    (b) =>
      b.expiresAt && new Date(b.expiresAt).getTime() <= Date.now() + 86400000,
  );
  const selectedMovements = data.movements.filter(
    (m) => !filter || m.ingredientId === filter,
  );
  return (
    <AdminShell title="จัดการสต็อก">
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          ["dashboard", "ภาพรวม"],
          ["receive", "รับของเข้า"],
          ["count", "นับสต็อก"],
          ["waste", "ของเสีย"],
          ["purchase", "ใบสั่งซื้อ"],
          ["ledger", "ประวัติเคลื่อนไหว"],
        ].map(([id, name]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "outline"}
            onClick={() => setTab(id)}
          >
            {name}
          </Button>
        ))}
      </div>
      {tab === "dashboard" && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
            <h2 className="text-xl font-bold text-red-900">
              ต่ำกว่า Par · {low.length} รายการ
            </h2>
            {low.map((i) => (
              <p
                key={i.id}
                className="border-b border-red-200 py-3 text-red-900"
              >
                {i.name} · {i.currentQty} / {i.parLevel} {i.usageUnit}
                {new Decimal(i.currentQty).lte(i.reorderPoint) &&
                  " · ถึงจุดสั่งซื้อ"}
              </p>
            ))}
          </section>
          <section className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5">
            <h2 className="text-xl font-bold text-orange-900">
              หมดอายุแล้ว / ภายใน 1 วัน · {expiring.length} ล็อต
            </h2>
            {expiring.map((b) => (
              <p key={b.id} className="border-b border-orange-200 py-3">
                {data.ingredients.find((i) => i.id === b.ingredientId)?.name} ·{" "}
                {b.remainingQty} · {b.expiresAt && thaiDate(b.expiresAt)}
              </p>
            ))}
            <p className="mt-3">
              ติดตามวันหมดอายุจากล็อตรับเข้า
              ยอดตั้งต้นหรือผลต่างนับเพิ่มที่ไม่ทราบล็อตจะไม่มีวันหมดอายุ
            </p>
          </section>
        </div>
      )}
      {tab === "receive" && (
        <section className="space-y-4 rounded-xl bg-white p-5">
          <label>
            ซัพพลายเออร์
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">เลือกซัพพลายเออร์</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {rows.map((row, index) => (
            <div key={index} className="grid gap-2 lg:grid-cols-4">
              <label>
                วัตถุดิบ
                <select
                  value={row.ingredientId}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index
                          ? { ...r, ingredientId: e.target.value }
                          : r,
                      ),
                    )
                  }
                >
                  {data.ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} / {i.purchaseUnit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                จำนวนหน่วยซื้อ
                <input
                  value={row.purchaseQty}
                  inputMode="decimal"
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, purchaseQty: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label>
                ราคาต่อหน่วยซื้อ (บาท)
                <input
                  value={row.price}
                  inputMode="decimal"
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, price: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label>
                หมดอายุ (ค.ศ. ขณะกรอก)
                <input
                  type="date"
                  value={row.expiry}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, expiry: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    ingredientId: data.ingredients[0]?.id ?? "",
                    purchaseQty: "1",
                    price: "",
                    expiry: "",
                  },
                ])
              }
            >
              + เพิ่มรายการ
            </Button>
            <Button
              disabled={!rows.length || !supplierId}
              onClick={() => {
                try {
                  setPending({
                    kind: "receive",
                    id: crypto.randomUUID(),
                    supplierId,
                    lines: rows.map((r) => ({
                      ingredientId: r.ingredientId,
                      purchaseQty: r.purchaseQty,
                      unitPrice: inputMoney(r.price),
                      expiresAt: r.expiry
                        ? new Date(r.expiry + "T23:59:59+07:00").toISOString()
                        : null,
                    })),
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "ราคาไม่ถูกต้อง");
                }
              }}
            >
              รับของและคำนวณต้นทุนใหม่
            </Button>
          </div>
        </section>
      )}
      {tab === "count" && (
        <section className="space-y-3">
          <p>
            กรอกเฉพาะรายการที่นับจริง หน่วยเป็นหน่วยใช้งาน
            ระบบจะปฏิเสธหากสต็อกเปลี่ยนระหว่างนับ
          </p>
          {data.ingredients.map((i) => {
            let variance: string = "—";
            try {
              if (counts[i.id] !== undefined && counts[i.id] !== "") {
                const delta = new Decimal(counts[i.id]).minus(i.currentQty);
                variance = `${delta.toString()} ${i.usageUnit} / ${formatMoney(roundMoney(delta.mul(i.avgCost)))}`;
              }
            } catch {
              /* Keep incomplete input editable. */
            }
            return (
              <div
                key={i.id}
                className="grid items-center gap-3 rounded-xl bg-white p-3 md:grid-cols-3"
              >
                <div>
                  <strong>{i.name}</strong>
                  <p>
                    ระบบ {i.currentQty} {i.usageUnit}
                  </p>
                </div>
                <input
                  aria-label={`ยอดนับ ${i.name}`}
                  placeholder="ยังไม่ได้ตรวจนับ"
                  inputMode="decimal"
                  value={counts[i.id] ?? ""}
                  onChange={(e) =>
                    setCounts({ ...counts, [i.id]: e.target.value })
                  }
                />
                <p>ผลต่าง {variance}</p>
              </div>
            );
          })}
          <Button
            onClick={() =>
              setPending({
                kind: "count",
                id: crypto.randomUUID(),
                confirmed: true,
                lines: data.ingredients
                  .filter(
                    (i) => counts[i.id] !== undefined && counts[i.id] !== "",
                  )
                  .map((i) => ({
                    ingredientId: i.id,
                    systemQty: i.currentQty,
                    actualQty: counts[i.id],
                  })),
              })
            }
          >
            ยืนยันปรับตามยอดนับ
          </Button>
        </section>
      )}
      {tab === "waste" && (
        <section className="max-w-xl space-y-3 rounded-xl bg-white p-5">
          <label>
            วัตถุดิบ
            <select
              value={waste.ingredientId}
              onChange={(e) =>
                setWaste({ ...waste, ingredientId: e.target.value })
              }
            >
              <option value="">เลือกวัตถุดิบ</option>
              {data.ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.usageUnit})
                </option>
              ))}
            </select>
          </label>
          <label>
            จำนวนหน่วยใช้
            <input
              inputMode="decimal"
              value={waste.qty}
              onChange={(e) => setWaste({ ...waste, qty: e.target.value })}
            />
          </label>
          <label>
            เหตุผล
            <select
              value={waste.reason}
              onChange={(e) => setWaste({ ...waste, reason: e.target.value })}
            >
              {["หมดอายุ", "ทำเสีย", "ลูกค้าคืน", "ของตกพื้น"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <Button
            variant="destructive"
            onClick={() =>
              setPending({
                kind: "waste",
                id: crypto.randomUUID(),
                ...waste,
                confirmed: true,
              })
            }
          >
            บันทึกของเสีย
          </Button>
        </section>
      )}
      {tab === "purchase" && (
        <section>
          <p className="mb-3">
            ใช้ยอดตัดขายสุทธิ 7 วันเต็มก่อนวันนี้ ตั้งเป้าเป็นค่ามากกว่าระหว่าง
            Par กับยอดใช้เฉลี่ย × (วันเผื่อ + วันรอส่ง)
            แล้วหักของคงเหลือและปัดขึ้นเป็นหน่วยซื้อ
          </p>
          <Button
            onClick={() =>
              setPending({ kind: "purchaseOrder", id: crypto.randomUUID() })
            }
          >
            สร้างใบสั่งซื้อฉบับร่าง
          </Button>
          {data.purchaseOrders.map((p) => (
            <article key={p.id} className="mt-4 rounded-xl bg-white p-5">
              <h2 className="text-xl font-bold">
                ฉบับร่าง · {thaiDate(p.createdAt)}
              </h2>
              {p.lines.map((l) => (
                <p key={l.ingredientId} className="my-2">
                  {l.name} · สั่ง {l.purchaseQty} {l.purchaseUnit} ·{" "}
                  {data.suppliers.find((s) => s.id === l.supplierId)?.name ??
                    "ยังไม่ระบุซัพพลายเออร์"}
                </p>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv("ใบสั่งซื้อ.csv", [
                    ["วัตถุดิบ", "ซัพพลายเออร์", "จำนวน", "หน่วย"],
                    ...p.lines.map((l) => [
                      l.name,
                      data.suppliers.find((s) => s.id === l.supplierId)?.name ??
                        "",
                      l.purchaseQty,
                      l.purchaseUnit,
                    ]),
                  ])
                }
              >
                Export CSV
              </Button>
            </article>
          ))}
        </section>
      )}
      {tab === "ledger" && (
        <section>
          <select
            aria-label="กรองวัตถุดิบ"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">ทุกวัตถุดิบ</option>
            {data.ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <p className="my-3">
            แสดง 1,000 ความเคลื่อนไหวล่าสุด รายงานตามช่วงวันอยู่ที่หน้ารายงาน
          </p>
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv("stock-ledger.csv", [
                [
                  "วันที่",
                  "วัตถุดิบ",
                  "ประเภท",
                  "จำนวน",
                  "มูลค่า(สตางค์)",
                  "เหตุผล",
                  "อ้างอิง",
                ],
                ...selectedMovements.map((m) => [
                  thaiDate(m.createdAt),
                  data.ingredients.find((i) => i.id === m.ingredientId)?.name ??
                    m.ingredientId,
                  m.type,
                  m.qtyDelta,
                  roundMoney(new Decimal(m.qtyDelta).mul(m.costAtTime)),
                  m.reason,
                  m.refId,
                ]),
              ])
            }
          >
            Export CSV
          </Button>
          <div className="mt-4 space-y-2">
            {selectedMovements.map((m) => (
              <div key={m.id} className="rounded-xl bg-white p-4">
                <strong>
                  {data.ingredients.find((i) => i.id === m.ingredientId)?.name}{" "}
                  · {m.qtyDelta}
                </strong>
                <p>
                  {thaiDate(m.createdAt)} · {m.type} · {m.reason}
                </p>
                {m.refType === "Order" ? (
                  <Link
                    className="inline-flex min-h-16 items-center text-primary underline"
                    href={`/orders/${m.refId}`}
                  >
                    เปิดบิลต้นทาง
                  </Link>
                ) : (
                  <p className="break-all">อ้างอิง {m.refId}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setPending(null);
        }}
        title="ยืนยันรายการสต็อก"
        description="รายการนี้มีผลกับยอดคงเหลือหรือต้นทุน และมี audit log"
      >
        <p className="mb-3 text-red-700" role="status">
          {error}
        </p>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "ยืนยันบันทึก"}
        </Button>
      </Dialog>
      {error && !pending && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
    </AdminShell>
  );
}
