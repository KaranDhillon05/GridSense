"use client";

import { FadeIn } from "@/components/ui/motion";
import type { NWReport } from "@/lib/nightwatch/types";

export function ResponseReadinessCard({ report }: { report: NWReport }) {
  const { resourceSufficiencyPct, avgImprovementPct, totalRunsWithGridlock, runCount } = report;

  const gridlockPct = (totalRunsWithGridlock / runCount) * 100;

  const items = [
    {
      label: "Resource Sufficiency",
      value: `${resourceSufficiencyPct.toFixed(0)}%`,
      desc: "Simulations where resources were available when needed",
      color: resourceSufficiencyPct >= 80 ? "#22c55e" : resourceSufficiencyPct >= 60 ? "#f59e0b" : "#ef4444",
      pct: resourceSufficiencyPct,
    },
    {
      label: "Intervention Effectiveness",
      value: `${avgImprovementPct.toFixed(0)}%`,
      desc: "Average delay reduction when response is applied",
      color: avgImprovementPct >= 30 ? "#22c55e" : avgImprovementPct >= 15 ? "#f59e0b" : "#ef4444",
      pct: Math.min(100, avgImprovementPct * 2),
    },
    {
      label: "Gridlock Avoidance",
      value: `${(100 - gridlockPct).toFixed(0)}%`,
      desc: "Simulations that did not reach gridlock with response",
      color: gridlockPct < 5 ? "#22c55e" : gridlockPct < 15 ? "#f59e0b" : "#ef4444",
      pct: 100 - gridlockPct,
    },
  ];

  return (
    <FadeIn delay={0.25}>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Response Readiness
        </div>

        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-white/70">{item.label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: item.color }}>
                  {item.value}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-1">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                />
              </div>
              <div className="text-[10px] text-white/30">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </FadeIn>
  );
}
