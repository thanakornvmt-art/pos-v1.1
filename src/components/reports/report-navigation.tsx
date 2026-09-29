"use client";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChartColumn, ChevronDown } from "lucide-react";
import { reportSections } from "@/domain/report-sections";
import { dateRangeSchema } from "@/domain/reports";

function ReportLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const parsed = dateRangeSchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
  });
  const query = parsed.success ? `?${new URLSearchParams(parsed.data)}` : "";
  return (
    <nav
      aria-label="ประเภทรายงาน"
      className="ml-3 mt-2 grid gap-1 border-l border-stone-600 pl-3"
    >
      {reportSections.map((section) => (
        <Link
          key={section.id}
          href={section.href + query}
          onClick={onNavigate}
          aria-current={pathname === section.href ? "page" : undefined}
          className={`rounded-lg px-3 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 ${pathname === section.href ? "bg-green-950 font-semibold text-green-300" : "text-stone-200 hover:bg-stone-700"}`}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

export function ReportMenu({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active =
    pathname.startsWith("/reports") || pathname.startsWith("/orders/");
  return (
    <>
      {!mobile && (
        <Link
          href="/reports"
          aria-label="รายงาน"
          title="รายงาน"
          className={`flex min-h-16 items-center justify-center rounded-xl xl:hidden ${active ? "bg-primary text-ink" : "hover:bg-stone-700"}`}
        >
          <ChartColumn size={24} />
        </Link>
      )}
      <details
        open={active}
        className={
          mobile ? "rounded-xl bg-ink p-2 text-white" : "hidden xl:block"
        }
      >
        <summary
          className={`flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-xl px-3 font-semibold [&::-webkit-details-marker]:hidden ${active ? "bg-stone-800 text-green-300" : "hover:bg-stone-700"}`}
        >
          <ChartColumn size={24} className="shrink-0" />
          <span className="flex-1">รายงาน</span>
          <ChevronDown size={18} />
        </summary>
        <Suspense fallback={<Link href="/reports">สรุปยอดขาย</Link>}>
          <ReportLinks onNavigate={onNavigate} />
        </Suspense>
      </details>
    </>
  );
}
