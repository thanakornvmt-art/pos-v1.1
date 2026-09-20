"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet } from "@/lib/client-api";
import { liveQuery } from "dexie";
import { Plus, Trash2, Soup, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useRuntime } from "@/components/pos/runtime";
import { Options } from "@/components/pos/options";
import { Payment } from "@/components/pos/payment";
import {
  channelNames,
  channels,
  type CartLine,
  type Menu,
} from "@/domain/schema";
import { priceOrder, formatMoney } from "@/domain/pricing";
import { localDb, type Draft } from "@/lib/offline/db";
import { usePos } from "@/stores/pos";
import { thaiDate } from "@/lib/utils";
export default function Pos() {
  const availability = useQuery({
    queryKey: ["availability"],
    queryFn: () =>
      apiGet(
        "/api/availability",
        z.array(z.object({ id: z.string(), soldOut: z.boolean() })),
      ),
    refetchInterval: 3000,
    retry: false,
  });
  const runtime = useRuntime();
  const { loaded } = runtime;
  const { draft, setDraft, billsOpen, setBillsOpen } = usePos();
  const boot =
    draft?.userId === runtime.boot?.user.id &&
    draft?.lines.length &&
    draft.bootstrap
      ? draft.bootstrap
      : runtime.boot;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<CartLine | undefined>();
  const [payment, setPayment] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    action: () => Promise<void>;
  } | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitQty, setSplitQty] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!boot) return;
    const sub = liveQuery(() =>
      localDb.drafts.where("userId").equals(boot.user.id).toArray(),
    ).subscribe((rows) => setDrafts(rows));
    void (async () => {
      const selected = await localDb.meta.get("selectedDraft");
      const chosen = selected
        ? await localDb.drafts.get(selected.value)
        : undefined;
      const old =
        chosen?.userId === boot.user.id
          ? chosen
          : await localDb.drafts.where("userId").equals(boot.user.id).first();
      const next = old ?? {
        id: crypto.randomUUID(),
        name: "บิลปัจจุบัน",
        channel: "TAKEAWAY" as const,
        lines: [],
        userId: boot.user.id,
        bootstrap: boot,
      };
      if (!old) await localDb.drafts.put(next);
      setDraft(next);
    })();
    return () => sub.unsubscribe();
  }, [boot?.user.id, setDraft]);
  if (!boot || !draft)
    return (
      <main className="p-10">
        <h1 className="text-2xl font-bold">
          {loaded
            ? "กรุณาเข้าสู่ระบบเพื่อเตรียมเครื่องขาย"
            : "กำลังเปิดหน้าร้าน…"}
        </h1>
        <a
          href="/login"
          className="mt-6 inline-flex min-h-16 items-center rounded-xl bg-primary px-6 text-white"
        >
          เข้าสู่ระบบ
        </a>
      </main>
    );
  const catalog = boot.catalog;
  const priced = priceOrder(catalog, draft.channel, draft.lines);
  const expired = Date.now() >= boot.expiresAt;
  async function save(lines: CartLine[], extra: Partial<Draft> = {}) {
    if (!draft) return;
    if (draft.deliveryId)
      throw new Error(
        "รายการแพลตฟอร์มล็อกตามออเดอร์ต้นทาง กรุณาพักบิลนี้หากยังไม่พร้อมรับเงิน",
      );
    const next = {
      ...draft,
      ...extra,
      lines,
      bootstrap: draft.lines.length
        ? (draft.bootstrap ?? boot ?? undefined)
        : (boot ?? undefined),
    };
    await localDb.drafts.put(next);
    setDraft(next);
  }
  async function add(line: CartLine) {
    if (!draft) return;
    await save(
      editing
        ? draft.lines.map((l) => (l.id === editing.id ? line : l))
        : [...draft.lines, line],
    );
    setMenu(null);
    setEditing(undefined);
  }
  async function audit(
    action: "REMOVE_LINE" | "CLEAR_CART" | "SPLIT_BILL" | "MERGE_BILL",
    after: CartLine[],
  ) {
    if (!boot || !draft) return;
    await localDb.audits.add({
      id: crypto.randomUUID(),
      permit: boot.permit,
      userId: boot.user.id,
      deviceId: boot.device.id,
      action,
      entityId: draft.id,
      before: draft.lines,
      after,
      createdAt: new Date().toISOString(),
      state: "pending",
    });
  }
  async function remove(lineId?: string) {
    if (!draft) return;
    const lines = lineId ? draft.lines.filter((l) => l.id !== lineId) : [];
    await localDb.transaction(
      "rw",
      localDb.drafts,
      localDb.audits,
      async () => {
        await audit(lineId ? "REMOVE_LINE" : "CLEAR_CART", lines);
        await save(lines);
      },
    );
  }
  async function newBill() {
    if (!boot) return;
    const next: Draft = {
      id: crypto.randomUUID(),
      name: `บิล ${thaiDate(new Date())}`,
      channel: draft?.channel ?? "TAKEAWAY",
      lines: [],
      userId: boot.user.id,
      bootstrap: runtime.boot ?? boot,
    };
    await localDb.drafts.put(next);
    await localDb.meta.put({ key: "selectedDraft", value: next.id });
    setDraft(next);
    setBillsOpen(false);
  }
  async function split() {
    if (!draft || !boot) return;
    if (draft.deliveryId) throw new Error("บิลแพลตฟอร์มแยกไม่ได้");
    const chosen: CartLine[] = [];
    const remaining: CartLine[] = [];
    for (const l of draft.lines) {
      const n = splitQty[l.id] ?? 0;
      if (!Number.isInteger(n) || n < 0 || n > l.qty)
        throw new Error("จำนวนแยกบิลไม่ถูกต้อง");
      if (n) chosen.push({ ...l, id: crypto.randomUUID(), qty: n });
      if (l.qty > n) remaining.push({ ...l, qty: l.qty - n });
    }
    if (!chosen.length || !remaining.length)
      throw new Error("เลือกบางรายการเพื่อแยก โดยเหลือรายการในบิลเดิม");
    await localDb.transaction(
      "rw",
      localDb.drafts,
      localDb.audits,
      async () => {
        await audit("SPLIT_BILL", remaining);
        await save(remaining);
        await localDb.drafts.add({
          id: crypto.randomUUID(),
          name: "บิลแยก",
          channel: draft.channel,
          lines: chosen,
          userId: boot.user.id,
          bootstrap: boot,
        });
      },
    );
    setSplitOpen(false);
    setSplitQty({});
  }
  async function merge(other: Draft) {
    if (!draft) return;
    if (draft.deliveryId || other.deliveryId)
      throw new Error("บิลแพลตฟอร์มรวมไม่ได้");
    if (other.bootstrap && other.bootstrap.catalogId !== boot?.catalogId)
      throw new Error("ชุดราคาต่างกัน รวมบิลไม่ได้");
    if (other.channel !== draft.channel)
      throw new Error("รวมได้เฉพาะบิลช่องทางเดียวกัน");
    const lines = [...draft.lines, ...other.lines];
    await localDb.transaction(
      "rw",
      localDb.drafts,
      localDb.audits,
      async () => {
        await audit("MERGE_BILL", lines);
        await save(lines);
        await localDb.drafts.update(other.id, { lines: [] });
      },
    );
    setBillsOpen(false);
  }
  const perform = async (action: () => Promise<void>) => {
    try {
      await action();
      setConfirm(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
    }
  };
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      {expired && (
        <div className="bg-red-100 px-5 py-2 text-red-800">
          สิทธิ์ขายหมดอายุ กรุณาเชื่อมต่อและ{" "}
          <a href="/login" className="underline">
            เข้าสู่ระบบใหม่
          </a>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_370px]">
        <section className="flex min-h-0 flex-col p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-5 text-stone-500" />
              <input
                aria-label="ค้นหาเมนู"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาเมนู…"
                className="pl-12"
              />
            </div>
            <span className="text-stone-600">{boot.user.name}</span>
          </div>
          <div className="mb-4 flex shrink-0 gap-2 overflow-x-auto">
            <Button
              variant={category === "all" ? "default" : "outline"}
              onClick={() => setCategory("all")}
            >
              ทั้งหมด
            </Button>
            {catalog.categories.map((c) => (
              <Button
                className="whitespace-nowrap"
                variant={category === c.id ? "default" : "outline"}
                key={c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </Button>
            ))}
          </div>
          <div className="grid min-h-0 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-2 2xl:grid-cols-3">
            {catalog.menus
              .filter(
                (m) =>
                  (category === "all" || m.categoryId === category) &&
                  m.name.includes(search),
              )
              .map((m) => (
                <button
                  key={m.id}
                  className="overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm focus-visible:ring-4 focus-visible:ring-amber-400"
                  onClick={() => {
                    setEditing(undefined);
                    if (m.groups.some((g) => g.isRequired || g.minSelect > 0)) {
                      setMenu(m);
                      return;
                    }
                    void perform(async () => {
                      await add({
                        id: crypto.randomUUID(),
                        menuItemId: m.id,
                        qty: 1,
                        optionIds: [],
                        note: "",
                      });
                    });
                  }}
                  disabled={
                    expired ||
                    availability.data?.find((a) => a.id === m.id)?.soldOut
                  }
                >
                  <img
                    src={m.imageUrl || "/icon.svg"}
                    alt=""
                    className="h-28 w-full object-cover"
                  />
                  <div className="p-4">
                    <p className="text-xl font-bold">
                      {m.name}
                      {availability.data?.find((a) => a.id === m.id)?.soldOut &&
                        " · หมด"}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xl text-primary">
                        {formatMoney(
                          m.prices.find((p) => p.channel === draft.channel)
                            ?.price ?? 0,
                        )}
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50">
                        <Plus size={20} />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-stone-200 bg-white p-4">
          <div className="mb-3 flex justify-between">
            <h2 className="text-2xl font-bold">บิลปัจจุบัน</h2>
            <span className="rounded-full bg-stone-100 px-3 py-1">
              {priced.lines.reduce((n, l) => n + l.qty, 0)} รายการ
            </span>
          </div>
          <select
            aria-label="ช่องทางขาย"
            className="mb-3 shrink-0"
            value={draft.channel}
            onChange={(e) => {
              const channel = channels.find((c) => c === e.target.value);
              if (channel) void perform(() => save(draft.lines, { channel }));
            }}
          >
            {channels.map((c) => (
              <option key={c} value={c}>
                {channelNames[c]}
              </option>
            ))}
          </select>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {priced.lines.length === 0 ? (
              <div className="py-12 text-center text-stone-500">
                <Soup className="mx-auto mb-4" size={48} />
                <p>แตะเมนูเพื่อเริ่มบิลใหม่</p>
              </div>
            ) : (
              priced.lines.map((l) => (
                <div
                  key={l.id}
                  className="rounded-xl border border-stone-200 p-3"
                >
                  <div className="flex justify-between gap-2">
                    <strong className="text-lg">{l.menu.name}</strong>
                    <span>{formatMoney(l.lineTotal)}</span>
                  </div>
                  <p className="text-stone-600">
                    {l.options.map((o) => o.name).join(", ")} {l.note}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void perform(() =>
                          save(
                            draft.lines.map((x) =>
                              x.id === l.id
                                ? { ...x, qty: Math.min(99, x.qty + 1) }
                                : x,
                            ),
                          ),
                        )
                      }
                      aria-label={`เพิ่ม ${l.menu.name}`}
                    >
                      <Plus />
                    </Button>
                    <span className="min-w-8 text-center text-xl">{l.qty}</span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(l);
                        setMenu(l.menu);
                      }}
                    >
                      ตัวเลือก
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`ลบ ${l.menu.name}`}
                      onClick={() =>
                        setConfirm({
                          title: "ยืนยันลบรายการนี้?",
                          action: () => remove(l.id),
                        })
                      }
                    >
                      <Trash2 size={22} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <footer className="shrink-0 border-t pt-3">
            <div className="mb-2 flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={!draft.lines.length}
                onClick={() => setSplitOpen(true)}
              >
                แยกบิล
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                disabled={!draft.lines.length}
                onClick={() =>
                  setConfirm({
                    title: "ยืนยันล้างบิล?",
                    action: () => remove(),
                  })
                }
              >
                ล้างบิล
              </Button>
            </div>
            <div className="mb-3 flex items-end justify-between">
              <span>ยอดรวม</span>
              <strong className="text-3xl">{formatMoney(priced.total)}</strong>
            </div>
            <Button
              data-testid="checkout"
              className="w-full text-xl"
              disabled={!draft.lines.length || expired}
              onClick={() => setPayment(true)}
            >
              ชำระเงิน <ArrowRight />
            </Button>
          </footer>
        </aside>
      </div>
      {menu && (
        <Options
          initial={editing}
          menu={menu}
          onClose={() => {
            setMenu(null);
            setEditing(undefined);
          }}
          onAdd={(line) => void perform(() => add(line))}
        />
      )}
      {payment && (
        <Payment
          boot={boot}
          draft={draft}
          onClose={() => setPayment(false)}
          onSuccess={(queue) => {
            setPayment(false);
            const next = {
              ...draft,
              lines: [],
              deliveryId: undefined,
              bootstrap: runtime.boot ?? boot,
            };
            setDraft(next);
            void localDb.drafts.put(next);
            setSuccess(queue);
          }}
        />
      )}
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.title ?? "ยืนยัน"}
        description="รายการนี้จะถูกบันทึกใน audit log"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            กลับ
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm) void perform(confirm.action);
            }}
          >
            ยืนยัน
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(success)}
        onOpenChange={(open) => {
          if (!open) setSuccess("");
        }}
        title="รับเงินแล้ว บันทึกบิลเรียบร้อย"
        description="บันทึกในเครื่องแล้ว ระบบจะส่งบิล ตัดสต็อก และเตรียมงานพิมพ์เมื่อเชื่อมต่อ"
      >
        <p className="text-center">เลขคิว</p>
        <p className="my-4 text-center text-5xl font-bold text-primary">
          {success}
        </p>
        <Button className="w-full" onClick={() => setSuccess("")}>
          ขายบิลถัดไป
        </Button>
      </Dialog>
      <Dialog
        open={billsOpen}
        onOpenChange={setBillsOpen}
        title="บิลที่ยังไม่ชำระ"
      >
        <div className="space-y-3">
          <Button className="w-full" onClick={() => void perform(newBill)}>
            พักบิลนี้ และเปิดบิลใหม่
          </Button>
          {drafts
            .filter((d) => d.id !== draft.id && d.lines.length)
            .map((d) => (
              <div key={d.id} className="rounded-xl border p-3">
                <p>
                  {d.name} · {channelNames[d.channel]} · {d.lines.length} รายการ
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(d);
                      void localDb.meta.put({
                        key: "selectedDraft",
                        value: d.id,
                      });
                      setBillsOpen(false);
                    }}
                  >
                    เปิดบิล
                  </Button>
                  <Button
                    disabled={d.channel !== draft.channel}
                    onClick={() =>
                      setConfirm({
                        title: "ยืนยันรวมสองบิล?",
                        action: () => merge(d),
                      })
                    }
                  >
                    รวมเข้าบิลนี้
                  </Button>
                </div>
              </div>
            ))}
        </div>
      </Dialog>
      <Dialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        title="แยกบิลตามจำนวน"
      >
        <div className="space-y-3">
          {draft.lines.map((l) => (
            <label key={l.id}>
              {catalog.menus.find((m) => m.id === l.menuItemId)?.name} (มี{" "}
              {l.qty})
              <input
                type="number"
                min={0}
                max={l.qty}
                value={splitQty[l.id] ?? 0}
                onChange={(e) =>
                  setSplitQty({ ...splitQty, [l.id]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <Button
            className="w-full"
            onClick={() =>
              setConfirm({
                title: "ยืนยันแยกรายการเป็นบิลใหม่?",
                action: split,
              })
            }
          >
            แยกเป็นบิลใหม่
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(error)}
        onOpenChange={(open) => {
          if (!open) setError("");
        }}
        title="ตรวจสอบรายการ"
      >
        <p className="text-red-700">{error}</p>
      </Dialog>
    </main>
  );
}
