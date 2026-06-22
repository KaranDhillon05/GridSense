"use client";

import { FadeIn } from "@/components/ui/motion";
import type { JunctionVulnerability } from "@/lib/nightwatch/types";

export function JunctionRankingsTable({ junctions }: { junctions: JunctionVulnerability[] }) {
  const maxRisk = junctions[0]?.riskScore ?? 1;

  return (
    <FadeIn delay={0.1}>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Top Vulnerable Junctions
        </div>

        <div className="space-y-2">
          {junctions.slice(0, 5).map((j, i) => {
            const pct = (j.riskScore / maxRisk) * 100;
            const color = pct > 75 ? "#ef4444" : pct > 50 ? "#f97316" : "#f59e0b";
            return (
              <div key={j.nodeId} className="rounded-xl bg-white/5 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-white/30 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white truncate">
                        {j.name.startsWith("n") ? `Junction ${j.nodeId.slice(-5)}` : j.name}
                      </span>
                      <span className="text-[10px] tabular-nums shrink-0" style={{ color }}>
                        {j.congestionHitCount} hits
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="text-[10px] text-white/30 mt-1">
                      Avg queue impact: {j.avgQueueImpact.toFixed(0)}m
                    </div>
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
