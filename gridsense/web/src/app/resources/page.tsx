"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import { assignResource } from "@/lib/ops/store";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { OpsMap } from "@/components/ops/OpsMap";
import { buildResourceIntel } from "@/lib/ops/resourceIntel";
import { PillButton } from "@/components/ui/PillButton";

const STATUS_COLOR = {
  available: "#22c55e",
  enroute: "#f59e0b",
  onscene: "#0071e3",
  returning: "#a1a1a6",
} as const;

export default function ResourcesPage() {
  const state = useOps();
  const intel = useMemo(() => buildResourceIntel(state), [state]);

  return (
    <div className="content-width py-6 px-4">
      <OpsTickerMount />

      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Resource Intelligence</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Live fleet · {intel.committed}/{intel.total} committed ({intel.utilizationPct}%) — where units should go now
          </p>
        </div>
        <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
          Operations Center →
        </Link>
      </div>

      <div className="grid lg:grid-cols-[1fr_minmax(340px,420px)] gap-5 items-start">
        {/* Map + fleet */}
        <div className="space-y-5">
          <div className="h-[320px] rounded-2xl overflow-hidden border border-black/[0.08] relative">
            <OpsMap state={state} />
          </div>

          <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
            <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Fleet status</div>
            <div className="space-y-2.5">
              {intel.fleet.map((g) => (
                <div key={g.type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-[#1d1d1f] font-medium">{g.label}</span>
                    <span className="text-xs text-[#6e6e73] tabular-nums">
                      {g.available}/{g.total} free
                    </span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-[#f0f0f2]">
                    {(["onscene", "enroute", "returning", "available"] as const).map((s) =>
                      g.statuses[s] ? (
                        <div
                          key={s}
                          style={{
                            width: `${(g.statuses[s] / g.total) * 100}%`,
                            background: STATUS_COLOR[s],
                          }}
                          title={`${s}: ${g.statuses[s]}`}
                        />
                      ) : null
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-black/[0.05] text-[10px] text-[#6e6e73]">
              {(["available", "enroute", "onscene", "returning"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Reposition recommendations */}
        <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#0071e3] mb-1">
            AI Resource Commander
          </div>
          <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Dispatch recommendations</div>
          {intel.recommendations.length === 0 ? (
            <p className="text-xs text-[#6e6e73]">
              All active incidents are resourced. Fleet optimally positioned.
            </p>
          ) : (
            <div className="space-y-2.5">
              {intel.recommendations.map((r) => (
                <div key={r.id} className="rounded-xl bg-[#f5f5f7] p-3">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: r.priority === "high" ? "#ef4444" : "#f59e0b" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f] leading-snug">
                        Move {r.resourceLabel}
                      </div>
                      <Link
                        href={`/incidents/${r.incidentId}`}
                        className="text-[11px] text-[#0071e3] hover:underline"
                      >
                        → {r.incidentTitle}
                      </Link>
                      <div className="text-[11px] text-[#6e6e73] mt-0.5">{r.reason}</div>
                    </div>
                  </div>
                  <PillButton
                    variant="secondary"
                    onClick={() => assignResource(r.resourceId, r.incidentId)}
                    className="!py-1.5 !px-3 text-xs mt-2 w-full"
                  >
                    Dispatch now
                  </PillButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
