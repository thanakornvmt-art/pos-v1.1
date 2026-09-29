"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { type OrderDetail } from "@/domain/order-history";
import {
  channelNames,
  channels,
  type CartLine,
  type Channel,
  type Menu,
} from "@/domain/schema";
import {
  priceOrder,
  formatMoney,
  inputMoney,
  moneyToBaht,
} from "@/domain/pricing";
import { Options } from "@/components/pos/options";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
export function PaidOrderEditor({
  order,
  onClose,
}: {
  order: OrderDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>(order.editLines);
  const [channel, setChannel] = useState<Channel>(order.channel);
  const [discount, setDiscount] = useState(moneyToBaht(order.discount));
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [settled, setSettled] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<CartLine>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const catalog = order.catalog!;
  let total = order.total;
  let validation = "";
  let amount = 0;
  try {
    amount = inputMoney(discount || "0");
    total = priceOrder(
      catalog,
      channel,
      lines,
      amount
        ? {
            kind: "BAHT",
            value: amount,
            reason: reason.length >= 3 ? reason : "แก้ไขบิล",
          }
        : null,
    ).total;
  } catch (e) {
    validation = e instanceof Error ? e.message : "ตรวจรายการ";
  }
  const diff = total - order.total;
  function change(next: CartLine[]) {
    setLines(next);
    setSettled(false);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/orders/${order.clientUuid}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          expectedHash: order.payloadHash,
          lines,
          channel,
          discount: amount,
          total,
          reason,
          settled,
          settlementRef: ref,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "แก้บิลไม่สำเร็จ");
      const result = z.object({ clientUuid: z.string().uuid() }).parse(data);
      router.push(`/orders/${result.clientUuid}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="แก้ไขบิลที่ชำระแล้ว"
      description="เก็บบิลเดิมและออกฉบับแก้ไข ปรับสต็อกตามรายการ ใช้ราคาและสูตร ณ วันที่ขายเดิม บันทึกยอดฉบับใหม่ในวันที่แก้ไข"
      wide
    >
      <fieldset disabled={busy} className="space-y-3">
        <label>
          ช่องทาง
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as Channel);
              setSettled(false);
            }}
          >
            {channels.map((c) => (
              <option key={c} value={c}>
                {channelNames[c]}
              </option>
            ))}
          </select>
        </label>
        {lines.map((line) => (
          <section key={line.id} className="rounded-xl border p-3">
            <strong>
              {catalog.menus.find((m) => m.id === line.menuItemId)?.name}
            </strong>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                aria-label={`ลด ${line.id}`}
                disabled={line.qty <= 1}
                onClick={() =>
                  change(
                    lines.map((l) =>
                      l.id === line.id ? { ...l, qty: l.qty - 1 } : l,
                    ),
                  )
                }
              >
                −
              </Button>
              <span className="self-center">{line.qty}</span>
              <Button
                variant="outline"
                aria-label={`เพิ่ม ${line.id}`}
                disabled={line.qty >= 99}
                onClick={() =>
                  change(
                    lines.map((l) =>
                      l.id === line.id ? { ...l, qty: l.qty + 1 } : l,
                    ),
                  )
                }
              >
                +
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(line);
                  setMenu(catalog.menus.find((m) => m.id === line.menuItemId)!);
                }}
              >
                ตัวเลือก / หมายเหตุ
              </Button>
              <Button
                variant="destructive"
                onClick={() => change(lines.filter((l) => l.id !== line.id))}
              >
                ลบรายการ
              </Button>
            </div>
            <p>{line.note}</p>
          </section>
        ))}
        <label>
          เพิ่มเมนู
          <select
            value=""
            onChange={(e) => {
              setEditing(undefined);
              setMenu(
                catalog.menus.find((m) => m.id === e.target.value) ?? null,
              );
            }}
          >
            <option value="">เลือกเมนูจากชุดราคาเดิม</option>
            {catalog.menus.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ส่วนลด (บาท)
          <input
            inputMode="decimal"
            value={discount}
            onChange={(e) => {
              setDiscount(e.target.value);
              setSettled(false);
            }}
          />
        </label>
        <label>
          เหตุผลที่แก้บิล
          <input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p>
          ยอดเดิม {formatMoney(order.total)} → ยอดใหม่ {formatMoney(total)}
        </p>
        <p className="text-xl font-bold">
          {diff > 0
            ? `ต้องรับเพิ่ม ${formatMoney(diff)}`
            : diff < 0
              ? `ต้องคืนเงิน ${formatMoney(-diff)}`
              : "ยอดเงินเท่าเดิม"}
        </p>
        <p>
          กระทบยอดผ่านช่องทางเดิม ({order.receipt.method})
          หากอาหารใช้ไปแล้วแต่ต้องคืนสต็อก ให้บันทึกของเสียตามจริงหลังแก้บิล
        </p>
        {diff !== 0 && order.receipt.method !== "CASH" && (
          <label>
            เลขอ้างอิงรับเพิ่ม / คืนเงิน
            <input
              value={ref}
              maxLength={100}
              onChange={(e) => {
                setRef(e.target.value);
                setSettled(false);
              }}
            />
          </label>
        )}
        <Button
          variant={settled ? "default" : "outline"}
          onClick={() => setSettled(!settled)}
        >
          {settled
            ? "✓ ตรวจยอดเงินและสต็อกแล้ว"
            : diff > 0
              ? "ยืนยันว่ารับเงินเพิ่มแล้ว"
              : diff < 0
                ? "ยืนยันว่าคืนเงินส่วนต่างแล้ว"
                : "ยืนยันรายการและสต็อกที่แก้"}
        </Button>
        <p role="alert" className="text-red-700">
          {error || validation}
        </p>
        <Button
          disabled={
            busy ||
            !settled ||
            !!validation ||
            !lines.length ||
            reason.trim().length < 3 ||
            (diff !== 0 && order.receipt.method !== "CASH" && !ref.trim())
          }
          onClick={() => void save()}
        >
          {busy ? "กำลังบันทึก…" : "บันทึกบิลฉบับแก้ไข"}
        </Button>
      </fieldset>
      {menu && (
        <Options
          menu={menu}
          initial={editing}
          onClose={() => setMenu(null)}
          onAdd={(line) => {
            change(
              editing
                ? lines.map((l) => (l.id === editing.id ? line : l))
                : [...lines, line],
            );
            setMenu(null);
          }}
        />
      )}
    </Dialog>
  );
}
