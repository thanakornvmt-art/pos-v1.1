"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRuntime } from "@/components/pos/runtime";
import { useQuery } from "@tanstack/react-query";
import { deliveryView, stages, stageNames } from "@/domain/delivery";
import {
  channels,
  channelNames,
  type Channel,
  type CartLine,
  type Menu,
} from "@/domain/schema";
import { apiGet, apiPost } from "@/lib/client-api";
import { formatMoney, priceOrder } from "@/domain/pricing";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Options } from "@/components/pos/options";
import { localDb } from "@/lib/offline/db";
const colors: Record<Channel, string> = {
  DINE_IN: "border-stone-400",
  TAKEAWAY: "border-blue-500",
  DELIVERY: "border-violet-500",
  GRAB: "border-green-600",
  LINEMAN: "border-lime-600",
  SHOPEE: "border-orange-600",
};
export default function Delivery() {
  const router = useRouter();
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: ["delivery"],
    queryFn: () => apiGet("/api/delivery", deliveryView),
    refetchInterval: 3000,
  });
  const [channel, setChannel] = useState<Channel>("GRAB");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pending, setPending] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = query.data;
  async function mutate(value: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost("/api/delivery", value);
      await query.refetch();
      setPending(null);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <AdminShell title="ออเดอร์ทุกช่องทาง">
        <p>{query.error?.message ?? "กำลังโหลด…"}</p>
      </AdminShell>
    );
  const total = priceOrder(data.catalog, channel, lines);
  return (
    <AdminShell title="ออเดอร์ทุกช่องทาง">
      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>+ คีย์ออเดอร์แพลตฟอร์ม</Button>
        <Button variant="outline" onClick={() => void query.refetch()}>
          อัปเดตสถานะ
        </Button>
      </div>
      <p className="mb-4">
        รับออเดอร์ด้วยการคีย์เลขอ้างอิง · ยังไม่เชื่อม API แพลตฟอร์ม ·
        อัปเดตหน้าจอทุก 3 วินาที
      </p>
      <div className="grid gap-3 lg:grid-cols-4">
        {stages.map((stage, index) => (
          <section key={stage} className="rounded-xl bg-stone-200 p-3">
            <h2 className="mb-3 text-xl font-bold">{stageNames[stage]}</h2>
            <div className="space-y-3">
              {data.tickets
                .filter((t) => t.stage === stage)
                .map((t) => (
                  <article
                    key={t.id}
                    className={`rounded-xl border-l-8 bg-white p-3 ${colors[t.channel]}`}
                  >
                    <strong>
                      {channelNames[t.channel]} · {t.externalRef}
                    </strong>
                    <p>
                      {t.lines.reduce((n, l) => n + l.qty, 0)} รายการ ·{" "}
                      {formatMoney(t.total)}
                    </p>
                    <p>รับสุทธิ {formatMoney(t.netPayout)}</p>
                    {t.lines.map((l) => (
                      <p key={l.id}>
                        {l.qty} ×{" "}
                        {data.catalog.menus.find((m) => m.id === l.menuItemId)
                          ?.name ?? l.menuItemId}
                      </p>
                    ))}
                    <p className="my-2 font-bold">
                      {t.paidOrderUuid
                        ? "ชำระแล้ว"
                        : "รอรับเงิน · ยังไม่ตัดสต็อก"}
                    </p>
                    {index < stages.length - 1 && (
                      <Button
                        disabled={busy}
                        className="mb-2 w-full"
                        onClick={() =>
                          void mutate({
                            kind: "stage",
                            id: t.id,
                            stage: stages[index + 1],
                          })
                        }
                      >
                        {stageNames[stages[index + 1]]}
                      </Button>
                    )}
                    {!t.paidOrderUuid && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          void (async () => {
                            const boot = await localDb.bootstrap.get("active");
                            if (!boot)
                              throw new Error(
                                "เปิดหน้า POS และเข้าสู่ระบบก่อน",
                              );
                            await localDb.drafts.put({
                              id: t.id,
                              name: `${channelNames[t.channel]} ${t.externalRef}`,
                              channel: t.channel,
                              lines: t.lines,
                              userId: boot.data.user.id,
                              deliveryId: t.id,
                            });
                            await localDb.meta.put({
                              key: "selectedDraft",
                              value: t.id,
                            });
                            const prepared = await runtime.refresh();
                            if (!prepared.data || prepared.isError)
                              throw new Error(
                                "เตรียมบิลไม่สำเร็จ กรุณาลองใหม่",
                              );
                            await localDb.drafts.update(t.id, {
                              bootstrap: prepared.data,
                            });
                            router.push("/pos");
                          })().catch((e) =>
                            setError(
                              e instanceof Error ? e.message : "เปิดบิลไม่ได้",
                            ),
                          );
                        }}
                      >
                        รับชำระบิลนี้
                      </Button>
                    )}
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
      <section className="mt-6">
        <h2 className="mb-3 text-xl font-bold">สถานะเมนู · ทุกช่องทาง</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {data.availability.map((m) => (
            <Button
              key={m.id}
              variant={m.soldOut ? "destructive" : "outline"}
              onClick={() =>
                setPending({
                  kind: "soldOut",
                  id: m.id,
                  soldOut: !m.soldOut,
                  confirmed: true,
                })
              }
            >
              {m.name} · {m.soldOut ? "หมด / เปิดขาย" : "กดเพื่อปิดขาย"}
            </Button>
          ))}
        </div>
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="คีย์ออเดอร์แพลตฟอร์ม"
        wide
      >
        <div className="space-y-3">
          <select
            aria-label="แพลตฟอร์ม"
            value={channel}
            onChange={(e) => {
              const c = channels.find((c) => c === e.target.value);
              if (c) setChannel(c);
            }}
          >
            {channels.map((c) => (
              <option key={c} value={c}>
                {channelNames[c]}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {data.catalog.menus.map((m) => (
              <Button
                key={m.id}
                variant="outline"
                disabled={data.availability.find((a) => a.id === m.id)?.soldOut}
                onClick={() => {
                  if (m.groups.some((g) => g.isRequired || g.minSelect > 0))
                    setMenu(m);
                  else
                    setLines([
                      ...lines,
                      {
                        id: crypto.randomUUID(),
                        menuItemId: m.id,
                        qty: 1,
                        optionIds: [],
                        note: "",
                      },
                    ]);
                }}
              >
                {m.name}
              </Button>
            ))}
          </div>
          <p>
            {lines.length} รายการ · {formatMoney(total.total)} · รับสุทธิ{" "}
            {formatMoney(total.netPayout)}
          </p>
          <label>
            เลขอ้างอิงแพลตฟอร์ม
            <input
              value={ref}
              maxLength={100}
              onChange={(e) => setRef(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !lines.length || !ref.trim()}
            onClick={() =>
              void mutate({
                kind: "create",
                id: crypto.randomUUID(),
                channel,
                externalRef: ref,
                lines,
                catalogId: data.catalogId,
              }).then((ok) => {
                if (ok) {
                  setOpen(false);
                  setLines([]);
                  setRef("");
                }
              })
            }
          >
            บันทึกออเดอร์ (ยังไม่รับเงิน)
          </Button>
        </div>
      </Dialog>
      {menu && (
        <Options
          menu={menu}
          onClose={() => setMenu(null)}
          onAdd={(l) => {
            setLines([...lines, l]);
            setMenu(null);
          }}
        />
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        title="ยืนยันเปลี่ยนสถานะขายเมนู?"
        description="มีผลกับหน้าจอที่ออนไลน์ทุกช่องทางในระบบนี้"
      >
        <Button disabled={busy} onClick={() => void mutate(pending)}>
          ยืนยัน
        </Button>
      </Dialog>
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
    </AdminShell>
  );
}
