"use client";
import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { localDb, type PrintJob } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/domain/pricing";
import { thaiDate } from "@/lib/utils";
import { useRuntime } from "@/components/pos/runtime";
export default function Print() {
  const runtime = useRuntime();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [selected, setSelected] = useState<PrintJob | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const s = liveQuery(() =>
      localDb.printJobs.filter((j) => j.state !== "printed").toArray(),
    ).subscribe(setJobs);
    return () => s.unsubscribe();
  }, []);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="no-print mb-6 text-3xl font-bold">คิวงานพิมพ์</h1>
      <p className="no-print mb-4">
        ไม่มีเครื่องพิมพ์เชื่อมต่อ งานจะคงอยู่จนกดยืนยันว่าพิมพ์แล้ว
        หน้าต่างพิมพ์ของเบราว์เซอร์ไม่ยืนยันว่ากระดาษออกจริง
      </p>
      <div className="no-print space-y-3">
        {jobs.map((j) => (
          <div
            key={j.id}
            className="flex items-center justify-between rounded-xl bg-white p-4"
          >
            <div>
              <strong>
                คิว {j.receipt.queueNo} ·{" "}
                {j.kind === "KITCHEN" ? "ครัว" : "ลูกค้า"}
              </strong>
              <p>
                {j.state === "waiting-sync"
                  ? "รอส่งบิลและตัดสต็อก"
                  : "พร้อมพิมพ์"}
              </p>
            </div>
            <Button variant="outline" onClick={() => setSelected(j)}>
              เปิดใบพิมพ์
            </Button>
          </div>
        ))}
      </div>
      {selected && (
        <article className="receipt mt-6 rounded-xl bg-white p-6">
          <h2 className="text-center text-2xl font-bold">
            {selected.receipt.shopName}
          </h2>
          <p className="text-center">
            {selected.kind === "KITCHEN" ? "ใบครัว" : "ใบเสร็จรับเงิน"}
          </p>
          <p className="my-3 text-center text-4xl">
            คิว {selected.receipt.queueNo}
          </p>
          <p>{thaiDate(selected.receipt.createdAt)}</p>
          <p className="break-all">{selected.receipt.orderNo}</p>
          {selected.receipt.lines.map((l, i) => (
            <div key={i} className="border-b py-3">
              <strong>
                {l.qty} × {l.name}
              </strong>
              <p>
                {l.options.join(", ")} {l.note}
              </p>
              {selected.kind === "CUSTOMER" && <p>{formatMoney(l.total)}</p>}
            </div>
          ))}
          {selected.kind === "CUSTOMER" && (
            <div className="space-y-2 py-4">
              <p>ส่วนลด {formatMoney(selected.receipt.discount)}</p>
              <p>ภาษี {formatMoney(selected.receipt.tax)}</p>
              <strong className="text-2xl">
                รวม {formatMoney(selected.receipt.total)}
              </strong>
              <p>
                รับ {formatMoney(selected.receipt.tendered)} · ทอน{" "}
                {formatMoney(selected.receipt.change)}
              </p>
            </div>
          )}
          <div className="no-print mt-4 flex gap-2">
            <Button onClick={() => window.print()}>เปิดหน้าต่างพิมพ์</Button>
            <Button variant="outline" onClick={() => setConfirm(true)}>
              ยืนยันพิมพ์แล้ว
            </Button>
          </div>
        </article>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="ยืนยันว่าพิมพ์ใบนี้แล้ว?"
        description="กดยืนยันหลังตรวจว่ากระดาษพิมพ์ออกครบ"
      >
        <p role="status" className="mb-3 text-red-700">
          {error}
        </p>
        <Button
          onClick={() => {
            if (selected)
              void localDb
                .transaction(
                  "rw",
                  localDb.printJobs,
                  localDb.audits,
                  async () => {
                    const boot = runtime.boot;
                    if (!boot || Date.now() >= boot.expiresAt)
                      throw new Error("เข้าสู่ระบบออนไลน์ก่อนยืนยัน");
                    await localDb.printJobs.update(selected.id, {
                      state: "printed",
                      printedAt: new Date().toISOString(),
                    });
                    await localDb.audits.add({
                      id: crypto.randomUUID(),
                      permit: boot.permit,
                      userId: boot.user.id,
                      deviceId: boot.device.id,
                      action:
                        selected.kind === "KITCHEN"
                          ? "PRINT_KITCHEN"
                          : "PRINT_CUSTOMER",
                      entityId: selected.orderId,
                      before: [],
                      after: [],
                      createdAt: new Date().toISOString(),
                      state: "pending",
                    });
                  },
                )
                .then(() => {
                  setConfirm(false);
                  setSelected(null);
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "บันทึกไม่ได้"),
                );
          }}
        >
          ยืนยัน
        </Button>
      </Dialog>
    </main>
  );
}
