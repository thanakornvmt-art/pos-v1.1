"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/domain/pricing";
import { lineSchema, type CartLine, type Menu } from "@/domain/schema";
export function Options({
  menu,
  onClose,
  onAdd,
  initial,
}: {
  menu: Menu;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
  initial?: CartLine;
}) {
  const [ids, setIds] = useState<string[]>(initial?.optionIds ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  function add() {
    try {
      for (const g of menu.groups) {
        const n = g.items.filter((o) => ids.includes(o.id)).length;
        if (n < Math.max(g.minSelect, g.isRequired ? 1 : 0) || n > g.maxSelect)
          throw new Error(`เลือก ${g.name} ให้ครบ`);
      }
      onAdd(
        lineSchema.parse({
          id: initial?.id ?? crypto.randomUUID(),
          menuItemId: menu.id,
          qty: initial?.qty ?? 1,
          optionIds: ids,
          note,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "ข้อมูลไม่ถูกต้อง");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={menu.name}
      description="เลือกเพิ่มได้ หรือกดเพิ่มลงบิลทันที"
    >
      <div className="space-y-5">
        {menu.groups.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 font-bold">
              {g.name}{" "}
              <span className="font-normal text-stone-600">
                เลือกได้ {g.maxSelect}
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {g.items.map((o) => (
                <Button
                  variant={ids.includes(o.id) ? "default" : "outline"}
                  key={o.id}
                  onClick={() =>
                    setIds((current) =>
                      current.includes(o.id)
                        ? current.filter((id) => id !== o.id)
                        : g.maxSelect === 1
                          ? [
                              ...current.filter(
                                (id) => !g.items.some((i) => i.id === id),
                              ),
                              o.id,
                            ]
                          : [...current, o.id],
                    )
                  }
                >
                  {o.name}
                  {o.priceDelta > 0 && ` +${formatMoney(o.priceDelta)}`}
                </Button>
              ))}
            </div>
          </section>
        ))}
        <label>
          หมายเหตุถึงครัว
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="เช่น แยกน้ำซุป"
          />
        </label>
        <p className="text-red-700">{error}</p>
        <Button className="sticky bottom-0 w-full text-xl" onClick={add}>
          {initial ? "บันทึกตัวเลือก" : "เพิ่มลงบิล"}
        </Button>
      </div>
    </Dialog>
  );
}
