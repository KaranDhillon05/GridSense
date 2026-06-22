"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapView } from "@/components/MapView";
import { PillButton } from "@/components/ui/PillButton";
import { runPreparedness, reportToMapProps, tomorrowBrief } from "@/lib/ops/preparedness";
import type { NWReport } from "@/lib/nightwatch/types";

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};

export default function PreparednessPage() {
  const [report, setReport] = useState<NWReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const mapProps = useMemo(() => (report ? reportToMapProps(report) : null), [report]);
  const brief = useMemo(() => (report ? tomorrowBrief(report) : null), [report]);

  const run = async (count: 100 | 500) => {
    setRunning(true);
    setProgress(0);
    try {
      const r = await runPreparedness(count, setProgress);
      setReport(r);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="content-width py-6 px-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Night Watch 3.0</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Traffic Preparedness Engine · stress-test the city, position resources for tomorrow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
            Operations Center →
          </Link>
        </div>
      </div>

      {!report && (
        <div className="rounded-2xl border border-black/[0.08] bg-white p-6 text-center">
          <div className="text-2xl mb-2">🌙</div>
          <div className="text-sm font-semibold text-[#1d1d1f]">Run tonight&apos;s stress test</div>
          <p className="text-xs text-[#6e6e73] mt-2 max-w-md mx-auto mb-4">
            Monte-Carlo over incident type, location, severity and demand. Discovers vulnerable
            corridors and junctions, scores readiness, and recommends where to pre-position units —
            all rendered on the map.
          </p>
          {running ? (
            <div className="max-w-xs mx-auto">
              <div className="text-sm text-[#0071e3] mb-2">Simulating… {progress}%</div>
              <div className="h-1.5 rounded-full bg-[#e8e8ed] overflow-hidden">
                <div className="h-full bg-[#0071e3] transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex justify-center gap-2">
              <PillButton onClick={() => run(100)}>Run 100 scenarios</PillButton>
              <PillButton variant="secondary" onClick={() => run(500)}>
                Run 500
              </PillButton>
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="space-y-5">
          {/* Tomorrow's brief + readiness */}
          <div className="grid md:grid-cols-[1fr_auto] gap-4">
            <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#0071e3] mb-2">
                Tomorrow&apos;s Brief
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="text-[#6e6e73] w-32 shrink-0">Top risk</dt>
                  <dd className="text-[#1d1d1f] font-medium">{brief!.topRisk}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[#6e6e73] w-32 shrink-0">Resource gap</dt>
                  <dd className="text-[#1d1d1f]">{brief!.resourceGap}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[#6e6e73] w-32 shrink-0">Recommended action</dt>
                  <dd className="text-[#1d1d1f]">{brief!.recommendedAction}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-2xl border border-black/[0.08] bg-white p-4 flex flex-col items-center justify-center min-w-[160px]">
              <div className="text-5xl font-bold" style={{ color: GRADE_COLOR[report.grade] }}>
                {report.grade}
              </div>
              <div className="text-sm font-semibold text-[#1d1d1f] mt-1">{report.resilienceScore}/100</div>
              <div className="text-[10px] text-[#6e6e73] uppercase tracking-wide mt-0.5">Readiness</div>
              <button
                type="button"
                onClick={() => run(100)}
                disabled={running}
                className="text-[11px] text-[#0071e3] mt-2 hover:underline"
              >
                {running ? `${progress}%` : "re-run"}
              </button>
            </div>
          </div>

          {/* Map */}
          <div className="h-[380px] rounded-2xl overflow-hidden border border-black/[0.08] relative">
            {mapProps && <MapView {...mapProps} />}
          </div>

          {/* Rankings + resources */}
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
              <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Top vulnerable corridors</div>
              <div className="space-y-2">
                {report.topCorridors.slice(0, 6).map((c) => (
                  <div key={c.edgeId} className="flex items-center justify-between text-xs">
                    <span className="text-[#1d1d1f] truncate flex-1">{c.name}</span>
                    <span className="text-[#ef4444] font-semibold tabular-nums ml-2">
                      {Math.round(c.riskScore)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
              <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Top vulnerable junctions</div>
              <div className="space-y-2">
                {report.topJunctions.slice(0, 6).map((j) => (
                  <div key={j.nodeId} className="flex items-center justify-between text-xs">
                    <span className="text-[#1d1d1f] truncate flex-1">{j.name}</span>
                    <span className="text-[#f97316] font-semibold tabular-nums ml-2">
                      {Math.round(j.riskScore)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
              <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Pre-position resources</div>
              <div className="space-y-2.5">
                {report.resourcePositioning.slice(0, 6).map((r, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#1d1d1f] font-medium">{r.label}</span>
                      <span className="text-[#16a34a] font-semibold">+{r.expectedImprovementPct}%</span>
                    </div>
                    <div className="text-[11px] text-[#6e6e73]">→ {r.recommendedLocation}</div>
                  </div>
                ))}
                {report.resourcePositioning.length === 0 && (
                  <div className="text-xs text-[#6e6e73]">Fleet well-positioned — no moves recommended.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
