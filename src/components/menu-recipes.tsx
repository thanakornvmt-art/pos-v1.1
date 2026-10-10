"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  costs,
  packagingLineSchema,
  recipeLineSchema,
  type AdminData,
} from "@/domain/admin";
import { channels, channelNames } from "@/domain/schema";
import { formatMoney } from "@/domain/pricing";
import { apiPost } from "@/lib/client-api";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type Menu = AdminData["menus"][number];
const packagingSchema = z.array(packagingLineSchema).max(100);
export function MenuRecipes({
  data,
  category,
  reload,
}: {
  data: AdminData;
  category: string;
  reload: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [draft, setDraft] = useState<Menu | null>(null);
  const [review, setReview] = useState<"save" | "delete" | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ingredients = data.ingredients.filter((i) => i.active);
  const filtered = data.menus.filter(
    (m) =>
      (category === "all" || m.categoryId === category) &&
      (status === "all" || (status === "has") === Boolean(m.bom.length)) &&
      `${m.name} ${m.sku}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  function open(menu: Menu, deleting = false) {
    setDraft(structuredClone(menu));
    setReview(deleting ? "delete" : null);
    setOptionIds([]);
    setError("");
    setMessage("");
  }
  function prepare() {
    try {
      if (!draft) return;
      z.array(recipeLineSchema)
        .min(1, "กรุณาเพิ่มส่วนประกอบอย่างน้อย 1 รายการ")
        .max(100)
        .parse(draft.bom);
      packagingSchema.parse(draft.packaging);
      costs(data, draft, optionIds);
      setError("");
      setReview("save");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(" · ")
          : e instanceof Error
            ? e.message
            : "ข้อมูลไม่ถูกต้อง",
      );
    }
  }
  async function submit() {
    if (!draft || !review || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiPost(
        "/api/manage",
        review === "delete"
          ? {
              kind: "deleteBom",
              id: draft.id,
              expectedVersion: draft.recipeVersion,
              confirmed: true,
            }
          : {
              kind: "bom",
              id: draft.id,
              categoryId: draft.categoryId,
              lines: draft.bom,
              packaging: draft.packaging,
              expectedVersion: draft.recipeVersion,
              confirmed: true,
            },
      );
      setMessage(
        review === "delete" ? "ลบสูตรและปิดขายเมนูแล้ว" : "บันทึกสูตรแล้ว",
      );
      setDraft(null);
      setReview(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่ได้");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const unitFor = (id: string | null, recipeId: string | null = null) =>
    id
      ? (data.ingredients.find((i) => i.id === id)?.usageUnit ?? "ไม่พบหน่วย")
      : (data.recipes.find((r) => r.id === recipeId)?.outputUnit ??
        "เลือกส่วนประกอบ");
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label>
          ค้นหาสูตร / รหัสเมนู
          <input
            name="recipeSearch"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          สถานะสูตร
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">ทั้งหมด</option>
            <option value="has">มีสูตรแล้ว</option>
            <option value="empty">ยังไม่มีสูตร</option>
          </select>
        </label>
      </div>
      <Button
        className="mb-3"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setError("");
          try {
            await reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่ได้");
          }
        }}
      >
        โหลดข้อมูลใหม่
      </Button>
      <p className="mb-3">
        สูตรต่อสินค้า 1 หน่วยขาย · รูปแบบสินค้าใช้เมนูและตัวเลือกเดิม ·
        เปลี่ยนสูตรไม่ปรับบิลหรือสต็อกย้อนหลัง
        เครื่องออฟไลน์ต้องรับข้อมูลใหม่ก่อนใช้สูตรใหม่
      </p>
      {message && (
        <p role="status" className="mb-3 text-emerald-700">
          {message}
        </p>
      )}
      {error && !draft && (
        <p role="alert" className="mb-3 text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((m) => (
          <article
            key={m.id}
            className="min-w-0 space-y-3 rounded-2xl bg-white p-4"
          >
            <Button
              variant="ghost"
              className="h-auto w-full whitespace-normal break-words text-left"
              onClick={() => open(m)}
            >
              {m.name}
            </Button>
            <p>
              {m.sku} · {m.isActive ? "เปิดขาย" : "ปิดขาย"} ·{" "}
              {m.bom.length ? `${m.bom.length} ส่วนประกอบ` : "ยังไม่มีสูตร"}
            </p>
            {m.bom.length > 0 && <RecipeTotals data={data} menu={m} compact />}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => open(m)}>
                {m.bom.length ? "แก้ไขสูตร" : "เพิ่มสูตร"}
              </Button>
              {m.bom.length > 0 && (
                <Button variant="outline" onClick={() => open(m, true)}>
                  ลบสูตร
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p role="status" className="mt-4">
          {search || status !== "all"
            ? "ไม่พบสูตรตามเงื่อนไข"
            : "ยังไม่มีเมนูในหมวดหมู่นี้"}
        </p>
      )}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(o) => {
          if (!o && !inFlight.current) {
            setDraft(null);
            setReview(null);
            setError("");
          }
        }}
        title={
          draft
            ? `${review === "delete" ? "ลบสูตร" : "สูตรรายเมนู"} · ${draft.name}`
            : "สูตรรายเมนู"
        }
        description={
          review === "delete"
            ? "ลบส่วนประกอบและบรรจุภัณฑ์ของสูตร พร้อมปิดขายเมนู เก็บเมนู ราคา ตัวเลือก และประวัติเดิม"
            : "เลือกส่วนประกอบจากฐานข้อมูล ปริมาณใช้หน่วยที่ระบุ และตรวจต้นทุนก่อนยืนยัน"
        }
        wide
      >
        {draft && (
          <>
            {review === "delete" ? (
              <p className="mb-4">
                ยืนยันลบสูตร {draft.name}? การลบไม่ปรับบิลเก่าหรือยอดสต็อก
                เครื่องออฟไลน์อาจยังใช้สูตรเดิมจนเชื่อมต่อ
              </p>
            ) : (
              <form
                action="/api/manage"
                method="post"
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  prepare();
                }}
              >
                <fieldset
                  disabled={busy || Boolean(review)}
                  className="space-y-4"
                >
                  <legend className="font-bold">
                    ส่วนประกอบต่อ 1 หน่วยขาย
                  </legend>
                  <label>
                    หมวดหมู่เมนู
                    <select
                      name="category"
                      value={draft.categoryId}
                      onChange={(e) =>
                        setDraft({ ...draft, categoryId: e.target.value })
                      }
                    >
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.bom.map((line, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-stone-300 p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
                    >
                      <label>
                        ส่วนประกอบ {index + 1}
                        <select
                          aria-label={`ส่วนประกอบ ${index + 1}`}
                          required
                          name={`component-${index}`}
                          value={
                            line.ingredientId
                              ? `i:${line.ingredientId}`
                              : line.subRecipeId
                                ? `r:${line.subRecipeId}`
                                : ""
                          }
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              bom: draft.bom.map((l, i) =>
                                i !== index
                                  ? l
                                  : {
                                      ...l,
                                      ingredientId: e.target.value.startsWith(
                                        "i:",
                                      )
                                        ? e.target.value.slice(2)
                                        : null,
                                      subRecipeId: e.target.value.startsWith(
                                        "r:",
                                      )
                                        ? e.target.value.slice(2)
                                        : null,
                                    },
                              ),
                            })
                          }
                        >
                          <option value="">เลือกส่วนประกอบ</option>
                          <optgroup label="วัตถุดิบ">
                            {data.ingredients
                              .filter(
                                (i) => i.active || i.id === line.ingredientId,
                              )
                              .map((i) => (
                                <option key={i.id} value={`i:${i.id}`}>
                                  {i.name} ({i.usageUnit})
                                  {i.active ? "" : " · ปิดใช้งาน"}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="สูตรย่อย">
                            {data.recipes.map((r) => (
                              <option key={r.id} value={`r:${r.id}`}>
                                {r.name} ({r.outputUnit})
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <label>
                        ปริมาณ {index + 1} (
                        {unitFor(line.ingredientId, line.subRecipeId)})
                        <input
                          name={`qty-${index}`}
                          required
                          inputMode="decimal"
                          value={line.qty}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              bom: draft.bom.map((l, i) =>
                                i === index ? { ...l, qty: e.target.value } : l,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className="self-end"
                        aria-label={`ลบส่วนประกอบ ${index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            bom: draft.bom.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ลบ
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        bom: [
                          ...draft.bom,
                          { ingredientId: null, subRecipeId: null, qty: "1" },
                        ],
                      })
                    }
                  >
                    + เพิ่มส่วนประกอบ
                  </Button>
                </fieldset>
                <fieldset
                  disabled={busy || Boolean(review)}
                  className="space-y-3"
                >
                  <legend className="font-bold">บรรจุภัณฑ์ตามช่องทาง</legend>
                  <p>
                    ใส่บรรจุภัณฑ์ที่นี่เพื่อให้ตัดเฉพาะช่องทางที่ใช้
                    ไม่เพิ่มชิ้นเดียวกันซ้ำในส่วนประกอบหลัก
                  </p>
                  {draft.packaging.map((p, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-stone-300 p-3 sm:grid-cols-2"
                    >
                      <label>
                        ช่องทางบรรจุภัณฑ์ {index + 1}
                        <select
                          aria-label={`ช่องทางบรรจุภัณฑ์ ${index + 1}`}
                          name={`pack-channel-${index}`}
                          value={p.channel}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              packaging: draft.packaging.map((l, i) =>
                                i === index
                                  ? {
                                      ...l,
                                      channel: z
                                        .enum(channels)
                                        .parse(e.target.value),
                                    }
                                  : l,
                              ),
                            })
                          }
                        >
                          {channels.map((c) => (
                            <option key={c} value={c}>
                              {channelNames[c]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        บรรจุภัณฑ์ {index + 1}
                        <select
                          aria-label={`บรรจุภัณฑ์ ${index + 1}`}
                          required
                          name={`pack-${index}`}
                          value={p.ingredientId}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              packaging: draft.packaging.map((l, i) =>
                                i === index
                                  ? { ...l, ingredientId: e.target.value }
                                  : l,
                              ),
                            })
                          }
                        >
                          <option value="">เลือกวัตถุดิบ</option>
                          {data.ingredients
                            .filter((i) => i.active || i.id === p.ingredientId)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.usageUnit})
                                {i.active ? "" : " · ปิดใช้งาน"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        ปริมาณบรรจุภัณฑ์ {index + 1} ({unitFor(p.ingredientId)})
                        <input
                          name={`pack-qty-${index}`}
                          required
                          inputMode="decimal"
                          value={p.qty}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              packaging: draft.packaging.map((l, i) =>
                                i === index ? { ...l, qty: e.target.value } : l,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className="self-end"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            packaging: draft.packaging.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        ลบบรรจุภัณฑ์ {index + 1}
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!ingredients.length}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        packaging: [
                          ...draft.packaging,
                          { channel: "TAKEAWAY", ingredientId: "", qty: "1" },
                        ],
                      })
                    }
                  >
                    + เพิ่มบรรจุภัณฑ์
                  </Button>
                </fieldset>
                {draft.groups.length > 0 && (
                  <fieldset
                    disabled={busy || Boolean(review)}
                    className="space-y-3"
                  >
                    <legend className="font-bold">
                      รูปแบบสินค้า / ตัวเลือกเดิม (จำลองต้นทุน)
                    </legend>
                    <p>
                      เลือกเพื่อดูต้นทุนและกำไร
                      ตัวเลือกยังใช้ข้อมูลเดิมและไม่ถูกบันทึกเป็นส่วนประกอบหลัก
                    </p>
                    {draft.groups.map((g) => (
                      <div key={g.id}>
                        <p>
                          {g.name} · เลือก{" "}
                          {Math.max(g.minSelect, g.isRequired ? 1 : 0)}–
                          {g.maxSelect}
                        </p>
                        {g.items.map((o) => (
                          <label
                            key={o.id}
                            className="flex items-center gap-3 py-2"
                          >
                            <input
                              className="!min-h-6 !w-6"
                              type="checkbox"
                              checked={optionIds.includes(o.id)}
                              onChange={(e) =>
                                setOptionIds((ids) =>
                                  e.target.checked
                                    ? [...ids, o.id]
                                    : ids.filter((id) => id !== o.id),
                                )
                              }
                            />
                            {o.name} · +{formatMoney(o.priceDelta)}
                            {o.ingredientId
                              ? ` · ${o.qtyDelta ?? "0"} ${unitFor(o.ingredientId)}`
                              : ""}
                          </label>
                        ))}
                      </div>
                    ))}
                  </fieldset>
                )}
                <RecipeTotals data={data} menu={draft} optionIds={optionIds} />
                {!review && (
                  <Button type="submit" disabled={busy}>
                    ตรวจสอบและบันทึกสูตร
                  </Button>
                )}
              </form>
            )}
            {review && (
              <div className="mt-4 space-y-3">
                <p>
                  เปลี่ยนเฉพาะสูตรสำหรับข้อมูลขายชุดใหม่
                  พร้อมบันทึกผู้แก้ไขและข้อมูลก่อน/หลัง
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void submit()}>
                    {busy
                      ? "กำลังบันทึก…"
                      : review === "delete"
                        ? "ยืนยันลบสูตร"
                        : "ยืนยันบันทึกสูตร"}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      review === "delete" ? setDraft(null) : setReview(null)
                    }
                  >
                    ยกเลิก
                  </Button>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 text-red-700">
                {error}
              </p>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
function RecipeTotals({
  data,
  menu,
  optionIds = [],
  compact = false,
}: {
  data: AdminData;
  menu: Menu;
  optionIds?: string[];
  compact?: boolean;
}) {
  try {
    const rows = costs(data, menu, optionIds);
    if (compact) {
      const r = rows[0];
      return (
        <p>
          ทานที่ร้าน · ต้นทุนรวม {formatMoney(r.totalCost)} · กำไร{" "}
          {formatMoney(r.profit)}
        </p>
      );
    }
    const invalidGroup = menu.groups.find((g) => {
      const n = g.items.filter((o) => optionIds.includes(o.id)).length;
      return n < Math.max(g.minSelect, g.isRequired ? 1 : 0) || n > g.maxSelect;
    });
    return (
      <section className="space-y-3" aria-label="ต้นทุนและกำไร">
        <h3 className="font-bold">ต้นทุนรวมและกำไรขั้นต้นต่อ 1 หน่วยขาย</h3>
        <p>
          ใช้ต้นทุนเฉลี่ยปัจจุบัน · กำไรหักค่าธรรมเนียมช่องทางและบรรจุภัณฑ์แล้ว
          ยังไม่หักค่าแรงและค่าใช้จ่ายร้าน
        </p>
        {invalidGroup && (
          <p role="status">
            การจำลองยังเลือก {invalidGroup.name} ไม่ครบหรือเกินกำหนด
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.channel} className="rounded-xl bg-white p-3">
              <h4 className="font-bold">{channelNames[r.channel]}</h4>
              <p>ราคาขาย {formatMoney(r.price)}</p>
              <p>
                อาหาร {formatMoney(r.food)} · บรรจุภัณฑ์{" "}
                {formatMoney(r.packaging)}
              </p>
              <p>ต้นทุนรวม {formatMoney(r.totalCost)}</p>
              <p>ค่าธรรมเนียม {formatMoney(r.price - r.net)}</p>
              <p className={r.profit < 0 ? "text-red-700" : "text-emerald-700"}>
                กำไรขั้นต้น {formatMoney(r.profit)}
                {r.price > 0
                  ? ` (${((r.profit / r.price) * 100).toFixed(1)}%)`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  } catch {
    return (
      <p role="status" className="text-red-700">
        กรุณาตรวจส่วนประกอบและปริมาณเพื่อคำนวณต้นทุน
      </p>
    );
  }
}
