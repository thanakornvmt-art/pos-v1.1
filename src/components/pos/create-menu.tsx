"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import {
  menuCreateDataSchema,
  menuCreateSchema,
  bahtPrice,
  type MenuCreate,
} from "@/domain/menu-create";
import { channels, channelNames } from "@/domain/schema";
import { explodeBom } from "@/domain/inventory";
import { formatMoney, roundMoney } from "@/domain/pricing";
import { apiGet, apiPost } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CreateCategory } from "./create-category";
import type { z } from "zod";

export function CreateMenu({
  online,
  onClose,
  onCreated,
}: {
  online: boolean;
  onClose: () => void;
  onCreated: (menu: { id: string; name: string }) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["menu-create-data"],
    queryFn: () => apiGet("/api/menus", menuCreateDataSchema),
    retry: false,
    staleTime: 0,
  });
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [separatePrices, setSeparatePrices] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<MenuCreate["lines"]>([
    { ingredientId: null, subRecipeId: null, qty: "" },
  ]);
  const [packaging, setPackaging] = useState<MenuCreate["packaging"]>([]);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<MenuCreate | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const categorySaving = useRef(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const data = query.data;
  const ingredients = data?.ingredients.filter((i) => i.active) ?? [];
  let foodCost: number | null = null;
  try {
    if (data && lines.every((l) => Number(l.qty) > 0)) {
      const used = explodeBom(lines, data.recipes);
      foodCost = roundMoney(
        [...used].reduce(
          (n, [key, qty]) =>
            n.plus(
              qty.mul(data.ingredients.find((i) => i.id === key)?.avgCost ?? 0),
            ),
          new Decimal(0),
        ),
      );
    }
  } catch {
    /* Preview appears once the recipe is complete. */
  }
  function review() {
    if (categorySaving.current) return;
    setError("");
    setInvalid([]);
    let selectedPrices: MenuCreate["prices"];
    let priceField = "price";
    try {
      selectedPrices = channels.map((channel) => {
        priceField = separatePrices ? `prices.${channel}` : "price";
        return {
          channel,
          price: bahtPrice(separatePrices ? (prices[channel] ?? price) : price),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "กรุณาตรวจสอบราคา");
      setInvalid([priceField]);
      form.current
        ?.querySelector<HTMLInputElement>(`[name="${priceField}"]`)
        ?.focus();
      return;
    }
    const parsed = menuCreateSchema.safeParse({
      id,
      name,
      categoryId,
      prices: selectedPrices,
      lines,
      packaging,
      confirmed: true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" · "));
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      setInvalid(paths);
      form.current?.querySelector<HTMLElement>(`[name="${paths[0]}"]`)?.focus();
      return;
    }
    try {
      const used = explodeBom(parsed.data.lines, data?.recipes ?? []);
      if (
        !used.size ||
        [...used.keys()].some((key) => !ingredients.some((i) => i.id === key))
      )
        throw new Error(
          "สูตรที่เลือกไม่มีวัตถุดิบหรือมีวัตถุดิบปิดใช้งาน กรุณาตรวจสอบสูตร",
        );
      setConfirmation(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "กรุณาตรวจสอบสูตร");
    }
  }
  async function save() {
    if (!confirmation || saving.current) return;
    if (!online || !navigator.onLine) {
      setError("กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนเพิ่มเมนู");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/menus", confirmation);
      // A successful save must not be retried just because refreshing the catalogue failed.
      void queryClient.invalidateQueries({ queryKey: ["manage"] });
      void queryClient.invalidateQueries({ queryKey: ["menu-create-data"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      onCreated({ id: confirmation.id, name: confirmation.name });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "เชื่อมต่อไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const attrs = (key: string) => ({
    name: key,
    "aria-invalid": invalid.includes(key) || undefined,
    "aria-describedby": invalid.includes(key) ? "create-menu-error" : undefined,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving.current && !categorySaving.current) onClose();
      }}
      title={confirmation ? "ยืนยันเพิ่มเมนูใหม่" : "เพิ่มเมนูใหม่"}
      description="กำหนดสูตรสำหรับ 1 จาน เพื่อคำนวณต้นทุนและตัดสต็อกเมื่อขาย"
      wide
    >
      {!online && (
        <p role="status" className="mb-3 text-amber-800">
          กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนเพิ่มเมนู
        </p>
      )}
      {error && (
        <p
          id="create-menu-error"
          role="alert"
          className="mb-3 rounded-xl bg-red-50 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {!data ? (
        <div className="space-y-3">
          <p role="status">
            {query.error
              ? "โหลดข้อมูลไม่ได้ กรุณาเชื่อมต่อและลองใหม่"
              : "กำลังโหลดวัตถุดิบและหมวดหมู่…"}
          </p>
          <Button onClick={() => void query.refetch()}>ลองใหม่</Button>
        </div>
      ) : confirmation ? (
        <div className="space-y-4">
          <p className="text-xl font-bold">
            {confirmation.name} ·{" "}
            {
              data.categories.find((c) => c.id === confirmation.categoryId)
                ?.name
            }
          </p>
          <p>
            สูตรต่อจาน {confirmation.lines.length} รายการ · บรรจุภัณฑ์{" "}
            {confirmation.packaging.length} รายการ
          </p>
          <ul className="space-y-1">
            {confirmation.lines.map((line, index) => {
              const ingredient = data.ingredients.find(
                (i) => i.id === line.ingredientId,
              );
              const recipe = data.recipes.find(
                (r) => r.id === line.subRecipeId,
              );
              return (
                <li key={index}>
                  {ingredient?.name ?? recipe?.name}: {line.qty}{" "}
                  {ingredient?.usageUnit ?? recipe?.outputUnit} ต่อจาน
                </li>
              );
            })}
            {confirmation.packaging.map((line, index) => {
              const ingredient = data.ingredients.find(
                (i) => i.id === line.ingredientId,
              );
              return (
                <li key={`pack-${index}`}>
                  {channelNames[line.channel]} · {ingredient?.name}: {line.qty}{" "}
                  {ingredient?.usageUnit}
                </li>
              );
            })}
          </ul>
          <ul>
            {confirmation.prices.map((p) => (
              <li key={p.channel}>
                {channelNames[p.channel]}: {formatMoney(p.price)}
              </li>
            ))}
          </ul>
          <p>บันทึกแล้วจะเปิดขายทันที และเก็บประวัติการเพิ่มเมนูไว้</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                setError("");
              }}
            >
              กลับไปแก้ไข
            </Button>
            <Button disabled={busy || !online} onClick={() => void save()}>
              {busy ? "กำลังบันทึก…" : "ยืนยันบันทึกเมนู"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          ref={form}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              ชื่อเมนู
              <input
                {...attrs("name")}
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div>
              <label>
                หมวดหมู่
                <select
                  {...attrs("categoryId")}
                  aria-label="หมวดหมู่"
                  required
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">เลือกหมวดหมู่</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <CreateCategory
                online={online}
                onBusyChange={(value) => {
                  categorySaving.current = value;
                  setCategoryBusy(value);
                }}
                onCreated={(category) => {
                  queryClient.setQueryData<
                    z.infer<typeof menuCreateDataSchema>
                  >(["menu-create-data"], (old) =>
                    old
                      ? {
                          ...old,
                          categories: [
                            ...old.categories.filter(
                              (c) => c.id !== category.id,
                            ),
                            { id: category.id, name: category.name },
                          ],
                        }
                      : old,
                  );
                  setCategoryId(category.id);
                  setCategoryMessage(`เพิ่มหมวดหมู่ “${category.name}” แล้ว`);
                  setInvalid((current) =>
                    current.filter((key) => key !== "categoryId"),
                  );
                  void queryClient.invalidateQueries({
                    queryKey: ["menu-create-data"],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["bootstrap"],
                  });
                }}
              />
              {categoryMessage && (
                <p role="status" className="mt-2 text-emerald-800">
                  {categoryMessage}
                </p>
              )}
            </div>
            <label>
              ราคาขาย (บาท)
              <input
                {...attrs("price")}
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          </div>
          <p className="text-stone-600">
            ใช้ราคานี้ทุกช่องทาง หรือกำหนดราคาแยกในตัวเลือกเพิ่มเติมด้านล่าง
          </p>
          <fieldset className="space-y-3">
            <legend className="text-xl font-bold">สูตรต่อ 1 จาน</legend>
            {lines.map((line, index) => {
              const selected = line.ingredientId
                ? `i:${line.ingredientId}`
                : line.subRecipeId
                  ? `r:${line.subRecipeId}`
                  : "";
              const unit =
                ingredients.find((i) => i.id === line.ingredientId)
                  ?.usageUnit ??
                data.recipes.find((r) => r.id === line.subRecipeId)
                  ?.outputUnit ??
                "หน่วย";
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_180px_auto]"
                >
                  <label>
                    วัตถุดิบหรือสูตรย่อย {index + 1}
                    <select
                      {...attrs(`lines.${index}.ingredientId`)}
                      aria-label={`วัตถุดิบหรือสูตรย่อย ${index + 1}`}
                      required
                      value={selected}
                      onChange={(e) => {
                        const value = e.target.value;
                        setLines(
                          lines.map((l, n) =>
                            n === index
                              ? {
                                  ...l,
                                  ingredientId: value.startsWith("i:")
                                    ? value.slice(2)
                                    : null,
                                  subRecipeId: value.startsWith("r:")
                                    ? value.slice(2)
                                    : null,
                                }
                              : l,
                          ),
                        );
                      }}
                    >
                      <option value="">เลือกรายการ</option>
                      <optgroup label="วัตถุดิบ">
                        {ingredients.map((i) => (
                          <option key={i.id} value={`i:${i.id}`}>
                            {i.name} ({i.usageUnit})
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
                    จำนวน ({unit})
                    <input
                      {...attrs(`lines.${index}.qty`)}
                      aria-label={`จำนวนต่อจาน ${index + 1}`}
                      type="number"
                      inputMode="decimal"
                      min="0.000001"
                      step="0.000001"
                      required
                      value={line.qty}
                      onChange={(e) =>
                        setLines(
                          lines.map((l, n) =>
                            n === index ? { ...l, qty: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="self-end"
                    aria-label={`ลบส่วนผสม ${index + 1}`}
                    onClick={() =>
                      setLines(lines.filter((_, n) => n !== index))
                    }
                  >
                    ลบ
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              disabled={lines.length >= 100}
              onClick={() =>
                setLines([
                  ...lines,
                  { ingredientId: null, subRecipeId: null, qty: "" },
                ])
              }
            >
              เพิ่มส่วนผสม
            </Button>
            {foodCost !== null && (
              <p role="status">
                ต้นทุนวัตถุดิบประมาณ {formatMoney(foodCost)} ต่อจาน
                (ตามต้นทุนรับเข้าปัจจุบัน)
              </p>
            )}
          </fieldset>
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer font-bold">
              เพิ่มเติม: ราคาแต่ละช่องทางและบรรจุภัณฑ์
            </summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={separatePrices}
                  onChange={(e) => setSeparatePrices(e.target.checked)}
                />
                กำหนดราคาแยกตามช่องทาง
              </label>
              {separatePrices && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {channels.map((c) => (
                    <label key={c}>
                      {channelNames[c]} (บาท)
                      <input
                        {...attrs(`prices.${c}`)}
                        aria-label={`ราคา ${channelNames[c]}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={prices[c] ?? price}
                        onChange={(e) =>
                          setPrices({ ...prices, [c]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              <p>
                เลือกบรรจุภัณฑ์จากวัตถุดิบ
                เพื่อคิดต้นทุนและตัดสต็อกเฉพาะช่องทางที่เลือก
                หากไม่ใช้สามารถเว้นได้
              </p>
              {packaging.map((p, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-4">
                  <label>
                    ช่องทาง
                    <select
                      aria-label={`ช่องทางบรรจุภัณฑ์ ${index + 1}`}
                      value={p.channel}
                      onChange={(e) =>
                        setPackaging(
                          packaging.map((l, n) =>
                            n === index
                              ? {
                                  ...l,
                                  channel: channels.find(
                                    (c) => c === e.target.value,
                                  )!,
                                }
                              : l,
                          ),
                        )
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
                    บรรจุภัณฑ์
                    <select
                      {...attrs(`packaging.${index}.ingredientId`)}
                      required
                      value={p.ingredientId}
                      aria-label={`บรรจุภัณฑ์ ${index + 1}`}
                      onChange={(e) =>
                        setPackaging(
                          packaging.map((l, n) =>
                            n === index
                              ? { ...l, ingredientId: e.target.value }
                              : l,
                          ),
                        )
                      }
                    >
                      <option value="">เลือกรายการ</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.usageUnit})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    จำนวน
                    <input
                      {...attrs(`packaging.${index}.qty`)}
                      required
                      aria-label={`จำนวนบรรจุภัณฑ์ ${index + 1}`}
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={p.qty}
                      onChange={(e) =>
                        setPackaging(
                          packaging.map((l, n) =>
                            n === index ? { ...l, qty: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="self-end"
                    onClick={() =>
                      setPackaging(packaging.filter((_, n) => n !== index))
                    }
                  >
                    ลบบรรจุภัณฑ์ {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={packaging.length >= 100}
                onClick={() =>
                  setPackaging([
                    ...packaging,
                    { channel: "TAKEAWAY", ingredientId: "", qty: "1" },
                  ])
                }
              >
                เพิ่มบรรจุภัณฑ์
              </Button>
            </div>
          </details>
          <p className="text-stone-600">
            เพิ่มรูปภายหลังได้ที่ “สูตรและต้นทุน” → “รูปเมนู”
          </p>
          <Button
            type="submit"
            disabled={!online || !data.categories.length || categoryBusy}
          >
            ตรวจสอบและบันทึกเมนู
          </Button>
        </form>
      )}
    </Dialog>
  );
}
