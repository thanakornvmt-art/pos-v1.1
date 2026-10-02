"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BluetoothPrinter, supportsBluetooth } from "@/lib/printing/bluetooth";
import { printerSettingsSchema } from "@/domain/printing";
import { localDb, type PrintJob, type Receipt } from "@/lib/offline/db";
import { sendPrintJob } from "@/lib/printing/queue";
import { encodeReceipt } from "@/lib/printing/raster";
import { ReceiptView } from "./receipt";
import { Button } from "@/components/ui/button";

const Context = createContext<ReturnType<typeof usePrinterState> | null>(null);
function usePrinterState() {
  const [name, setName] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<"bluetooth" | "system">("bluetooth");
  const [auto, setAuto] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<PrintJob | null>(null);
  const printer = useRef<BluetoothPrinter | null>(null);
  const printing = useRef(false);
  const pending = useRef<Array<{ id: string; mode: "bluetooth" | "system" }>>(
    [],
  );
  const systemDone = useRef<((error?: Error) => void) | null>(null);
  useEffect(() => {
    printer.current = new BluetoothPrinter(setName);
    const ble = supportsBluetooth();
    setSupported(ble);
    setMode(ble ? "bluetooth" : "system");
    void localDb.meta
      .get("auto-printer")
      .then((saved) => {
        if (saved) {
          try {
            const v = JSON.parse(saved.value);
            if (v.mode === "system" || v.mode === "bluetooth") setMode(v.mode);
            setAuto(v.auto !== false);
          } catch {
            /* use defaults */
          }
        }
      })
      .catch(() =>
        setMessage("อ่านการตั้งค่าพิมพ์อัตโนมัติไม่ได้ ใช้ค่าเริ่มต้น"),
      )
      .finally(() => setReady(true));
    return () => {
      printer.current?.disconnect();
      systemDone.current?.(new Error("หน้าพิมพ์ถูกปิด ตรวจใบก่อนพิมพ์ซ้ำ"));
    };
  }, []);
  useEffect(() => {
    if (ready)
      void localDb.meta
        .put({
          key: "auto-printer",
          value: JSON.stringify({ mode, auto }),
        })
        .catch(() => setMessage("บันทึกการตั้งค่าเครื่องพิมพ์ไม่ได้"));
  }, [mode, auto, ready]);
  useEffect(() => {
    if (!paper) return;
    let alive = true;
    void document.fonts.ready.then(() => {
      if (!alive) return;
      document.body.classList.add("printing-current-receipt");
      try {
        window.print();
        systemDone.current?.();
      } catch (e) {
        systemDone.current?.(
          e instanceof Error ? e : new Error("เปิดหน้าต่างพิมพ์ไม่ได้"),
        );
      } finally {
        document.body.classList.remove("printing-current-receipt");
        systemDone.current = null;
        setPaper(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [paper]);
  async function drain() {
    if (printing.current) return;
    printing.current = true;
    setBusy(true);
    try {
      while (pending.current.length) {
        const next = pending.current.shift()!;
        try {
          if (next.mode === "bluetooth" && !printer.current?.connected)
            throw new Error(
              "รับเงินแล้ว แต่ยังไม่ได้เชื่อมต่อเครื่องพิมพ์ เปิดคิวพิมพ์เพื่อพิมพ์บิล",
            );
          await sendPrintJob(next.id, async (job) => {
            if (next.mode === "bluetooth")
              await printer.current!.print(
                await encodeReceipt(job.receipt, job.kind),
              );
            else
              await new Promise<void>((resolve, reject) => {
                systemDone.current = (e) => (e ? reject(e) : resolve());
                setPaper(job);
              });
          });
          setMessage(
            "ส่งใบเสร็จแล้ว ตรวจว่ากระดาษออกครบ หากต้องการพิมพ์ซ้ำให้เปิดบิลเก่า",
          );
        } catch (e) {
          setMessage(
            e instanceof Error
              ? e.message
              : "บันทึกบิลแล้ว แต่พิมพ์ไม่สำเร็จ เปิดคิวพิมพ์เพื่อตรวจสอบ",
          );
          if (next.mode === "bluetooth") {
            // Keep remaining durable jobs ready for review after a partial send.
            pending.current = [];
            break;
          }
        }
      }
    } finally {
      printing.current = false;
      setBusy(false);
    }
  }
  function afterPayment(id: string) {
    if (!auto) {
      setMessage("บันทึกบิลแล้ว · ปิดพิมพ์อัตโนมัติอยู่ เปิดคิวพิมพ์ได้");
      return;
    }
    pending.current.push({ id, mode });
    void drain();
  }
  async function printCopy(orderId: string, receipt: Receipt) {
    const id = `${orderId}:COPY:${crypto.randomUUID()}`;
    await localDb.printJobs.add({
      id,
      orderId,
      kind: "CUSTOMER",
      state: "ready",
      receipt: { ...receipt, copy: true },
    });
    pending.current.push({ id, mode });
    void drain();
  }
  async function connect() {
    try {
      // Read settings before the click would lose activation; the toolbar loads them eagerly below.
      await printer.current!.connect(config.current);
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ");
    }
  }
  function stopPrinting() {
    pending.current = [];
    setAuto(false);
    printer.current?.disconnect();
    setMessage(
      "หยุดส่งและปิดพิมพ์อัตโนมัติแล้ว ตรวจใบที่ออก งานที่เหลือเปิดได้ในคิวพิมพ์",
    );
  }
  const config = useRef(printerSettingsSchema.parse({}));
  useEffect(() => {
    void localDb.meta
      .get("printer-settings")
      .then((saved) => {
        if (saved)
          config.current = printerSettingsSchema.parse(JSON.parse(saved.value));
      })
      .catch(() => setMessage("อ่านการตั้งค่าเครื่องพิมพ์ไม่ได้"));
  }, []);
  return {
    printer,
    name,
    supported,
    mode,
    setMode,
    auto,
    setAuto,
    message,
    setMessage,
    busy,
    ready,
    paper,
    afterPayment,
    printCopy,
    connect,
    stopPrinting,
    config,
  };
}
export function PrinterProvider({ children }: { children: React.ReactNode }) {
  const value = usePrinterState();
  return (
    <Context.Provider value={value}>
      {children}
      {value.paper &&
        createPortal(
          <div id="current-receipt-print" aria-hidden="true">
            <ReceiptView
              receipt={value.paper.receipt}
              kind={value.paper.kind}
            />
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}
export function usePrinter() {
  const value = useContext(Context);
  if (!value) throw new Error("PrinterProvider required");
  return value;
}
export function PrinterControls() {
  const p = usePrinter();
  return (
    <details className="no-print rounded-xl border bg-white px-3 py-2">
      <summary className="cursor-pointer font-semibold">
        พิมพ์อัตโนมัติ: {p.auto ? "เปิด" : "ปิด"} ·{" "}
        {p.name || (p.mode === "system" ? "หน้าต่างพิมพ์" : "ยังไม่เชื่อมต่อ")}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!p.ready || p.busy}
          onClick={() => p.setAuto(!p.auto)}
        >
          {p.auto ? "ปิดพิมพ์อัตโนมัติ" : "เปิดพิมพ์อัตโนมัติ"}
        </Button>
        <select
          aria-label="วิธีพิมพ์ใบเสร็จ"
          className="w-auto"
          value={p.mode}
          disabled={!p.ready || p.busy}
          onChange={(e) => p.setMode(e.target.value as "bluetooth" | "system")}
        >
          <option value="bluetooth">บลูทูธ</option>
          <option value="system">หน้าต่างพิมพ์ของระบบ</option>
        </select>
        {p.mode === "bluetooth" && (
          <Button
            disabled={!p.supported || p.busy || !p.ready}
            onClick={() => void p.connect()}
          >
            {p.name ? "เลือกเครื่องพิมพ์ใหม่" : "เชื่อมต่อเครื่องพิมพ์"}
          </Button>
        )}
        {p.mode === "bluetooth" && (p.name || p.busy) && (
          <Button variant="outline" onClick={p.stopPrinting}>
            หยุดส่งและปิดพิมพ์อัตโนมัติ
          </Button>
        )}
        <p>
          บลูทูธ: เชื่อมต่อก่อนขาย · หน้าต่างระบบ:
          เลือกเครื่องและกดพิมพ์ทุกครั้ง
        </p>
      </div>
    </details>
  );
}
