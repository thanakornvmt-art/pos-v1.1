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
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-950/60" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[94dvh] w-[calc(100%-16px)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-cream p-3 shadow-xl sm:w-[94vw] sm:rounded-3xl sm:p-6",
            wide && "max-w-5xl",
          )}
        >
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <div className="min-w-0 break-words">
              <DialogPrimitive.Title className="text-2xl font-bold">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-stone-600">
                {description ?? "ตรวจสอบข้อมูลก่อนยืนยันรายการ"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="ปิด"
              className="flex min-h-16 min-w-16 shrink-0 items-center justify-center rounded-xl border-2 border-stone-300"
            >
              <X />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
            {children}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-stone-200 pt-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
