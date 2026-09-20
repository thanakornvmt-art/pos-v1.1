"use client";
import { useState } from "react";
import type { AdminData } from "@/domain/admin";
import { apiPost } from "@/lib/client-api";
import { useRuntime } from "@/components/pos/runtime";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function MenuImages({
  menus,
  reload,
}: {
  menus: AdminData["menus"];
  reload: () => Promise<unknown>;
}) {
  const runtime = useRuntime();
  const [selected, setSelected] = useState<AdminData["menus"][number] | null>(
    null,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 10 MB");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 40000000)
          throw new Error("ความละเอียดรูปสูงเกินไป กรุณาย่อรูปก่อน");
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("เครื่องนี้ไม่สามารถเตรียมรูปได้");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        setPreview(canvas.toDataURL("image/jpeg", 0.85));
        setChanged(true);
      } finally {
        bitmap.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "เปิดรูปไม่ได้");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/menu-image", {
        menuId: selected.id,
        image: preview,
        confirmed: true,
      });
      await reload();
      await runtime.refresh();
      setConfirming(false);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกรูปไม่ได้");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="mb-4">
        เลือกรูปจากเครื่อง JPG, PNG หรือ WebP ไม่เกิน 10 MB
        ระบบย่อรูปให้อัตโนมัติ · บันทึกขณะออนไลน์
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {menus.map((menu) => (
          <article key={menu.id} className="space-y-3 rounded-xl bg-white p-4">
            {menu.imageUrl ? (
              <img
                src={menu.imageUrl}
                alt={menu.name}
                className="h-40 w-full rounded-xl object-contain"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl bg-amber-50">
                ยังไม่มีรูป
              </div>
            )}
            <h2 className="text-xl font-bold">{menu.name}</h2>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(menu);
                setPreview(menu.imageUrl);
                setChanged(false);
                setError("");
              }}
            >
              เพิ่ม / เปลี่ยนรูป {menu.name}
            </Button>
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
        title={`รูปเมนู ${selected?.name ?? ""}`}
      >
        <div className="space-y-4">
          {preview ? (
            <img
              src={preview}
              alt="ตัวอย่างรูปเมนู"
              className="h-56 w-full rounded-xl object-contain"
            />
          ) : (
            <p>ยังไม่มีรูป</p>
          )}
          <label className="block">
            เลือกรูปเมนู
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void choose(file);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !changed}
              onClick={() => setConfirming(true)}
            >
              บันทึกรูป
            </Button>
            <Button
              variant="outline"
              disabled={busy || !preview}
              onClick={() => {
                setPreview(null);
                setChanged(true);
              }}
            >
              เอารูปออก
            </Button>
          </div>
          {!confirming && error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
        title={preview ? "ยืนยันเปลี่ยนรูปเมนู?" : "ยืนยันเอารูปเมนูออก?"}
        description="ระบบบันทึกประวัติการแก้ไข รูปจะปรากฏเมื่อเครื่องขายรับข้อมูลเมนูล่าสุด"
      >
        {error && (
          <p role="alert" className="mb-3 text-red-700">
            {error}
          </p>
        )}
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "ยืนยัน"}
        </Button>
      </Dialog>
    </>
  );
}
