"use client";
import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { localDb, type PrintJob, type Receipt } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminShell } from "@/components/admin-shell";
import { useRuntime } from "@/components/pos/runtime";
import { PrintSettings } from "@/components/print/settings";
import { ReceiptView } from "@/components/print/receipt";
import {
  printerSettingsSchema,
  receiptSettingsSchema,
} from "@/domain/printing";
import { BluetoothPrinter, supportsBluetooth } from "@/lib/printing/bluetooth";
import { encodeReceipt } from "@/lib/printing/raster";
import { confirmPrinted, sendPrintJob } from "@/lib/printing/queue";
import { syncPending } from "@/lib/offline/sync";

export default function Print() {
  const runtime = useRuntime();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = jobs.find((job) => job.id === selectedId);
  const [config, setConfig] = useState(() => printerSettingsSchema.parse({}));
  const [supported, setSupported] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"printed" | "repeat" | null>(
    null,
  );
  const printer = useRef<BluetoothPrinter | null>(null);
  useEffect(() => {
    printer.current = new BluetoothPrinter(setName);
    setSupported(supportsBluetooth());
    const subscription = liveQuery(() =>
      localDb.printJobs.filter((job) => job.state !== "printed").toArray(),
    ).subscribe(setJobs);
    void localDb.meta
      .get("printer-settings")
      .then((saved) => {
        if (saved)
          setConfig(printerSettingsSchema.parse(JSON.parse(saved.value)));
      })
      .catch(() =>
        setMessage("อ่านการตั้งค่าเครื่องพิมพ์ไม่ได้ กรุณาตั้งค่าใหม่"),
      )
      .finally(() => setLoaded(true));
    return () => {
      subscription.unsubscribe();
      printer.current?.disconnect();
    };
  }, []);
  const sample: Receipt = {
    shopName: runtime.boot?.catalog.settings.shopName ?? "ตัวอย่างร้าน",
    queueNo: "TEST",
    orderNo: "ทดสอบเครื่องพิมพ์ ไม่ใช่รายการขาย",
    channel: "TAKEAWAY",
    createdAt: new Date().toISOString(),
    lines: [
      {
        name: "ทดสอบภาษาไทย กุ้ง ไข่ น้ำซุป",
        qty: 1,
        options: ["ตัวเลือกทดสอบ"],
        note: "สระและวรรณยุกต์ต้องครบ",
        total: 0,
      },
    ],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    tendered: 0,
    change: 0,
    method: "CASH",
    settings: receiptSettingsSchema.parse(
      runtime.boot?.catalog.settings.receiptConfig ?? {},
    ),
  };
  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setProgress(0);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function transmit(repeat = false) {
    if (!selected || !printer.current) return;
    await perform(async () => {
      if (!printer.current?.connected)
        throw new Error("เชื่อมต่อเครื่องพิมพ์ก่อน");
      await sendPrintJob(
        selected.id,
        async (job) => {
          const bytes = await encodeReceipt(job.receipt, job.kind);
          await printer.current!.print(bytes, setProgress);
        },
        repeat,
      );
      setConfirmation(null);
      setMessage("ส่งข้อมูลครบแล้ว ตรวจว่ากระดาษออกครบก่อนกดยืนยันพิมพ์แล้ว");
    });
  }
  return (
    <AdminShell title="คิวงานพิมพ์">
      <div className="no-print mb-5 space-y-4">
        <section className="space-y-3 rounded-2xl border bg-white p-3 sm:p-5">
          <h2 className="text-xl font-bold">เครื่องพิมพ์ใบเสร็จบลูทูธ</h2>
          <p
            role="status"
            className={name ? "font-bold text-emerald-700" : "text-stone-700"}
          >
            {name
              ? `● เชื่อมต่อแล้ว: ${name}`
              : "○ ยังไม่เชื่อมต่อเครื่องพิมพ์"}
          </p>
          <p>
            ใช้ Chrome บน Android กับเครื่อง BLE ที่รองรับ ESC/POS และพิมพ์ภาพ
            raster ได้ ก่อนซื้อให้ผู้ขายยืนยันว่าใช้กับ Web Bluetooth ได้
          </p>
          {loaded && !supported && (
            <p className="rounded-xl bg-amber-100 p-3">
              เบราว์เซอร์นี้ไม่รองรับการเชื่อมต่อบลูทูธตรง เปิดด้วย Chrome บน
              Android หรือใช้หน้าต่างพิมพ์ของระบบ
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!loaded || !supported || busy}
              onClick={() =>
                void perform(async () => {
                  await printer.current!.connect(config);
                })
              }
            >
              {name ? "เลือกเครื่องใหม่" : "เชื่อมต่อบลูทูธ"}
            </Button>
            <Button
              variant="outline"
              disabled={!name || busy}
              onClick={() => printer.current?.disconnect()}
            >
              ตัดการเชื่อมต่อ
            </Button>
            <Button
              variant="outline"
              disabled={!name || busy}
              onClick={() =>
                void perform(async () => {
                  if (!navigator.locks)
                    throw new Error("กรุณาใช้ Chrome รุ่นปัจจุบัน");
                  await navigator.locks.request(
                    "pos-receipt-printer",
                    { ifAvailable: true },
                    async (lock) => {
                      if (!lock) throw new Error("อีกหน้าต่างกำลังพิมพ์อยู่");
                      await printer.current!.print(
                        await encodeReceipt(sample, "CUSTOMER", true),
                        setProgress,
                      );
                      setMessage(
                        "ส่งใบทดสอบแล้ว กรุณาตรวจภาษาไทยและความกว้างกระดาษ",
                      );
                    },
                  );
                })
              }
            >
              ทดสอบพิมพ์
            </Button>
            {!busy && loaded && (
              <PrintSettings
                printer={config}
                onPrinterSaved={(settings) => {
                  printer.current?.disconnect();
                  setConfig(settings);
                }}
                sample={sample}
              />
            )}
          </div>
          <p>
            หลังรีโหลดหรือกลับจากพักหน้าจอ อาจต้องกดเชื่อมต่อใหม่
            การส่งข้อมูลครบยังไม่ยืนยันว่ากระดาษออกจริง
          </p>
          {busy && (
            <p role="status">
              กำลังทำงาน… {progress > 0 ? `${progress}%` : ""}{" "}
              อย่าปิดหน้าจอระหว่างส่งพิมพ์
            </p>
          )}
          <p role="status" className="break-words font-semibold">
            {message}
          </p>
        </section>
        <p>
          งานพิมพ์เก็บในอุปกรณ์นี้ บิลออฟไลน์รอส่งและตัดสต็อกก่อนจึงพร้อมพิมพ์
          งานที่ส่งพิมพ์ค้างจะไม่พิมพ์ซ้ำเอง
        </p>
        {!jobs.length && (
          <p className="rounded-xl bg-white p-5">ไม่มีงานพิมพ์ค้าง</p>
        )}
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 sm:p-4"
          >
            <div className="min-w-0 break-words">
              <strong>
                คิว {job.receipt.queueNo} ·{" "}
                {job.kind === "KITCHEN" ? "ครัว" : "ลูกค้า"}
              </strong>
              <p>
                {job.state === "waiting-sync"
                  ? "รอส่งบิลและตัดสต็อก"
                  : job.lastAttempt
                    ? "เคยส่งพิมพ์แล้ว · ตรวจใบก่อนสั่งซ้ำ"
                    : "พร้อมพิมพ์"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelectedId(job.id);
                setMessage("");
              }}
            >
              เปิดใบพิมพ์
            </Button>
          </div>
        ))}
      </div>
      {selected && (
        <section className="receipt-area rounded-xl bg-white p-2 sm:p-4">
          <style>{`@media print { @page { size: auto; margin: 0; } main > h1 { display: none; } .receipt { margin: 0 !important; padding: 2mm !important; border-radius: 0 !important; } .receipt-area { padding: 0 !important; } main { padding: 0 !important; } }`}</style>
          <ReceiptView receipt={selected.receipt} kind={selected.kind} />
          <p className="no-print my-3">
            หากใช้หน้าต่างพิมพ์ เลือกกระดาษให้ตรงกับเครื่อง
            และปิดหัว/ท้ายกระดาษของเบราว์เซอร์
          </p>
          <div className="no-print mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!name || busy || selected.state !== "ready"}
              onClick={() =>
                selected.lastAttempt
                  ? setConfirmation("repeat")
                  : void transmit()
              }
            >
              พิมพ์ผ่านบลูทูธ
            </Button>
            <Button
              variant="outline"
              disabled={busy || selected.state !== "ready"}
              onClick={() => window.print()}
            >
              เปิดหน้าต่างพิมพ์
            </Button>
            <Button
              variant="outline"
              disabled={busy || selected.state !== "ready"}
              onClick={() => setConfirmation("printed")}
            >
              ยืนยันพิมพ์แล้ว
            </Button>
          </div>
          {selected.lastAttempt && (
            <p className="no-print mt-3">
              {selected.lastAttempt.state === "sent"
                ? "ส่งข้อมูลครบแล้ว"
                : "การส่งครั้งก่อนยังไม่ยืนยันผล"}{" "}
              · ตรวจใบก่อนพิมพ์ซ้ำ {selected.lastAttempt.error}
            </p>
          )}
        </section>
      )}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setConfirmation(null);
        }}
        title={
          confirmation === "repeat"
            ? "ยืนยันส่งพิมพ์ซ้ำ?"
            : "ยืนยันว่าพิมพ์ใบนี้แล้ว?"
        }
        description={
          confirmation === "repeat"
            ? "การส่งครั้งก่อนอาจออกบางส่วนหรือครบแล้ว ตรวจเครื่องก่อนสั่งซ้ำ"
            : "กดยืนยันหลังตรวจว่ากระดาษออกครบ ระบบจะบันทึกประวัติ"
        }
      >
        <p role="status" className="mb-3">
          {message}
        </p>
        <Button
          disabled={busy}
          onClick={() => {
            if (confirmation === "repeat") void transmit(true);
            else
              void perform(async () => {
                if (!selected || !runtime.boot)
                  throw new Error("กรุณาเข้าสู่ระบบก่อน");
                await confirmPrinted(selected.id, runtime.boot);
                setConfirmation(null);
                setSelectedId(null);
                setMessage("ยืนยันพิมพ์แล้ว");
                void syncPending();
              });
          }}
        >
          {busy ? "กำลังทำงาน…" : "ยืนยัน"}
        </Button>
      </Dialog>
    </AdminShell>
  );
}
