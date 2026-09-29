"use client";

import { useState, type ReactNode } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReportCell =
  string | number | { value: string | number; display: ReactNode };
export type ReportRow = { id: string; cells: ReportCell[] };
export type ExportReport = (
  name: string,
  headers: string[],
  rows: (string | number | null)[][],
) => void;
const valueOf = (cell: ReportCell) =>
  typeof cell === "object" ? cell.value : cell;
const PAGE_SIZE = 25;

export function ReportTable({
  title,
  description,
  headers,
  rows,
  exportRows,
}: {
  title: string;
  description?: string;
  headers: string[];
  rows: ReportRow[];
  exportRows: ExportReport;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const term = search.trim().toLocaleLowerCase("th-TH");
  const filtered = rows.filter((row) =>
    row.cells.some((cell) =>
      String(valueOf(cell)).toLocaleLowerCase("th-TH").includes(term),
    ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );
  return (
    <section
      className="min-w-0 rounded-2xl border border-stone-200 bg-white p-3 sm:p-5"
      aria-label={title}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">{title}</h2>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={!filtered.length}
          onClick={() =>
            exportRows(
              title,
              headers,
              filtered.map((row) => row.cells.map(valueOf)),
            )
          }
        >
          <Download size={18} /> ส่งออก CSV
        </Button>
      </div>
      <label className="mb-4 max-w-md">
        <span className="flex items-center gap-2 text-sm">
          <Search size={16} /> ค้นหาในรายงาน
        </span>
        <input
          type="search"
          value={search}
          placeholder="พิมพ์ชื่อหรือเลขที่บิล"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {filtered.length ? (
        <>
          <div
            className="max-w-full overflow-x-auto rounded-xl border border-stone-200"
            tabIndex={0}
            role="region"
            aria-label={`ตาราง${title}`}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title} · จำนวนเงินเป็นบาท</caption>
              <thead className="bg-stone-100">
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="whitespace-nowrap px-4 py-4 font-semibold"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-stone-200 hover:bg-amber-50/50"
                  >
                    {row.cells.map((cell, index) => (
                      <td
                        key={headers[index]}
                        className="whitespace-nowrap px-4 py-4 tabular-nums"
                      >
                        {typeof cell === "object" ? cell.display : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-600" role="status">
              {filtered.length.toLocaleString("th-TH")} รายการ · หน้า {current}{" "}
              / {pages}
            </p>
            {pages > 1 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  variant="outline"
                  disabled={current === pages}
                  onClick={() => setPage(current + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <p
          role="status"
          className="rounded-xl bg-stone-50 p-8 text-center text-stone-500"
        >
          {term
            ? "ไม่พบรายการที่ตรงกับคำค้นหา"
            : "ไม่มีข้อมูลในช่วงวันที่เลือก"}
        </p>
      )}
    </section>
  );
}
