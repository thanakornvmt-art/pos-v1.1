"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { liveQuery } from "dexie";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { PrinterControls, usePrinter } from "@/components/print/provider";
import { useRuntime } from "@/components/pos/runtime";
import { localDb, type LocalOrder } from "@/lib/offline/db";
import { historySchema } from "@/domain/order-history";
import { apiGet } from "@/lib/client-api";
import { formatMoney } from "@/domain/pricing";
import { thaiDate } from "@/lib/utils";
export default function Orders() {
  const printer = usePrinter();
  const runtime = useRuntime();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [local, setLocal] = useState<LocalOrder[]>([]);
  const [error, setError] = useState("");
  const cursor = pages.at(-1);
  const query = useQuery({
    queryKey: ["orders", filter, cursor],
    queryFn: () =>
      apiGet(
        `/api/orders?${filter}${cursor ? `&cursor=${cursor}` : ""}`,
        historySchema,
      ),
  });
  useEffect(() => {
    const sub = liveQuery(() => localDb.orders.toArray()).subscribe(setLocal);
    return () => sub.unsubscribe();
  }, []);
  const offline = local.filter(
    (row) =>
      (runtime.boot?.user.role === "OWNER" ||
        row.order.createdBy === runtime.boot?.user.id) &&
      (row.state !== "synced" || query.isError) &&
      `${row.receipt.orderNo} ${row.receipt.queueNo}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <AdminShell title="บิลเก่า / พิมพ์ซ้ำ">
      <Link href="/pos" className="mb-4 inline-block underline">
        กลับหน้าขาย
      </Link>
      <PrinterControls />
      <form
        className="my-4 grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPages([]);
          setFilter(
            new URLSearchParams({
              q: search,
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
            }).toString(),
          );
        }}
      >
        <label>
          เลขบิล / เลขคิว
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={80}
          />
        </label>
        <label>
          ตั้งแต่
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          ถึง
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button className="self-end" type="submit">
          ค้นหาบิล
        </Button>
      </form>
      <p role="status">{error || query.error?.message}</p>
      {offline.length > 0 && (
        <section className="mb-4 rounded-xl bg-amber-50 p-3">
          <h2 className="font-bold">บิลในเครื่อง / รอส่งข้อมูล</h2>
          {offline
            .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt))
            .map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-3"
              >
                <p>
                  คิว {row.receipt.queueNo} · {thaiDate(row.order.createdAt)} ·{" "}
                  {formatMoney(row.receipt.total)}
                  <br />
                  {row.state === "synced"
                    ? "ข้อมูลสำเนาในเครื่อง อาจมีการแก้ไขจากเครื่องอื่น"
                    : row.error || "รอส่งเข้าระบบ ก่อนแก้ไขบิล"}
                </p>
                <Button
                  disabled={printer.busy}
                  onClick={() =>
                    void printer
                      .printCopy(row.id, row.receipt)
                      .catch((e) => setError(e.message))
                  }
                >
                  พิมพ์สำเนาในเครื่อง
                </Button>
              </div>
            ))}
        </section>
      )}
      <div className="space-y-3">
        {query.data?.orders.map((row) => (
          <Link
            key={row.clientUuid}
            href={`/orders/${row.clientUuid}`}
            className="block break-words rounded-xl border bg-white p-4"
          >
            <strong>
              คิว {row.queueNo} · {formatMoney(row.total)}
            </strong>
            <p>{row.orderNo}</p>
            <p>
              {thaiDate(row.createdAt)} ·{" "}
              {row.status === "PAID" ? "ชำระแล้ว" : "ยกเลิก / แก้ไขแล้ว"}
            </p>
            <span className="underline">เปิดบิล / พิมพ์ซ้ำ</span>
          </Link>
        ))}
      </div>
      {query.isPending ? (
        <p>กำลังโหลดบิล…</p>
      ) : query.data?.orders.length === 0 ? (
        <p>ไม่พบบิลในช่วงที่เลือก</p>
      ) : null}
      <div className="mt-4 flex gap-3">
        <Button
          variant="outline"
          disabled={!pages.length}
          onClick={() => setPages((p) => p.slice(0, -1))}
        >
          ก่อนหน้า
        </Button>
        <Button
          disabled={!query.data?.nextCursor}
          onClick={() => {
            if (query.data?.nextCursor)
              setPages((p) => [...p, query.data!.nextCursor!]);
          }}
        >
          ถัดไป
        </Button>
      </div>
    </AdminShell>
  );
}
