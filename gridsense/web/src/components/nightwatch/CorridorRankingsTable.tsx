"use client";

import { FadeIn } from "@/components/ui/motion";
import type { CorridorVulnerability } from "@/lib/nightwatch/types";

function riskColor(score: number, max: number): string {
  const pct = score / Math.max(max, 1);
  if (pct > 0.75) return "#ef4444";
  if (pct > 0.5) return "#f97316";
  if (pct > 0.25) return "#f59e0b";
  return "#22c55e";
}

export function CorridorRankingsTable({
  corridors,
  selectedEdge,
  onSelect,
}: {
  corridors: CorridorVulnerability[];
  selectedEdge: string | null;
  onSelect: (edgeId: string) => void;
}) {
  const maxRisk = corridors[0]?.riskScore ?? 1;

  return (
    <FadeIn delay={0.05}>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Top Vulnerable Corridors
          </div>
          <span className="text-[10px] text-white/30 px-2 py-0.5 bg-white/5 rounded-full">
            {corridors.length} corridors ranked
          </span>
        </div>

        <div className="space-y-2">
          {corridors.slice(0, 10).map((c, i) => {
            const color = riskColor(c.riskScore, maxRisk);
            const barPct = (c.riskScore / maxRisk) * 100;
            const isSelected = selectedEdge === c.edgeId;
            return (
              <button
                key={c.edgeId}
                onClick={() => onSelect(c.edgeId)}
                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all ${
                  isSelected
                    ? "bg-white/10 ring-1 ring-white/20"
                    : "bg-white/5 hover:bg-white/8"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-white/30 w-4 shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-white truncate">{c.name}</span>
                      <span className="text-[10px] tabular-nums shrink-0" style={{ color }}>
                        {c.avgDelayVehMin.toFixed(0)} veh·min
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${barPct}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px] text-white/30">
                      <span>Queue {c.avgQueueM.toFixed(0)}m</span>
                      <span>Spillover {c.avgSpillover.toFixed(1)} edges</span>
                      <span>{c.incidentCount} incidents</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </FadeIn>
  );
}
