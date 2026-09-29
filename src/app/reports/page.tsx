import { Suspense } from "react";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";

export default function Reports() {
  return (
    <Suspense fallback={<p className="p-6">กำลังโหลดรายงาน…</p>}>
      <ReportsWorkspace />
    </Suspense>
  );
}
