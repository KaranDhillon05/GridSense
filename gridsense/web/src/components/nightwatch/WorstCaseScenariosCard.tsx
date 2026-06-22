"use client";

import { FadeIn } from "@/components/ui/motion";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import type { NWRunResult } from "@/lib/nightwatch/types";

const SEVERITY_COLOR: Record<string, string> = {
  low: "#22c55e",
  moderate: "#f59e0b",
  high: "#f97316",
  severe: "#ef4444",
};

export function WorstCaseScenariosCard({
  scenarios,
  onReplay,
}: {
  scenarios: NWRunResult[];
  onReplay: (result: NWRunResult) => void;
}) {
  return (
    <FadeIn delay={0.15}>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Worst-Case Scenarios
        </div>

        <div className="space-y-2">
          {scenarios.map((r, i) => {
            const spec = INCIDENT_CATALOG[r.scenario.incidentType];
            const sevColor = SEVERITY_COLOR[r.scenario.severity] ?? "#9ca3af";
            const baseVHL = r.baselineMetrics.vehicleHoursLost.toFixed(1);
            const respVHL = r.responseMetrics.vehicleHoursLost.toFixed(1);
            const imp = r.improvementPct.toFixed(0);
            const startH = Math.floor(r.scenario.startTimeSec / 3600)
              .toString()
              .padStart(2, "0");
            const startM = Math.floor((r.scenario.startTimeSec % 3600) / 60)
              .toString()
              .padStart(2, "0");

            return (
              <div key={i} className="rounded-xl bg-white/5 px-3 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: sevColor }}
                      />
                      <span className="text-xs font-medium text-white truncate">{spec.label}</span>
                      <span className="text-[10px] text-white/30 shrink-0">@ {startH}:{startM}</span>
                    </div>
                    <div className="text-[11px] text-white/40 truncate pl-4">{r.scenario.edgeName}</div>
                  </div>
                  <button
                    onClick={() => onReplay(r)}
                    className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-[#0071e3]/20 text-[#60a5fa] hover:bg-[#0071e3]/30 transition-colors"
                  >
                    Replay
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white/5 px-2 py-1.5">
                    <div className="text-[9px] text-white/30 uppercase tracking-wide">Without</div>
                    <div className="text-[11px] font-bold text-[#ef4444]">{baseVHL} veh·h</div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-2 py-1.5">
                    <div className="text-[9px] text-white/30 uppercase tracking-wide">With</div>
                    <div className="text-[11px] font-bold text-[#22c55e]">{respVHL} veh·h</div>
                  </div>
                  <div className="rounded-lg bg-[#22c55e]/10 px-2 py-1.5">
                    <div className="text-[9px] text-white/30 uppercase tracking-wide">Saved</div>
                    <div className="text-[11px] font-bold text-[#22c55e]">{imp}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FadeIn>
  );
}
