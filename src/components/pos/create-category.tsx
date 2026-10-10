"use client";
import { useId, useRef, useState } from "react";
import {
  categoryCreateSchema,
  categoryCreatedSchema,
  normalizeCategoryName,
  type CreatedCategory,
} from "@/domain/category-create";
import { Button } from "@/components/ui/button";
export function CreateCategory({
  online,
  onCreated,
  onBusyChange,
}: {
  online: boolean;
  onCreated: (category: CreatedCategory) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const saving = useRef(false),
    attempt = useRef<{ id: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    errorId = useId(),
    editorId = useId();
  async function save() {
    if (saving.current) return;
    setError("");
    if (!online || !navigator.onLine) {
      setError("กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนเพิ่มหมวดหมู่");
      return;
    }
    const normalized = normalizeCategoryName(name);
    if (!attempt.current || attempt.current.name !== normalized)
      attempt.current = { id: crypto.randomUUID(), name: normalized };
    const parsed = categoryCreateSchema.safeParse({
      ...attempt.current,
      confirmed: true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      input.current?.focus();
      return;
    }
    saving.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(15000),
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result === "object" &&
            result &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "บันทึกหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่",
        );
      const { category } = categoryCreatedSchema.parse(result);
      onCreated(category);
      setOpen(false);
      setName("");
      attempt.current = null;
    } catch (e) {
      setError(
        e instanceof Error && e.name === "Error"
          ? e.message
          : "เชื่อมต่อไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง",
      );
    } finally {
      saving.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        aria-expanded={false}
        aria-controls={editorId}
        disabled={!online}
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        + เพิ่มหมวดหมู่
      </Button>
    );
  return (
    <fieldset
      id={editorId}
      className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"
      disabled={busy}
    >
      <legend className="font-bold">หมวดหมู่ใหม่</legend>
      <label>
        ชื่อหมวดหมู่ใหม่
        <input
          ref={input}
          name="newCategoryName"
          autoFocus
          aria-label="ชื่อหมวดหมู่ใหม่"
          enterKeyHint="done"
          required
          maxLength={100}
          value={name}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              void save();
            }
          }}
        />
      </label>
      {error && (
        <p id={errorId} role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <p className="text-sm text-stone-600">
        บันทึกแล้วจะเลือกหมวดหมู่นี้ให้เมนูที่กำลังเพิ่ม
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !online}
          onClick={() => void save()}
        >
          {busy ? "กำลังบันทึก…" : "บันทึกหมวดหมู่"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          ยกเลิกเพิ่มหมวดหมู่
        </Button>
      </div>
    </fieldset>
  );
}
