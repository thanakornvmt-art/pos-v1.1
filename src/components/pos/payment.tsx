"use client";
import { useEffect, useState } from "react";
import { Banknote, CreditCard, QrCode, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney, inputMoney, priceOrder } from "@/domain/pricing";
import {
  discountSchema,
  type Bootstrap,
  type Discount,
  type OrderInput,
} from "@/domain/schema";
import { localDb, type Draft } from "@/lib/offline/db";
import { checkout } from "@/lib/offline/checkout";
import { syncPending } from "@/lib/offline/sync";
import { promptpayPayload } from "@/domain/promptpay";
import QRCode from "qrcode";
export function Payment({
  boot,
  draft,
  onClose,
  onSuccess,
}: {
  boot: Bootstrap;
  draft: Draft;
  onClose: () => void;
  onSuccess: (queue: string) => void;
}) {
  const [method, setMethod] = useState<OrderInput["payment"]["method"]>("CASH");
  const [cash, setCash] = useState("");
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [kind, setKind] = useState<"BAHT" | "PERCENT">("BAHT");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [refNo, setRefNo] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uuid] = useState(() => crypto.randomUUID());
  const [qr, setQr] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [expires, setExpires] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const priced = priceOrder(boot.catalog, draft.channel, draft.lines, discount);
  let tendered = 0;
  try {
    tendered = cash ? inputMoney(cash) : priced.total;
  } catch {
    /* Invalid cash disables payment. */
  }
  const change = tendered - priced.total;
  useEffect(() => {
    const t = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((expires - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(t);
  }, [expires]);
  async function makeQr() {
    try {
      if (!boot.catalog.settings.promptpayId)
        throw new Error("เจ้าของร้านต้องตั้งค่าเลข PromptPay ก่อน");
      const payload = promptpayPayload(
        boot.catalog.settings.promptpayId,
        priced.total,
      );
      setQr(
        await QRCode.toDataURL(payload, {
          width: 600,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
      setExpires(Date.now() + boot.catalog.settings.qrExpirySeconds * 1000);
      setVerified(false);
      setQrOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้าง QR ไม่สำเร็จ");
    }
  }
  async function pay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (method === "PROMPTPAY" && (!qr || remaining <= 0))
        throw new Error("QR หมดเวลา กรุณาสร้างใหม่และตรวจยอด");
      const saved = await checkout(
        boot,
        draft.id,
        draft.lines,
        draft.channel,
        discount,
        {
          method,
          tendered: method === "CASH" ? tendered : priced.total,
          refNo,
          verified: method === "CASH" || verified,
        },
        uuid,
      );
      void syncPending();
      onSuccess(saved.order.queueNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกบิลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  async function applyDiscount() {
    try {
      const parsed = discountSchema.parse({
        kind,
        value: inputMoney(value),
        reason,
      });
      priceOrder(boot.catalog, draft.channel, draft.lines, parsed);
      await localDb.audits.add({
        id: crypto.randomUUID(),
        permit: boot.permit,
        userId: boot.user.id,
        deviceId: boot.device.id,
        action: "SET_DISCOUNT",
        entityId: draft.id,
        before: draft.lines,
        after: draft.lines,
        details: parsed,
        createdAt: new Date().toISOString(),
        state: "pending",
      });
      setDiscount(parsed);
      setDiscountOpen(false);
      setQr("");
      setVerified(false);
      setCash("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ส่วนลดไม่ถูกต้อง");
    }
  }
  const methods = [
    { id: "CASH" as const, name: "เงินสด", Icon: Banknote },
    { id: "PROMPTPAY" as const, name: "PromptPay QR", Icon: QrCode },
    { id: "CARD" as const, name: "บัตร", Icon: CreditCard },
    { id: "COD" as const, name: "เก็บปลายทาง", Icon: Truck },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="ชำระเงิน"
      description={`${draft.lines.reduce((n, l) => n + l.qty, 0)} รายการ · ตรวจยอดและยืนยันรับเงิน`}
      wide
      footer={
        <div>
          <p role="status" className="text-red-700">
            {error}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p>ยอดชำระ</p>
              <strong className="text-2xl">{formatMoney(priced.total)}</strong>
            </div>
            <Button
              data-testid="confirm-payment"
              className="text-xl"
              disabled={
                busy ||
                (method === "CASH"
                  ? change < 0
                  : !verified ||
                    !refNo.trim() ||
                    (method === "PROMPTPAY" && (!qr || remaining <= 0)))
              }
              onClick={() => void pay()}
            >
              {busy ? "กำลังบันทึก…" : "ยืนยันรับเงิน"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 pb-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0">
          <div className="grid grid-cols-2 gap-2">
            {methods.map((m) => (
              <Button
                key={m.id}
                className="px-2"
                variant={method === m.id ? "default" : "outline"}
                onClick={() => {
                  setMethod(m.id);
                  setVerified(false);
                  setRefNo("");
                }}
              >
                <m.Icon />
                {m.name}
              </Button>
            ))}
          </div>
          {method === "CASH" ? (
            <div className="mt-5 space-y-3">
              <label>
                รับเงินสด (บาท)
                <input
                  inputMode="decimal"
                  value={cash}
                  placeholder="พอดี"
                  onChange={(e) => setCash(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-4">
                {[100, 500, 1000].map((n) => (
                  <Button
                    key={n}
                    className="px-2"
                    variant="outline"
                    onClick={() => setCash(String(n))}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  className="px-2"
                  variant="outline"
                  onClick={() => setCash("")}
                >
                  พอดี
                </Button>
              </div>
              <div className="rounded-2xl bg-amber-50 p-5">
                <p>{change < 0 ? "ยังขาด" : "เงินทอน"}</p>
                <p
                  data-testid="change"
                  className={`text-[48px] font-bold leading-tight ${change < 0 ? "text-red-700" : "text-primary"}`}
                >
                  {formatMoney(Math.abs(change))}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {method === "PROMPTPAY" && (
                <>
                  <Button className="w-full" onClick={() => void makeQr()}>
                    แสดง QR เต็มจอ · {formatMoney(priced.total)}
                  </Button>
                  <p className="text-stone-600">
                    QR ระบุยอดตามบิล ต้องตรวจเงินเข้าบัญชีก่อนยืนยัน
                  </p>
                </>
              )}
              {method === "COD" && (
                <p className="rounded-xl bg-amber-100 p-4">
                  ยืนยันชำระได้เมื่อเก็บเงินปลายทางแล้วเท่านั้น
                  หากยังไม่ได้รับเงินให้กลับไปพักบิล
                </p>
              )}
              {method === "CARD" && (
                <p>ใช้เครื่องรูดบัตรภายนอก แล้วบันทึกเลขอ้างอิงที่อนุมัติ</p>
              )}
              <label>
                เลขอ้างอิงการรับเงิน
                <input
                  value={refNo}
                  maxLength={100}
                  onChange={(e) => setRefNo(e.target.value)}
                />
              </label>
              <Button
                className="w-full"
                variant={verified ? "default" : "outline"}
                onClick={() => setVerified((v) => !v)}
              >
                {verified
                  ? "✓ ตรวจสอบและได้รับเงินแล้ว"
                  : "ยืนยันว่าได้รับเงินแล้ว"}
              </Button>
            </div>
          )}
        </section>
        <aside className="flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-3 sm:p-5">
          <div className="flex justify-between">
            <span>ยอดรายการ</span>
            <span>{formatMoney(priced.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>ส่วนลด</span>
            <span>−{formatMoney(priced.discount)}</span>
          </div>
          {priced.tax > 0 && (
            <div className="flex justify-between">
              <span>ภาษี</span>
              <span>{formatMoney(priced.tax)}</span>
            </div>
          )}
          <Button variant="outline" onClick={() => setDiscountOpen(true)}>
            ส่วนลด / เหตุผล
          </Button>
        </aside>
      </div>
      <Dialog
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        title="ส่วนลดบิล"
        description="ต้องมีเหตุผล และจะบันทึกใน audit log เมื่อชำระเงิน"
      >
        <div className="space-y-3">
          <select
            aria-label="ชนิดส่วนลด"
            value={kind}
            onChange={(e) =>
              setKind(e.target.value === "BAHT" ? "BAHT" : "PERCENT")
            }
          >
            <option value="BAHT">ส่วนลดบาท</option>
            <option value="PERCENT">ส่วนลดเปอร์เซ็นต์</option>
          </select>
          <label>
            จำนวน
            <input
              value={value}
              inputMode="decimal"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label>
            เหตุผล
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p role="status" className="text-red-700">
            {error}
          </p>
          <Button className="w-full" onClick={applyDiscount}>
            ยืนยันส่วนลด
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title="สแกนจ่าย PromptPay"
        description="การนับเวลาบนหน้าจอไม่สามารถยกเลิก QR ในแอปธนาคารได้"
        wide
      >
        <div className="flex flex-col items-center">
          <p className="text-4xl font-bold">{formatMoney(priced.total)}</p>
          {qr && remaining > 0 ? (
            <img
              src={qr}
              alt={`PromptPay ยอด ${formatMoney(priced.total)}`}
              className="max-h-[55dvh] w-auto"
            />
          ) : (
            <p className="p-12 text-2xl text-red-700">หมดเวลาแสดง QR</p>
          )}
          <p className="text-xl">เหลือ {remaining} วินาที</p>
          <Button className="mt-3" onClick={() => setQrOpen(false)}>
            กลับไปตรวจยอดเข้า
          </Button>
        </div>
      </Dialog>
    </Dialog>
  );
}
