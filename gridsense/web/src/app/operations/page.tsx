"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import { resetOpsState } from "@/lib/ops/store";
import { OpsMap } from "@/components/ops/OpsMap";
import { MetricsStrip } from "@/components/ops/MetricsStrip";
import { ResourcePanel } from "@/components/ops/ResourcePanel";
import { DeploymentList } from "@/components/ops/DeploymentList";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { OpsBriefCard } from "@/components/ops/OpsBriefCard";
import { OpsCopilot } from "@/components/ops/OpsCopilot";
import { SEVERITY_COLOR, STATUS_LABEL, formatClock } from "@/lib/ops/format";
import { prettyCause } from "@/lib/ui";
import { INCIDENT_STATUS_ORDER } from "@/lib/ops/types";

export default function OperationsCenter() {
  const state = useOps();
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const ranked = useMemo(
    () =>
      [...state.incidents]
        .filter((i) => i.status !== "closed")
        .sort((a, b) => {
          const order =
            INCIDENT_STATUS_ORDER.indexOf(a.status) - INCIDENT_STATUS_ORDER.indexOf(b.status);
          return order !== 0
            ? order
            : ({ severe: 0, high: 1, moderate: 2, low: 3 }[a.severity] -
                { severe: 0, high: 1, moderate: 2, low: 3 }[b.severity]);
        }),
    [state.incidents]
  );

  return (
    <div className="page-full relative overflow-hidden bg-[#f5f5f7]">
      <OpsTickerMount />

      <div className="absolute inset-0">
        <OpsMap state={state} selectedId={selected} />
      </div>

      <OpsCopilot state={state} />

      {/* Top metrics + clock */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex items-start gap-2 flex-wrap pointer-events-none">
        <div className="pointer-events-auto">
          <MetricsStrip metrics={state.metrics} />
        </div>
        <div className="surface-panel-map px-3 py-2 pointer-events-auto ml-auto flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${state.running ? "bg-[#22c55e] animate-pulse" : "bg-[#a1a1a6]"}`}
          />
          <span className="text-sm font-semibold tabular-nums text-[#1d1d1f]">
            {formatClock(state.clockMs)}
          </span>
          <span className="text-[10px] text-[#6e6e73] uppercase tracking-wide">
            {state.running ? "live" : "paused"}
          </span>
        </div>
      </div>

      {/* Sidebar toggle (mobile) */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute bottom-4 right-3 z-[1001] lg:hidden surface-panel-map px-4 py-2 text-sm font-medium text-[#1d1d1f]"
      >
        {panelOpen ? "Hide panel" : "Operations"}
      </button>

      {/* Command sidebar */}
      <aside
        className={`absolute top-20 bottom-3 z-[999] w-[min(400px,calc(100vw-1.5rem))] transition-transform duration-300 right-3 ${
          panelOpen ? "translate-x-0" : "translate-x-[calc(100%+0.75rem)] lg:translate-x-0"
        }`}
      >
        <div className="surface-panel-map h-full flex flex-col overflow-hidden">
          <div className="p-4 border-b border-black/[0.06] shrink-0 flex items-baseline justify-between">
            <div>
              <h2 className="font-semibold text-[#1d1d1f] text-lg leading-tight">
                Operations Center
              </h2>
              <p className="text-xs text-[#6e6e73] mt-0.5">Live operating picture</p>
            </div>
            <button
              type="button"
              onClick={resetOpsState}
              className="text-[11px] text-[#6e6e73] hover:text-[#1d1d1f]"
              title="Re-seed the demo"
            >
              reset
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* AI Operations Brief */}
            <OpsBriefCard state={state} />

            {/* Incidents */}
            <section>
              <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2 px-1">
                Active incidents · {ranked.length}
              </div>
              <div className="space-y-1.5">
                {ranked.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setSelected(i.id)}
                    className={`w-full text-left rounded-xl border p-2.5 bg-white transition-colors ${
                      selected === i.id
                        ? "border-[#0071e3] shadow-[0_0_0_1px_#0071e3]"
                        : "border-black/[0.08] hover:border-black/[0.16]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: SEVERITY_COLOR[i.severity] }}
                      />
                      <span className="text-sm font-medium text-[#1d1d1f] truncate flex-1">
                        {prettyCause(i.type)}
                      </span>
                      <span className="text-[10px] text-[#6e6e73] shrink-0">
                        {STATUS_LABEL[i.status]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 pl-4.5">
                      <span className="text-[11px] text-[#6e6e73] truncate">{i.corridor}</span>
                      <Link
                        href={`/incidents/${i.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-[#0071e3] hover:underline shrink-0 ml-2"
                      >
                        Command →
                      </Link>
                    </div>
                  </button>
                ))}
                {ranked.length === 0 && (
                  <div className="text-xs text-[#6e6e73] p-2">No active incidents.</div>
                )}
              </div>
            </section>

            {/* Resources */}
            <section>
              <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2 px-1">
                Resources
              </div>
              <div className="bg-white rounded-xl border border-black/[0.06] p-3">
                <ResourcePanel resources={state.resources} />
              </div>
            </section>

            {/* Deployments */}
            <section>
              <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2 px-1">
                Active deployments
              </div>
              <div className="bg-white rounded-xl border border-black/[0.06] p-3">
                <DeploymentList deployments={state.deployments} />
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
