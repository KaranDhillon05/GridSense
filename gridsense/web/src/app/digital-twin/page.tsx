"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import { OpsMap, type OpsLayers } from "@/components/ops/OpsMap";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { detectEmergingRisks } from "@/lib/ops/digitalTwin";
import { MetricsStrip } from "@/components/ops/MetricsStrip";
import { formatClock } from "@/lib/ops/format";

const RISK_COLOR = { critical: "#ef4444", warning: "#f59e0b", watch: "#0071e3" } as const;

type Sample = { t: number; active: number; committed: number; saved: number };

function Trend({ samples }: { samples: Sample[] }) {
  if (samples.length < 2) return <div className="text-[11px] text-[#a1a1a6]">Gathering trend…</div>;
  const w = 240;
  const h = 44;
  const maxActive = Math.max(4, ...samples.map((s) => s.active));
  const maxCommitted = Math.max(4, ...samples.map((s) => s.committed));
  const line = (key: "active" | "committed", max: number) =>
    samples
      .map((s, i) => {
        const x = (i / (samples.length - 1)) * w;
        const y = h - (s[key] / max) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
      <path d={line("active", maxActive)} fill="none" stroke="#ef4444" strokeWidth={1.5} />
      <path d={line("committed", maxCommitted)} fill="none" stroke="#0071e3" strokeWidth={1.5} />
    </svg>
  );
}

export default function DigitalTwinPage() {
  const state = useOps();
  const [layers, setLayers] = useState<OpsLayers>({ incidents: true, resources: true, deployments: true });
  const risks = useMemo(() => detectEmergingRisks(state), [state]);

  // Live rolling trend of operational state (in-memory, not persisted).
  const [history, setHistory] = useState<Sample[]>([]);
  useEffect(() => {
    const sample: Sample = {
      t: state.clockMs,
      active: state.metrics.activeIncidents,
      committed: state.metrics.resourcesCommitted,
      saved: state.metrics.vehicleHoursSavedToday,
    };
    const id = setTimeout(() => setHistory((prev) => [...prev, sample].slice(-60)), 0);
    return () => clearTimeout(id);
  }, [state.clockMs, state.metrics]);

  const toggle = (k: keyof OpsLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <div className="page-full relative overflow-hidden bg-[#f5f5f7]">
      <OpsTickerMount />
      <div className="absolute inset-0">
        <OpsMap state={state} layers={layers} />
      </div>

      {/* Top bar */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex items-start gap-2 flex-wrap pointer-events-none">
        <div className="pointer-events-auto">
          <MetricsStrip metrics={state.metrics} />
        </div>
        <div className="surface-panel-map px-3 py-2 pointer-events-auto ml-auto flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${state.running ? "bg-[#22c55e] animate-pulse" : "bg-[#a1a1a6]"}`} />
          <span className="text-sm font-semibold tabular-nums text-[#1d1d1f]">{formatClock(state.clockMs)}</span>
        </div>
      </div>

      {/* Left: layers */}
      <div className="absolute bottom-4 left-3 z-[1000] surface-panel-map p-3 w-[180px]">
        <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2">
          Operational layers
        </div>
        {(["incidents", "resources", "deployments"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className="flex items-center gap-2 w-full text-left py-1 text-sm capitalize"
            style={{ color: layers[k] ? "#1d1d1f" : "#a1a1a6" }}
          >
            <span
              className="w-9 h-5 rounded-full relative transition-colors shrink-0"
              style={{ background: layers[k] ? "#0071e3" : "#e8e8ed" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                style={{ left: layers[k] ? 18 : 2 }}
              />
            </span>
            {k}
          </button>
        ))}
      </div>

      {/* Right sidebar */}
      <aside className="absolute top-20 bottom-3 right-3 z-[999] w-[min(380px,calc(100vw-1.5rem))]">
        <div className="surface-panel-map h-full flex flex-col overflow-hidden">
          <div className="p-4 border-b border-black/[0.06] shrink-0 flex items-baseline justify-between">
            <div>
              <h2 className="font-semibold text-[#1d1d1f] text-lg leading-tight">Digital Twin 2.0</h2>
              <p className="text-xs text-[#6e6e73] mt-0.5">Operational state · not vehicle-level</p>
            </div>
            <Link href="/simulation" className="text-[11px] text-[#0071e3] hover:underline shrink-0">
              vehicle sim →
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <section className="rounded-2xl border border-black/[0.08] bg-white p-3.5">
              <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-1">
                State trend
              </div>
              <Trend samples={history} />
              <div className="flex gap-3 text-[10px] text-[#6e6e73]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-[#ef4444] inline-block" /> active incidents
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-[#0071e3] inline-block" /> committed units
                </span>
              </div>
            </section>

            <section>
              <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2 px-1">
                AI Twin Analyst · emerging risks
              </div>
              <div className="space-y-2">
                {risks.length === 0 && (
                  <div className="text-xs text-[#6e6e73] bg-white rounded-xl border border-black/[0.06] p-3">
                    No emerging risks — operational state nominal.
                  </div>
                )}
                {risks.map((r) => {
                  const body = (
                    <div className="rounded-xl bg-white border border-black/[0.08] p-3">
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-1 w-2 h-2 rounded-full shrink-0"
                          style={{ background: RISK_COLOR[r.level] }}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#1d1d1f] leading-snug">{r.title}</div>
                          <div className="text-[11px] text-[#6e6e73] mt-0.5 leading-snug">{r.detail}</div>
                        </div>
                      </div>
                    </div>
                  );
                  return r.incidentId ? (
                    <Link key={r.id} href={`/incidents/${r.incidentId}`} className="block">
                      {body}
                    </Link>
                  ) : (
                    <div key={r.id}>{body}</div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
