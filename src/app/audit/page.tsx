"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client-api";
import { thaiDate } from "@/lib/utils";
import { auditViewSchema } from "@/domain/audit";
const today = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
export default function AuditPage() {
  const [filters, setFilters] = useState(() => ({
    from: today(),
    to: today(),
    action: "",
    entityId: "",
  }));
  const [query, setQuery] = useState(filters);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const result = useQuery({
    queryKey: ["audit", query, cursor],
    queryFn: () =>
      apiGet(
        `/api/audit?${new URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) })}`,
        auditViewSchema,
      ),
  });
  return (
    <AdminShell title="ประวัติการทำรายการ">
      <p className="mb-4">
        เวลาไทย · แสดงครั้งละ 50 รายการ · สต็อกขาดใช้รหัส STOCK_SHORTAGE
      </p>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ ...filters });
          setCursors([]);
        }}
      >
        <label>
          ตั้งแต่
          <input
            type="date"
            required
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          ถึง
          <input
            type="date"
            required
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <label>
          รหัสการทำรายการ
          <input
            placeholder="เช่น VOID_ORDER"
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          />
        </label>
        <label>
          รหัสข้อมูล
          <input
            value={filters.entityId}
            onChange={(e) =>
              setFilters({ ...filters, entityId: e.target.value })
            }
          />
        </label>
        <Button type="submit">ค้นหา</Button>
      </form>
      {result.error && (
        <p role="alert" className="text-red-700">
          {result.error.message}
        </p>
      )}
      {result.isPending && <p>กำลังโหลด…</p>}
      {result.data?.rows.length === 0 && <p>ไม่พบประวัติในช่วงที่เลือก</p>}
      <div className="space-y-3">
        {result.data?.rows.map((row) => (
          <article className="rounded-xl bg-white p-4" key={row.id}>
            <h2 className="font-bold">
              {row.action} · {row.user.name}
            </h2>
            <p>{thaiDate(row.createdAt)}</p>
            <p className="break-all text-sm">
              {row.entity} · {row.entityId}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer">ดูข้อมูลก่อน / หลัง</summary>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm">
                {JSON.stringify(
                  { before: row.beforeJson, after: row.afterJson },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <Button
          variant="outline"
          disabled={!cursors.length || result.isFetching}
          onClick={() => setCursors((old) => old.slice(0, -1))}
        >
          ก่อนหน้า
        </Button>
        <Button
          disabled={!result.data?.nextCursor || result.isFetching}
          onClick={() => {
            if (result.data?.nextCursor)
              setCursors((old) => [...old, result.data!.nextCursor!]);
          }}
        >
          ถัดไป
        </Button>
      </div>
    </AdminShell>
  );
}
