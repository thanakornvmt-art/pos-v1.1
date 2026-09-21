"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  receiptSettingsSchema,
  receiptSettingsResponse,
  printerSettingsSchema,
  type ReceiptSettings,
  type PrinterSettings,
} from "@/domain/printing";
import { localDb, type Receipt } from "@/lib/offline/db";
import { apiGet, apiPost } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ReceiptView } from "./receipt";
import { useRuntime } from "@/components/pos/runtime";

export function PrintSettings({
  printer,
  onPrinterSaved,
  sample,
}: {
  printer: PrinterSettings;
  onPrinterSaved: (settings: PrinterSettings) => void;
  sample: Receipt;
}) {
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReceiptSettings | null>(null);
  const [device, setDevice] = useState(printer);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const owner = runtime.boot?.user.role === "OWNER";
  const query = useQuery({
    queryKey: ["print-settings"],
    queryFn: () => apiGet("/api/print-settings", receiptSettingsResponse),
    enabled: open && runtime.online,
    retry: false,
  });
  const config =
    draft ??
    query.data?.settings ??
    receiptSettingsSchema.parse(
      runtime.boot?.catalog.settings.receiptConfig ?? {},
    );
  useEffect(() => {
    setDevice(printer);
  }, [printer]);
  async function saveReceipt() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost("/api/print-settings", {
        settings: receiptSettingsSchema.parse(config),
        confirmed: true,
      });
      await query.refetch();
      await runtime.refresh();
      setDraft(null);
      setConfirm(false);
      setMessage("บันทึกแล้ว ใช้กับบิลใหม่ บิลเก่ายังคงรูปแบบเดิม");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกไม่ได้");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
      >
        ตั้งค่าบิล / เครื่องพิมพ์
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="ตั้งค่าบิลและเครื่องพิมพ์"
        description="รูปแบบบิลใช้ทั้งร้าน ส่วนการเชื่อมต่อจำเฉพาะอุปกรณ์นี้"
        wide
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="min-w-0 space-y-3">
            <h3 className="text-xl font-bold">รูปแบบบิล</h3>
            {!owner && <p>เจ้าของร้านเท่านั้นที่แก้รูปแบบบิลได้</p>}
            <label>
              กระดาษใบเสร็จ
              <select
                disabled={!owner}
                value={config.paperWidth}
                onChange={(e) =>
                  setDraft({
                    ...config,
                    paperWidth: z.enum(["58", "80"]).parse(e.target.value),
                  })
                }
              >
                <option value="58">58 มม.</option>
                <option value="80">80 มม.</option>
              </select>
            </label>
            <label>
              ข้อความหัวบิล
              <textarea
                disabled={!owner}
                rows={3}
                maxLength={300}
                value={config.header}
                onChange={(e) =>
                  setDraft({ ...config, header: e.target.value })
                }
                placeholder="เช่น ที่อยู่ร้าน เบอร์โทร"
              />
            </label>
            <label>
              ข้อความท้ายบิล
              <textarea
                disabled={!owner}
                rows={3}
                maxLength={300}
                value={config.footer}
                onChange={(e) =>
                  setDraft({ ...config, footer: e.target.value })
                }
                placeholder="เช่น ขอบคุณที่อุดหนุน"
              />
            </label>
            <Button
              className="w-full"
              disabled={!owner}
              variant={config.showQueue ? "default" : "outline"}
              aria-pressed={config.showQueue}
              onClick={() =>
                setDraft({ ...config, showQueue: !config.showQueue })
              }
            >
              {config.showQueue ? "✓ แสดงเลขคิว" : "ไม่แสดงเลขคิว"}
            </Button>
            <Button
              className="w-full"
              disabled={!owner}
              variant={config.showOptions ? "default" : "outline"}
              aria-pressed={config.showOptions}
              onClick={() =>
                setDraft({ ...config, showOptions: !config.showOptions })
              }
            >
              {config.showOptions
                ? "✓ แสดงตัวเลือกในใบลูกค้า"
                : "ไม่แสดงตัวเลือกในใบลูกค้า"}
            </Button>
            <p>
              ใบครัวแสดงตัวเลือกและหมายเหตุครบเสมอ ชื่อร้านแก้ในหน้าตั้งค่าร้าน
            </p>
            <Button
              disabled={!owner || !runtime.online || !query.data || busy}
              onClick={() => {
                receiptSettingsSchema.parse(config);
                setConfirm(true);
              }}
            >
              บันทึกรูปแบบบิล
            </Button>
            {!runtime.online && (
              <p>การบันทึกรูปแบบบิลทั้งร้านต้องเชื่อมต่ออินเทอร์เน็ต</p>
            )}
            {query.error && <p role="alert">{query.error.message}</p>}
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="text-xl font-bold">ตัวอย่างใบลูกค้า</h3>
            <p>ตัวอย่างเท่านั้น ไม่ใช่รายการขาย</p>
            <ReceiptView
              receipt={{
                ...sample,
                shopName: query.data?.shopName ?? sample.shopName,
              }}
              kind="CUSTOMER"
              settings={config}
            />
            <details className="rounded-xl border p-3">
              <summary className="flex min-h-16 cursor-pointer items-center font-bold">
                การเชื่อมต่อขั้นสูง (ตามคู่มือเครื่อง)
              </summary>
              <div className="space-y-3">
                <p>
                  ค่าเริ่มต้นสำหรับ BLE ESC/POS แบบ 18F0 / 2AF1
                  ถ้าเครื่องใช้โปรไฟล์อื่น ให้ผู้ขายระบุ UUID
                </p>
                <label>
                  Service UUID
                  <input
                    value={device.service}
                    maxLength={36}
                    onChange={(e) =>
                      setDevice({ ...device, service: e.target.value })
                    }
                  />
                </label>
                <label>
                  Write characteristic UUID
                  <input
                    value={device.characteristic}
                    maxLength={36}
                    onChange={(e) =>
                      setDevice({ ...device, characteristic: e.target.value })
                    }
                  />
                </label>
                <label>
                  ขนาดข้อมูลต่อครั้ง (ไบต์)
                  <input
                    type="number"
                    min={20}
                    max={180}
                    value={device.chunkSize}
                    onChange={(e) =>
                      setDevice({
                        ...device,
                        chunkSize: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  พักระหว่างส่ง (มิลลิวินาที)
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={device.delayMs}
                    onChange={(e) =>
                      setDevice({ ...device, delayMs: Number(e.target.value) })
                    }
                  />
                </label>
                <Button
                  onClick={() => {
                    void (async () => {
                      try {
                        const parsed = printerSettingsSchema.parse(device);
                        await localDb.meta.put({
                          key: "printer-settings",
                          value: JSON.stringify(parsed),
                        });
                        onPrinterSaved(parsed);
                        setMessage(
                          "บันทึกเครื่องนี้แล้ว กรุณาเชื่อมต่อเครื่องพิมพ์ใหม่",
                        );
                      } catch {
                        setMessage("ตรวจ UUID และขนาดข้อมูลให้ถูกต้อง");
                      }
                    })();
                  }}
                >
                  บันทึกการเชื่อมต่อเครื่องนี้
                </Button>
              </div>
            </details>
          </section>
        </div>
        <p role="status" className="mt-3">
          {message}
        </p>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={(value) => {
          if (!busy) setConfirm(value);
        }}
        title="ยืนยันรูปแบบบิลใหม่?"
        description="ใช้กับบิลใหม่หลังเครื่องขายได้รับการตั้งค่า และบันทึกผู้แก้ไขพร้อมข้อมูลก่อน/หลัง"
      >
        <p className="mb-3" role="status">
          {message}
        </p>
        <Button disabled={busy} onClick={() => void saveReceipt()}>
          {busy ? "กำลังบันทึก…" : "ยืนยันบันทึกรูปแบบบิล"}
        </Button>
      </Dialog>
    </>
  );
}
