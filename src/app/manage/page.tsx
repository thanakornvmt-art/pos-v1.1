"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { z } from "zod";
import {
  adminSchema,
  costs,
  ingredientSchema,
  recipeSchema,
  type AdminData,
  type IngredientInput,
  type RecipeInput,
} from "@/domain/admin";
import { explodeBom } from "@/domain/inventory";
import { channels, channelNames } from "@/domain/schema";
import { formatMoney, roundMoney } from "@/domain/pricing";
import { apiGet, apiPost } from "@/lib/client-api";
import { downloadCsv } from "@/lib/csv";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { MenuImages } from "@/components/menu-images";
export default function Manage() {
  const query = useQuery({
    queryKey: ["manage"],
    queryFn: () => apiGet("/api/manage", adminSchema),
  });
  const [tab, setTab] = useState("ingredients");
  const [ingredient, setIngredient] = useState<IngredientInput | null>(null);
  const [recipe, setRecipe] = useState<RecipeInput | null>(null);
  const [bom, setBom] = useState<AdminData["menus"][number] | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    payload: unknown;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [supplier, setSupplier] = useState({
    id: "",
    name: "",
    phone: "",
    lineId: "",
  });
  const data = query.data;
  async function save() {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/manage", confirmation.payload);
      await query.refetch();
      setConfirmation(null);
      setIngredient(null);
      setRecipe(null);
      setBom(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่ได้");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <AdminShell title="สูตรและต้นทุน">
        <p role="status">{query.error?.message ?? "กำลังโหลด…"}</p>
        <Button asChild>
          <a href="/login">เข้าสู่ระบบเจ้าของร้าน</a>
        </Button>
      </AdminShell>
    );
  let marginRows: ReturnType<typeof costs> = [];
  try {
    marginRows = data.menus
      .flatMap((m) => costs(data, m))
      .sort((a, b) => a.profit - b.profit);
  } catch {
    /* Formula validation is shown in editor. */
  }
  const units = data.ingredients.filter((i) => i.active);
  function showError(e: unknown) {
    setError(
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join(" · ")
        : e instanceof Error
          ? e.message
          : "ข้อมูลไม่ถูกต้อง",
    );
  }
  const recipePreview = () => {
    if (!recipe) return "";
    try {
      const graph = [
        ...data!.recipes.filter((r) => r.id !== recipe.id),
        recipe,
      ];
      const used = explodeBom(recipe.lines, graph, undefined, [recipe.id]);
      const cost = [...used].reduce(
        (n, [id, qty]) =>
          n.plus(
            qty.mul(data!.ingredients.find((i) => i.id === id)?.avgCost ?? 0),
          ),
        new Decimal(0),
      );
      return `ต้นทุนต่อหน่วย ${formatMoney(roundMoney(cost.div(recipe.outputQty)))} · รวม ${formatMoney(roundMoney(cost))}`;
    } catch (e) {
      return e instanceof Error ? e.message : "สูตรไม่ถูกต้อง";
    }
  };
  const lineEditor = (
    lines: RecipeInput["lines"],
    onChange: (lines: RecipeInput["lines"]) => void,
  ) => (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_64px] gap-2 sm:grid-cols-[minmax(0,1fr)_120px_64px]"
          key={index}
        >
          <select
            className="col-span-2 sm:col-span-1"
            aria-label={`วัตถุดิบหรือสูตร ${index + 1}`}
            value={
              line.ingredientId
                ? "i:" + line.ingredientId
                : "r:" + line.subRecipeId
            }
            onChange={(e) =>
              onChange(
                lines.map((l, i) =>
                  i === index
                    ? {
                        ...l,
                        ingredientId: e.target.value.startsWith("i:")
                          ? e.target.value.slice(2)
                          : null,
                        subRecipeId: e.target.value.startsWith("r:")
                          ? e.target.value.slice(2)
                          : null,
                      }
                    : l,
                ),
              )
            }
          >
            <optgroup label="วัตถุดิบ">
              {units.map((i) => (
                <option key={i.id} value={"i:" + i.id}>
                  {i.name} ({i.usageUnit})
                </option>
              ))}
            </optgroup>
            <optgroup label="สูตรย่อย">
              {data.recipes
                .filter((r) => r.id !== recipe?.id)
                .map((r) => (
                  <option key={r.id} value={"r:" + r.id}>
                    {r.name} ({r.outputUnit})
                  </option>
                ))}
            </optgroup>
          </select>
          <input
            aria-label={`ปริมาณ ${index + 1}`}
            inputMode="decimal"
            value={line.qty}
            onChange={(e) =>
              onChange(
                lines.map((l, i) =>
                  i === index ? { ...l, qty: e.target.value } : l,
                ),
              )
            }
          />
          <Button
            variant="outline"
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            ลบ
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          onChange([
            ...lines,
            { ingredientId: units[0]?.id ?? null, subRecipeId: null, qty: "1" },
          ])
        }
      >
        + เพิ่มส่วนประกอบ
      </Button>
    </div>
  );
  return (
    <AdminShell title="สูตรและต้นทุน">
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          ["ingredients", "วัตถุดิบ"],
          ["recipes", "สูตรย่อย"],
          ["bom", "สูตรรายเมนู"],
          ["images", "รูปเมนู"],
          ["profit", "กำไรรายเมนู"],
          ["suppliers", "ซัพพลายเออร์"],
        ].map(([id, name]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "outline"}
            onClick={() => setTab(id)}
          >
            {name}
          </Button>
        ))}
      </div>
      {tab === "images" && (
        <MenuImages menus={data.menus} reload={query.refetch} />
      )}
      {tab === "ingredients" && (
        <>
          <Button
            onClick={() =>
              setIngredient({
                id: crypto.randomUUID(),
                name: "",
                purchaseUnit: "",
                usageUnit: "",
                conversionRate: "1",
                yieldPercent: "100",
                parLevel: "0",
                reorderPoint: "0",
                isPerishable: false,
                shelfLifeDays: null,
                supplierId: null,
              })
            }
          >
            + เพิ่มวัตถุดิบ
          </Button>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {units.map((i) => (
              <article key={i.id} className="rounded-2xl bg-white p-5">
                <h2 className="text-xl font-bold">{i.name}</h2>
                <p>
                  คงเหลือ {i.currentQty} {i.usageUnit} · yield {i.yieldPercent}%
                </p>
                <p>
                  ต้นทุน {formatMoney(roundMoney(i.avgCost))}/{i.usageUnit}
                </p>
                <p>
                  Par {i.parLevel} · จุดสั่ง {i.reorderPoint}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const { avgCost, currentQty, active, ...input } = i;
                      void avgCost;
                      void currentQty;
                      void active;
                      setIngredient(input);
                    }}
                  >
                    แก้ไข
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setConfirmation({
                        title: `ปิดใช้งาน ${i.name}?`,
                        payload: {
                          kind: "archiveIngredient",
                          id: i.id,
                          confirmed: true,
                        },
                      })
                    }
                  >
                    ปิดใช้งาน
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "recipes" && (
        <>
          <Button
            onClick={() =>
              setRecipe({
                id: crypto.randomUUID(),
                name: "",
                outputQty: "1",
                outputUnit: "",
                lines: [],
              })
            }
          >
            + เพิ่มสูตรย่อย
          </Button>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.recipes.map((r) => (
              <article key={r.id} className="rounded-xl bg-white p-5">
                <h2 className="text-xl font-bold">{r.name}</h2>
                <p>
                  ผลผลิต {r.outputQty} {r.outputUnit}
                </p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setRecipe(r)}
                >
                  แก้สูตร / ดูต้นทุน
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "bom" && (
        <div className="grid gap-3 md:grid-cols-3">
          {data.menus.map((m) => (
            <Button key={m.id} variant="outline" onClick={() => setBom(m)}>
              {m.name}
            </Button>
          ))}
        </div>
      )}
      {tab === "profit" && (
        <>
          <p className="mb-4">
            เรียงกำไรต่อจานจากน้อยที่สุด · Food cost = ต้นทุนอาหาร ÷
            ราคาขายก่อนภาษี · กำไรหัก GP และบรรจุภัณฑ์แล้ว
          </p>
          <Button
            onClick={() =>
              downloadCsv("กำไรรายเมนู.csv", [
                [
                  "เมนู",
                  "ช่องทาง",
                  "ราคา(สตางค์)",
                  "ต้นทุนอาหาร",
                  "บรรจุภัณฑ์",
                  "กำไร",
                  "Food cost %",
                ],
                ...marginRows.map((r) => [
                  r.name,
                  channelNames[r.channel],
                  r.price,
                  r.food,
                  r.packaging,
                  r.profit,
                  r.foodCostBps === null
                    ? ""
                    : new Decimal(r.foodCostBps).div(100).toString(),
                ]),
              ])
            }
          >
            Export CSV
          </Button>
          <MarginTable
            rows={marginRows}
            onPrice={(r, price) =>
              setConfirmation({
                title: `ยืนยันราคา ${r.name} ${channelNames[r.channel]} เป็น ${formatMoney(price)}?`,
                payload: {
                  kind: "price",
                  id: r.menuId,
                  channel: r.channel,
                  price,
                  confirmed: true,
                },
              })
            }
          />
        </>
      )}
      {tab === "suppliers" && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-xl bg-white p-5">
            {data.suppliers.map((s) => (
              <Button
                key={s.id}
                variant="outline"
                className="w-full"
                onClick={() => setSupplier(s)}
              >
                {s.name} · {s.phone}
              </Button>
            ))}
          </section>
          <section className="space-y-3 rounded-xl bg-white p-5">
            <label>
              ชื่อซัพพลายเออร์
              <input
                value={supplier.name}
                onChange={(e) =>
                  setSupplier({ ...supplier, name: e.target.value })
                }
              />
            </label>
            <label>
              โทร
              <input
                value={supplier.phone}
                onChange={(e) =>
                  setSupplier({ ...supplier, phone: e.target.value })
                }
              />
            </label>
            <label>
              LINE
              <input
                value={supplier.lineId}
                onChange={(e) =>
                  setSupplier({ ...supplier, lineId: e.target.value })
                }
              />
            </label>
            <Button
              onClick={() =>
                setConfirmation({
                  title: "บันทึกซัพพลายเออร์?",
                  payload: {
                    kind: "supplier",
                    data: {
                      ...supplier,
                      id: supplier.id || crypto.randomUUID(),
                    },
                  },
                })
              }
            >
              บันทึก
            </Button>
          </section>
        </div>
      )}
      <Dialog
        open={Boolean(ingredient)}
        onOpenChange={(o) => {
          if (!o) setIngredient(null);
        }}
        title="ข้อมูลวัตถุดิบ"
        wide
      >
        {ingredient && (
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                "name",
                "purchaseUnit",
                "usageUnit",
                "conversionRate",
                "yieldPercent",
                "parLevel",
                "reorderPoint",
              ] as const
            ).map((key, index) => (
              <label key={key}>
                {
                  [
                    "ชื่อ",
                    "หน่วยซื้อ",
                    "หน่วยใช้",
                    "จำนวนหน่วยใช้ต่อหน่วยซื้อ",
                    "Yield %",
                    "Par level",
                    "Reorder point",
                  ][index]
                }
                <input
                  value={ingredient[key]}
                  onChange={(e) =>
                    setIngredient({ ...ingredient, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              ซัพพลายเออร์
              <select
                value={ingredient.supplierId ?? ""}
                onChange={(e) =>
                  setIngredient({
                    ...ingredient,
                    supplierId: e.target.value || null,
                  })
                }
              >
                <option value="">ยังไม่ระบุ</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ของสด
              <select
                value={String(ingredient.isPerishable)}
                onChange={(e) =>
                  setIngredient({
                    ...ingredient,
                    isPerishable: e.target.value === "true",
                  })
                }
              >
                <option value="false">ไม่ใช่</option>
                <option value="true">ใช่</option>
              </select>
            </label>
            <label>
              อายุเก็บ (วัน)
              <input
                type="number"
                value={ingredient.shelfLifeDays ?? ""}
                onChange={(e) =>
                  setIngredient({
                    ...ingredient,
                    shelfLifeDays: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <Button
              onClick={() => {
                try {
                  ingredientSchema.parse(ingredient);
                  setConfirmation({
                    title: "ยืนยันบันทึกวัตถุดิบ?",
                    payload: { kind: "ingredient", data: ingredient },
                  });
                } catch (e) {
                  showError(e);
                }
              }}
            >
              บันทึกวัตถุดิบ
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(recipe)}
        onOpenChange={(o) => {
          if (!o) setRecipe(null);
        }}
        title="แก้สูตรย่อย"
        wide
      >
        {recipe && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label>
                ชื่อสูตร
                <input
                  value={recipe.name}
                  onChange={(e) =>
                    setRecipe({ ...recipe, name: e.target.value })
                  }
                />
              </label>
              <label>
                ปริมาณผลผลิต
                <input
                  value={recipe.outputQty}
                  onChange={(e) =>
                    setRecipe({ ...recipe, outputQty: e.target.value })
                  }
                />
              </label>
              <label>
                หน่วยผลผลิต
                <input
                  value={recipe.outputUnit}
                  onChange={(e) =>
                    setRecipe({ ...recipe, outputUnit: e.target.value })
                  }
                />
              </label>
            </div>
            {lineEditor(recipe.lines, (lines) =>
              setRecipe({ ...recipe, lines }),
            )}
            <p role="status" className="rounded-xl bg-amber-50 p-4 text-xl">
              {recipePreview()}
            </p>
            <Button
              onClick={() => {
                try {
                  recipeSchema.parse(recipe);
                  setConfirmation({
                    title: "ยืนยันเปลี่ยนสูตร?",
                    payload: { kind: "recipe", data: recipe },
                  });
                } catch (e) {
                  showError(e);
                }
              }}
            >
              บันทึกสูตร
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(bom)}
        onOpenChange={(o) => {
          if (!o) setBom(null);
        }}
        title={bom ? `BOM · ${bom.name}` : "BOM"}
        wide
      >
        {bom && (
          <div className="space-y-4">
            {lineEditor(bom.bom, (lines) => setBom({ ...bom, bom: lines }))}
            <BomPreview data={data} menu={bom} />
            <Button
              onClick={() =>
                setConfirmation({
                  title: "ยืนยันเปลี่ยนสูตรเมนู?",
                  payload: {
                    kind: "bom",
                    id: bom.id,
                    lines: bom.bom,
                    confirmed: true,
                  },
                })
              }
            >
              บันทึก BOM
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(o) => {
          if (!o && !busy) setConfirmation(null);
        }}
        title={confirmation?.title ?? "ยืนยัน"}
        description="ระบบจะบันทึกผู้แก้ไขและข้อมูลก่อน/หลังใน audit log"
      >
        <p role="status" className="mb-3 text-red-700">
          {error}
        </p>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "ยืนยัน"}
        </Button>
      </Dialog>
      {error && !confirmation && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </AdminShell>
  );
}
function BomPreview({
  data,
  menu,
}: {
  data: AdminData;
  menu: AdminData["menus"][number];
}) {
  try {
    return <MarginTable rows={costs(data, menu)} />;
  } catch (e) {
    return (
      <p className="text-red-700">
        {e instanceof Error ? e.message : "สูตรไม่ถูกต้อง"}
      </p>
    );
  }
}
function MarginTable({
  rows,
  onPrice,
}: {
  rows: ReturnType<typeof costs>;
  onPrice?: (row: ReturnType<typeof costs>[number], price: number) => void;
}) {
  return (
    <div className="mt-4 overflow-auto">
      <table className="w-full border-collapse bg-white text-left">
        <thead className="bg-stone-200">
          <tr>
            {[
              "เมนู / ช่องทาง",
              "ราคา",
              "ต้นทุนอาหาร",
              "แพ็ก",
              "กำไร",
              "Food cost",
              "ราคา 35% / ชดเชย GP",
            ].map((h) => (
              <th key={h} className="p-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.menuId + r.channel}
              className={`border-b ${r.foodCostBps !== null && r.foodCostBps > 4000 ? "bg-red-100 text-red-900" : ""}`}
            >
              <td className="p-3">
                {r.name}
                <p>{channelNames[r.channel]}</p>
              </td>
              <td className="p-3">{formatMoney(r.price)}</td>
              <td className="p-3">{formatMoney(r.food)}</td>
              <td className="p-3">{formatMoney(r.packaging)}</td>
              <td className="p-3 font-bold">{formatMoney(r.profit)}</td>
              <td className="p-3">
                {r.foodCostBps === null
                  ? "—"
                  : `${new Decimal(r.foodCostBps).div(100).toFixed(1)}%`}
              </td>
              <td className="p-3">
                <div className="flex gap-2">
                  {onPrice ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => onPrice(r, r.suggested35)}
                      >
                        {formatMoney(r.suggested35)}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => onPrice(r, r.suggestedDelivery)}
                      >
                        GP {formatMoney(r.suggestedDelivery)}
                      </Button>
                    </>
                  ) : (
                    `${formatMoney(r.suggested35)} / ${formatMoney(r.suggestedDelivery)}`
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
