"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/client-api";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/domain/pricing";
const schema = z.object({
  orderNo: z.string(),
  queueNo: z.string(),
  status: z.string(),
  total: z.number(),
  lines: z.array(
    z.object({
      id: z.string(),
      menuName: z.string(),
      qty: z.number(),
      lineTotal: z.number(),
    }),
  ),
});
export default function Order({ params }: { params: { id: string } }) {
  const query = useQuery({
    queryKey: ["order", params.id],
    queryFn: () => apiGet(`/api/orders/${params.id}`, schema),
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AdminShell title="บิลต้นทาง">
      {query.data ? (
        <section className="rounded-xl bg-white p-5">
          <p className="break-all">{query.data.orderNo}</p>
          <h2 className="text-3xl font-bold">คิว {query.data.queueNo}</h2>
          <p>{query.data.status === "PAID" ? "ชำระแล้ว" : "ยกเลิกแล้ว"}</p>
          {query.data.lines.map((l) => (
            <p className="border-b py-3" key={l.id}>
              {l.qty} × {l.menuName} · {formatMoney(l.lineTotal)}
            </p>
          ))}
          <p className="my-4 text-2xl">รวม {formatMoney(query.data.total)}</p>
          <Button
            variant="destructive"
            disabled={query.data.status !== "PAID"}
            onClick={() => setOpen(true)}
          >
            ยกเลิกบิลและคืนสต็อก
          </Button>
        </section>
      ) : (
        <p>{query.error?.message ?? "กำลังโหลด…"}</p>
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
            void apiPost(`/api/orders/${params.id}`, {
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
