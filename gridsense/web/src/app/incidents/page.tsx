"use client";

import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import { IncidentBoard } from "@/components/ops/IncidentBoard";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { formatClock } from "@/lib/ops/format";

export default function IncidentsPage() {
  const state = useOps();
  const active = state.incidents.filter((i) => i.status !== "closed").length;

  return (
    <div className="content-width py-6 px-4">
      <OpsTickerMount />

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Incident Management</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Every incident is a lifecycle object · {active} active
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
            Operations Center →
          </Link>
          <span className="surface-panel-map px-3 py-1.5 flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${state.running ? "bg-[#22c55e] animate-pulse" : "bg-[#a1a1a6]"}`}
            />
            <span className="tabular-nums font-semibold text-[#1d1d1f]">
              {formatClock(state.clockMs)}
            </span>
          </span>
        </div>
      </div>

      <IncidentBoard incidents={state.incidents} clockMs={state.clockMs} />
    </div>
  );
}
