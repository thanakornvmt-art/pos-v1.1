"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { z } from "zod";
import { adminSchema, settingsSchema, type AdminData } from "@/domain/admin";
import { channels, channelNames } from "@/domain/schema";
import { inputMoney } from "@/domain/pricing";
import { apiGet, apiPost } from "@/lib/client-api";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useRuntime } from "@/components/pos/runtime";
export default function Settings() {
  const query = useQuery({
    queryKey: ["manage"],
    queryFn: () => apiGet("/api/manage", adminSchema),
  });
  const runtime = useRuntime();
  const [draft, setDraft] = useState<AdminData["settings"] | null>(null);
  const [fees, setFees] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const settings = draft ?? query.data?.settings;
  function payload() {
    if (!settings || !query.data) throw new Error("ยังไม่มีข้อมูลร้าน");
    const data = settingsSchema.parse(settings);
    const values = channels.map((channel) => ({
      channel,
      feeBps: inputMoney(
        fees[channel] ??
          new Decimal(
            query.data!.fees.find((f) => f.channel === channel)?.feeBps ?? 0,
          )
            .div(100)
            .toString(),
      ),
    }));
    if (values.some((f) => f.feeBps >= 10000))
      throw new Error("GP ต้องน้อยกว่า 100%");
    return { kind: "settings", data, fees: values, confirmed: true };
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost("/api/manage", payload());
      await query.refetch();
      await runtime.refresh();
      setDraft(null);
      setFees({});
      setConfirm(false);
      setMessage("บันทึกการตั้งค่าร้านแล้ว");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "ข้อมูลไม่ถูกต้อง กรุณาตรวจเลข PromptPay และจำนวนวัน"
          : e instanceof Error
            ? e.message
            : "บันทึกไม่ได้",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminShell title="ตั้งค่าร้าน">
      {query.error && (
        <p role="alert" className="text-red-700">
          {query.error.message}
        </p>
      )}
      {settings && (
        <>
          <p className="mb-5">
            ข้อมูลร้าน การรับชำระเงิน GP และวันเผื่อสต็อก
            เจ้าของร้านเท่านั้นที่แก้ไขได้
          </p>
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="text-xl font-bold">ข้อมูลร้านและรับเงิน</h2>
              <label>
                ชื่อร้าน
                <input
                  value={settings.shopName}
                  maxLength={100}
                  onChange={(e) =>
                    setDraft({ ...settings, shopName: e.target.value })
                  }
                />
              </label>
              <label>
                PromptPay (เว้นว่างหากยังไม่มี)
                <input
                  inputMode="numeric"
                  value={settings.promptpayId ?? ""}
                  maxLength={13}
                  onChange={(e) =>
                    setDraft({
                      ...settings,
                      promptpayId: e.target.value || null,
                    })
                  }
                />
              </label>
              <p className="text-stone-600">
                เบอร์โทร 10 หลัก หรือเลขประจำตัว 13 หลัก
                ตรวจเลขผู้รับก่อนใช้งานจริง
              </p>
              <label>
                วันเผื่อสต็อก
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={settings.safetyDays ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...settings,
                      safetyDays:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                วันรอส่ง
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={settings.leadTimeDays ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...settings,
                      leadTimeDays:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </section>
            <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="text-xl font-bold">GP แยกช่องทาง</h2>
              {channels.map((channel) => (
                <label key={channel}>
                  GP% {channelNames[channel]}
                  <input
                    inputMode="decimal"
                    value={
                      fees[channel] ??
                      new Decimal(
                        query.data?.fees.find((f) => f.channel === channel)
                          ?.feeBps ?? 0,
                      )
                        .div(100)
                        .toString()
                    }
                    onChange={(e) =>
                      setFees({ ...fees, [channel]: e.target.value })
                    }
                  />
                </label>
              ))}
            </section>
          </div>
          <p role="status" className="my-4 text-primary">
            {message}
          </p>
          <p role="alert" className="mb-3 text-red-700">
            {error}
          </p>
          <Button
            onClick={() => {
              try {
                payload();
                setError("");
                setMessage("");
                setConfirm(true);
              } catch (e) {
                setError(
                  e instanceof z.ZodError
                    ? "ข้อมูลไม่ถูกต้อง กรุณาตรวจเลข PromptPay และจำนวนวัน"
                    : e instanceof Error
                      ? e.message
                      : "ข้อมูลไม่ถูกต้อง",
                );
              }
            }}
          >
            บันทึกการตั้งค่า
          </Button>
        </>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(v) => {
          if (!busy) setConfirm(v);
        }}
        title="ยืนยันการตั้งค่าร้านใหม่?"
        description="ระบบบันทึกข้อมูลก่อน/หลังและผู้แก้ไข บิลพักยังคงใช้ชุดราคาเดิม"
      >
        <p role="status" className="mb-3 text-red-700">
          {error}
        </p>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "ยืนยันบันทึก"}
        </Button>
      </Dialog>
    </AdminShell>
  );
}
