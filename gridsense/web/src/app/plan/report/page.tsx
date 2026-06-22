"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TechnicalPlanReport } from "@/components/playbook/TechnicalPlanReport";
import { loadReportPayload, type ReportPayload } from "@/lib/reportStore";
import { PillButton } from "@/components/ui/PillButton";

type Payload = ReportPayload;

function ReportContent() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadReportPayload();
    if (loaded) {
      setPayload(loaded);
      return;
    }
    setError("No scenario data found. Open the report from the planning console (/plan).");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (error) {
    return (
      <div className="p-12 text-[#6e6e73]">
        <strong className="text-[#1d1d1f]">Report data unavailable</strong>
        <p className="mt-2">{error}</p>
        <a href="/plan" className="text-[#0071e3] mt-4 inline-block">← Back to planning console</a>
      </div>
    );
  }

  if (!payload) {
    return <div className="p-12 text-[#6e6e73]">Loading report…</div>;
  }

  return (
    <>
      <div className="no-print sticky top-0 z-[100] glass-nav px-6 py-3 flex gap-4 items-center">
        <a href="/plan" className="text-sm text-[#0071e3]">← Back to console</a>
        <span className="flex-1" />
        <PillButton type="button" onClick={() => window.print()}>
          Print / Export PDF
        </PillButton>
      </div>
      <TechnicalPlanReport result={payload.result} input={payload.input} />
    </>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="p-12 text-[#6e6e73]">Loading report…</div>}>
      <ReportContent />
    </Suspense>
  );
}
