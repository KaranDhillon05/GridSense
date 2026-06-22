"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { WorkflowBoard } from "@/components/ops/WorkflowBoard";
import { buildTaskViews, workflowMetrics } from "@/lib/ops/workflow";

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="surface-panel-map px-4 py-3 min-w-[110px]">
      <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: color ?? "#1d1d1f" }}>
        {value}
      </div>
      <div className="text-[10px] text-[#6e6e73] mt-1 uppercase tracking-wide">{label}</div>
    </div>
  );
}

export default function WorkflowsPage() {
  const state = useOps();
  const views = useMemo(() => buildTaskViews(state), [state]);
  const m = useMemo(() => workflowMetrics(views), [views]);

  return (
    <div className="content-width py-6 px-4">
      <OpsTickerMount />

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Workflow Engine</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Every recommendation becomes a tracked task
          </p>
        </div>
        <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
          Operations Center →
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Stat label="Completion" value={`${m.completionPct}%`} color="#16a34a" />
        <Stat label="Open" value={m.open} />
        <Stat label="SLA breaches" value={m.slaBreaches} color={m.slaBreaches ? "#ef4444" : undefined} />
        <Stat label="Blocked" value={m.blocked} color={m.blocked ? "#f59e0b" : undefined} />
        <Stat label="Total tasks" value={m.total} />
      </div>

      {m.bySource.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5 text-[11px] text-[#6e6e73]">
          {m.bySource.map((s) => (
            <span key={s.source} className="bg-[#f5f5f7] rounded-full px-3 py-1">
              {s.source}: <span className="font-semibold text-[#1d1d1f]">{s.n}</span>
            </span>
          ))}
        </div>
      )}

      <WorkflowBoard tasks={views} />
    </div>
  );
}
