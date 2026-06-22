"use client";

import { FadeIn } from "@/components/ui/motion";
import type { NWReport } from "@/lib/nightwatch/types";

const GRADE_COLORS: Record<string, string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#f59e0b",
  D: "#f97316",
  F: "#ef4444",
};

const FACTOR_LABELS: Record<string, string> = {
  interventionEffectiveness: "Intervention Effectiveness",
  worstCaseResilience: "Worst-Case Resilience",
  congestionContainment: "Congestion Containment",
  resourceSufficiency: "Resource Sufficiency",
  recoverySpeed: "Recovery Speed",
};

export function ResilienceScoreCard({ report }: { report: NWReport }) {
  const { resilienceScore, grade } = report;
  const color = GRADE_COLORS[grade] ?? "#9ca3af";
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - resilienceScore / 100);

  return (
    <FadeIn>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Network Resilience Score
        </div>

        <div className="flex items-center gap-6 mb-5">
          {/* Circular gauge */}
          <div className="relative shrink-0">
            <svg width="128" height="128" className="-rotate-90">
              <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle
                cx="64" cy="64" r="54"
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white tabular-nums">{resilienceScore}</span>
              <span className="text-xs text-white/40">/100</span>
            </div>
          </div>

          <div>
            <div className="text-6xl font-bold" style={{ color }}>{grade}</div>
            <div className="text-xs text-white/40 mt-1">
              {grade === "A" && "Excellent preparedness"}
              {grade === "B" && "Good preparedness"}
              {grade === "C" && "Moderate preparedness"}
              {grade === "D" && "Below average"}
              {grade === "F" && "Critical vulnerabilities"}
            </div>
            <div className="text-[11px] text-white/30 mt-3">
              Based on {report.runCount.toLocaleString()} simulations
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <div className="rounded-xl bg-white/5 p-2.5 text-center">
            <div className="text-xs text-white/40 mb-0.5">Avg Improvement</div>
            <div className="text-sm font-bold text-[#22c55e]">{report.avgImprovementPct.toFixed(0)}%</div>
          </div>
          <div className="rounded-xl bg-white/5 p-2.5 text-center">
            <div className="text-xs text-white/40 mb-0.5">Gridlock Events</div>
            <div className={`text-sm font-bold ${report.totalRunsWithGridlock > 0 ? "text-[#ef4444]" : "text-[#22c55e]"}`}>
              {report.totalRunsWithGridlock}
            </div>
          </div>
          <div className="rounded-xl bg-white/5 p-2.5 text-center">
            <div className="text-xs text-white/40 mb-0.5">Resource Suff.</div>
            <div className={`text-sm font-bold ${report.resourceSufficiencyPct >= 80 ? "text-[#22c55e]" : "text-[#f59e0b]"}`}>
              {report.resourceSufficiencyPct.toFixed(0)}%
            </div>
          </div>
        </div>

        <div className="text-xs text-white/30 text-center">
          Expected congestion reduction with pre-positioning:{" "}
          <span className="text-[#22c55e] font-semibold">{report.expectedCongestionReductionPct.toFixed(0)}%</span>
        </div>
      </div>
    </FadeIn>
  );
}
