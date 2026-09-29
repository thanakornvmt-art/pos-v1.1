import { Suspense } from "react";
import { notFound } from "next/navigation";
import { reportSections } from "@/domain/report-sections";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";

export default async function ReportPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const section = reportSections.find(
    (s) => s.id === view && s.id !== "summary",
  );
  if (!section) notFound();
  return (
    <Suspense fallback={<p className="p-6">กำลังโหลดรายงาน…</p>}>
      <ReportsWorkspace view={section.id} />
    </Suspense>
  );
}
