"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { orderDetailSchema } from "@/domain/order-history";
import { PaidOrderEditor } from "@/components/paid-order-editor";
import { PrinterControls, usePrinter } from "@/components/print/provider";
import { ReceiptView } from "@/components/print/receipt";
import { apiGet, apiPost } from "@/lib/client-api";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/domain/pricing";
export default function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const printer = usePrinter();
  const [edit, setEdit] = useState(false);
  const query = useQuery({
    queryKey: ["order", id],
    queryFn: () => apiGet(`/api/orders/${id}`, orderDetailSchema),
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AdminShell title="บิลต้นทาง">
      <Link className="mb-4 inline-block underline" href="/orders">
        กลับรายการบิลเก่า
      </Link>
      <PrinterControls />
      {query.data ? (
        <section className="rounded-xl bg-white p-5">
          <p className="break-all">{query.data.orderNo}</p>
          <h2 className="text-3xl font-bold">คิว {query.data.queueNo}</h2>
          <p>{query.data.status === "PAID" ? "ชำระแล้ว" : "ยกเลิกแล้ว"}</p>
          <ReceiptView receipt={query.data.receipt} kind="CUSTOMER" />
          <p className="my-4 text-2xl">รวม {formatMoney(query.data.total)}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={printer.busy}
              onClick={() =>
                void printer
                  .printCopy(id, query.data!.receipt)
                  .catch((e) => setError(e.message))
              }
            >
              พิมพ์ใบเสร็จซ้ำ
            </Button>
            {query.data.canEdit && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                แก้ไขบิลที่ชำระแล้ว
              </Button>
            )}
            {query.data.canEdit && (
              <Button
                variant="destructive"
                disabled={query.data.status !== "PAID"}
                onClick={() => setOpen(true)}
              >
                ยกเลิกบิลและคืนสต็อก
              </Button>
            )}
          </div>
          <p role="status">{error}</p>
          {query.data.voidReason && <p>{query.data.voidReason}</p>}
          {query.data.replacementId && (
            <Link
              className="underline"
              href={`/orders/${query.data.replacementId}`}
            >
              เปิดบิลฉบับแก้ไข
            </Link>
          )}
          {query.data.replacesId && (
            <Link
              className="underline"
              href={`/orders/${query.data.replacesId}`}
            >
              ดูบิลเดิมก่อนแก้ไข
            </Link>
          )}
        </section>
      ) : (
        <p>{query.error?.message ?? "กำลังโหลด…"}</p>
      )}
      {edit && query.data?.canEdit && (
        <PaidOrderEditor order={query.data} onClose={() => setEdit(false)} />
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="ยืนยันยกเลิกบิลหลังชำระ?"
        description="สร้างรายการย้อนกลับ คืนสต็อก และบันทึก audit log โดยเก็บบิลเดิมไว้"
      >
        <label>
          เหตุผล
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="my-3 text-red-700">{error}</p>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void apiPost(`/api/orders/${id}`, {
              reason,
              confirmed: true,
            })
              .then(async () => {
                setOpen(false);
                await query.refetch();
              })
              .catch((e) =>
                setError(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ"),
              )
              .finally(() => setBusy(false));
          }}
        >
          ยืนยันยกเลิก
        </Button>
      </Dialog>
    </AdminShell>
  );
}
