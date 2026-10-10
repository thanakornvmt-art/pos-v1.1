"use client";
import { useState } from "react";
import { z } from "zod";
import {
  categoryInputSchema,
  menuInputSchema,
  type AdminData,
} from "@/domain/admin";
import { channels, channelNames } from "@/domain/schema";
import { apiPost } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function MenuCatalogEditor({
  data,
  selectedCategory,
  reload,
}: {
  data: AdminData;
  selectedCategory: string;
  reload: () => Promise<unknown>;
}) {
  const [menu, setMenu] = useState<{
    id: string;
    sku: string;
    name: string;
    categoryId: string;
    prices: Record<string, string>;
  } | null>(null);
  const [category, setCategory] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(kind: "menu" | "category") {
    if (busy) return;
    setError("");
    try {
      const value =
        kind === "category"
          ? categoryInputSchema.parse(category)
          : menuInputSchema.parse({
              ...menu,
              prices: channels.map((channel) => {
                const text = menu?.prices[channel]?.trim() ?? "";
                if (!/^\d+(\.\d{1,2})?$/.test(text))
                  throw new Error(
                    "กรุณากรอกราคาทุกช่องทางเป็นจำนวนเงินไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง",
                  );
                const [baht, satang = ""] = text.split(".");
                return {
                  channel,
                  price: Number(baht) * 100 + Number(satang.padEnd(2, "0")),
                };
              }),
            });
      setBusy(true);
      await apiPost("/api/manage", { kind, data: value });
      await reload();
      if (kind === "menu") setMenu(null);
      else setCategory(null);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(" · ")
          : e instanceof Error
            ? e.message
            : "บันทึกไม่ได้",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError("");
            setMenu({
              id: crypto.randomUUID(),
              sku: "",
              name: "",
              categoryId:
                selectedCategory !== "all"
                  ? selectedCategory
                  : (data.categories[0]?.id ?? ""),
              prices: Object.fromEntries(channels.map((c) => [c, "0"])),
            });
          }}
        >
          + เพิ่มเมนู
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            setCategory({ id: crypto.randomUUID(), name: "" });
          }}
        >
          + สร้างหมวดหมู่
        </Button>
        {selectedCategory !== "all" && (
          <Button
            variant="outline"
            onClick={() => {
              const current = data.categories.find(
                (c) => c.id === selectedCategory,
              );
              if (current) {
                setError("");
                setCategory({ id: current.id, name: current.name });
              }
            }}
          >
            แก้ไขชื่อหมวดหมู่
          </Button>
        )}
      </div>
      <Dialog
        open={Boolean(category)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setCategory(null);
            setError("");
          }
        }}
        title={
          data.categories.some((c) => c.id === category?.id)
            ? "แก้ไขหมวดหมู่"
            : "สร้างหมวดหมู่"
        }
      >
        {category && (
          <form
            method="post"
            action="/api/manage"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("category");
            }}
          >
            <label htmlFor="category-name">ชื่อหมวดหมู่ *</label>
            <input
              id="category-name"
              name="categoryName"
              required
              maxLength={100}
              value={category.name}
              disabled={busy}
              onChange={(e) =>
                setCategory({ ...category, name: e.target.value })
              }
            />
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "กำลังบันทึก…" : "บันทึกหมวดหมู่"}
            </Button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(menu)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setMenu(null);
            setError("");
          }
        }}
        title="เพิ่มเมนู"
        description="เมนูใหม่จะปิดขายไว้ก่อน เมื่อบันทึกสูตรแล้วให้เปิดขายในแท็บ เมนู / เปิด–ปิดขาย"
        wide
      >
        {menu && (
          <form
            method="post"
            action="/api/manage"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("menu");
            }}
          >
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 font-bold">ข้อมูลเมนู</legend>
              <label>
                รหัสเมนู *
                <input
                  name="sku"
                  required
                  maxLength={50}
                  value={menu.sku}
                  onChange={(e) => setMenu({ ...menu, sku: e.target.value })}
                />
              </label>
              <label>
                ชื่อเมนู *
                <input
                  name="menuName"
                  required
                  maxLength={100}
                  value={menu.name}
                  onChange={(e) => setMenu({ ...menu, name: e.target.value })}
                />
              </label>
              <label>
                หมวดหมู่ *
                <select
                  name="categoryId"
                  required
                  value={menu.categoryId}
                  onChange={(e) =>
                    setMenu({ ...menu, categoryId: e.target.value })
                  }
                >
                  <option value="">เลือกหมวดหมู่</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {!data.categories.length && (
              <p>กรุณาปิดหน้าต่างนี้แล้วสร้างหมวดหมู่ก่อนเพิ่มเมนู</p>
            )}
            <fieldset
              disabled={busy}
              className="grid gap-3 sm:grid-cols-2 md:grid-cols-3"
            >
              <legend className="mb-2 font-bold">ราคาขาย (บาท)</legend>
              {channels.map((c) => (
                <label key={c}>
                  {channelNames[c]}
                  <input
                    name={`price-${c}`}
                    required
                    inputMode="decimal"
                    value={menu.prices[c]}
                    onChange={(e) =>
                      setMenu({
                        ...menu,
                        prices: { ...menu.prices, [c]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "กำลังบันทึก…" : "บันทึกเมนู"}
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
