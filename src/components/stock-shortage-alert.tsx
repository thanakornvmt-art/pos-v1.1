"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet } from "@/lib/client-api";
const schema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    currentQty: z.string(),
    usageUnit: z.string(),
  }),
);
export function StockShortageAlert() {
  const { data, error } = useQuery({
    queryKey: ["stock-shortages"],
    queryFn: () => apiGet("/api/stock/shortages", schema),
    refetchInterval: 30000,
  });
  if (error)
    return (
      <p className="no-print bg-amber-50 px-4 py-2 text-sm">
        ตรวจยอดสต็อกขาดไม่ได้: {error.message}
      </p>
    );
  if (!data?.length) return null;
  return (
    <div role="alert" className="no-print bg-red-50 px-4 py-2 text-red-900">
      <Link href="/stock" className="font-bold underline">
        สต็อกติดลบ {data.length} รายการ — ตรวจนับและกระทบยอด
      </Link>
      <p className="text-sm">
        {data
          .slice(0, 3)
          .map((row) => `${row.name} ${row.currentQty} ${row.usageUnit}`)
          .join(" · ")}{" "}
        · ส่งบิลค้างจากทุกเครื่องให้ครบก่อนกระทบยอด
      </p>
    </div>
  );
}
