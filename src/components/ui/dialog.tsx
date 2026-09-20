"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-950/60" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[94dvh] w-[94vw] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl bg-cream p-6 shadow-xl",
            wide && "max-w-5xl",
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-2xl font-bold">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-stone-600">
                {description ?? "ตรวจสอบข้อมูลก่อนยืนยันรายการ"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="ปิด"
              className="flex min-h-16 min-w-16 items-center justify-center rounded-xl border-2 border-stone-300"
            >
              <X />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
