"use client";

// Night Watch 2.0 – Traffic Resilience & Preparedness Engine.
// Runs headless Monte Carlo incident scenarios overnight to answer:
// "If an incident occurs tomorrow, how prepared is the city network?"
// Output: a preparedness report, not a prediction.

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { runBatch } from "@/lib/nightwatch/monteCarloRunner";
import { buildReport } from "@/lib/nightwatch/buildReport";
import { computeCityVulnerability } from "@/lib/nightwatch/cityVulnerability";
import type { NWReport, NWRunResult } from "@/lib/nightwatch/types";
import type { SimCount } from "@/components/nightwatch/RunControls";
import { RunControls } from "@/components/nightwatch/RunControls";
import { SimulationProgress } from "@/components/nightwatch/SimulationProgress";
import { ResilienceScoreCard } from "@/components/nightwatch/ResilienceScoreCard";
import { CorridorRankingsTable } from "@/components/nightwatch/CorridorRankingsTable";
import { JunctionRankingsTable } from "@/components/nightwatch/JunctionRankingsTable";
import { WorstCaseScenariosCard } from "@/components/nightwatch/WorstCaseScenariosCard";
import { ResourcePositioningCard } from "@/components/nightwatch/ResourcePositioningCard";
import { ResponseReadinessCard } from "@/components/nightwatch/ResponseReadinessCard";

const VulnerabilityMap = dynamic(
  () => import("@/components/nightwatch/VulnerabilityMap").then((m) => ({ default: m.VulnerabilityMap })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center text-sm text-[#6e6e73] bg-[#f5f5f7]">
        Loading map…
      </div>
    ),
  }
);

export default function NightWatchPage() {
  const [simCount, setSimCount] = useState<SimCount>(100);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<NWReport | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [cityWide, setCityWide] = useState(true);

  // City-wide vulnerability + pre-positioning derived from historical hotspots
  // (spans the whole metro, no IDM). Always available, independent of CBD runs.
  const city = useMemo(() => computeCityVulnerability(), []);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    setReport(null);
    setSelectedEdge(null);

    try {
      const results = await runBatch(simCount, (pct) => setProgress(pct));
      const built = buildReport(results);
      setReport(built);
    } finally {
      setRunning(false);
      setProgress(100);
    }
  }, [simCount]);

  const handleReplay = useCallback((result: NWRunResult) => {
    sessionStorage.setItem(
      "nightwatch_replay",
      JSON.stringify({
        type: result.scenario.incidentType,
        edgeId: result.scenario.edgeId,
        severity: result.scenario.severity,
        lanesAffected: result.scenario.lanesAffected,
        durationSec: result.scenario.durationMin * 60,
        edgeName: result.scenario.edgeName,
      })
    );
    window.location.href = "/simulation";
  }, []);

  const corridors = report?.topCorridors ?? [];
  const completedAt = report
    ? new Date(report.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className="flex bg-[#0b0e14] text-white overflow-hidden"
      style={{ height: "calc(100vh - var(--nav-height))" }}
    >
      {/* Map — left 60% */}
      <div className="relative flex-1 min-w-0">
        <VulnerabilityMap
          corridors={corridors}
          selectedEdge={selectedEdge}
          onSelectEdge={setSelectedEdge}
          cityCorridors={cityWide ? city.corridors : []}
          cityPrePositions={cityWide ? city.prePositions : []}
        />

        {/* City-wide layer toggle */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500]">
          <button
            onClick={() => setCityWide((v) => !v)}
            className="bg-[#0b0e14]/90 backdrop-blur-sm rounded-xl px-3 py-2 border border-white/10 text-[11px] text-white/80 hover:text-white transition"
          >
            <span className={cityWide ? "text-[#22c55e]" : "text-white/40"}>●</span>{" "}
            All-Bangalore layer {cityWide ? "on" : "off"} · {city.corridors.length} zones
          </button>
        </div>

        {/* Header badge */}
        <div className="absolute top-4 left-4 z-[500] pointer-events-none">
          <div className="bg-[#0b0e14]/90 backdrop-blur-sm rounded-xl px-3 py-2 border border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-base">🌙</span>
              <div>
                <div className="text-xs font-bold text-white">Night Watch 2.0</div>
                <div className="text-[10px] text-white/40">Traffic Resilience & Preparedness Engine</div>
              </div>
            </div>
          </div>
        </div>

        {/* Completed timestamp */}
        {completedAt && (
          <div className="absolute top-4 right-4 z-[500] pointer-events-none">
            <div className="bg-[#0b0e14]/80 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-white/10">
              <div className="text-[10px] text-white/40">
                Report generated at <span className="text-white/60">{completedAt}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar — right 400px */}
      <div className="w-[400px] shrink-0 flex flex-col border-l border-white/10 overflow-hidden">
        {/* Sidebar header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0">
          <div className="text-sm font-semibold text-white">Preparedness Report</div>
          <div className="text-[11px] text-white/40 mt-0.5">
            Monte Carlo stress-testing · Not a prediction
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Run controls */}
          <RunControls
            count={simCount}
            onCount={setSimCount}
            onRun={handleRun}
            running={running}
            disabled={false}
          />

          {/* Progress bar */}
          {(running || (progress > 0 && progress < 100)) && (
            <SimulationProgress pct={progress} count={simCount} />
          )}

          {/* Report sections — only shown after run */}
          {report && (
            <>
              <ResilienceScoreCard report={report} />
              <CorridorRankingsTable
                corridors={report.topCorridors}
                selectedEdge={selectedEdge}
                onSelect={setSelectedEdge}
              />
              <JunctionRankingsTable junctions={report.topJunctions} />
              <WorstCaseScenariosCard
                scenarios={report.worstScenarios}
                onReplay={handleReplay}
              />
              <ResourcePositioningCard recommendations={report.resourcePositioning} />
              <ResponseReadinessCard report={report} />

              {/* Footer */}
              <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 px-4 py-3 text-center">
                <div className="text-[10px] text-white/30 leading-relaxed">
                  This is a preparedness report based on historical patterns and Monte Carlo
                  simulation. It identifies vulnerabilities — not predictions of specific incidents.
                </div>
              </div>
            </>
          )}

          {/* City-wide pre-positioning — always available (historical, all-Bangalore) */}
          {cityWide && (
            <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 px-4 py-3">
              <div className="text-xs font-semibold text-white mb-0.5">
                All-Bangalore pre-positioning
              </div>
              <div className="text-[10px] text-white/40 mb-2">
                Historical risk across {city.corridors.length} city zones · not a prediction
              </div>
              <div className="space-y-1.5">
                {city.prePositions.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-white/80 truncate">{p.zoneName}</div>
                      <div className="text-[9px] text-white/30 truncate">
                        {p.incidentDensity} hist. incidents
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] text-[#22c55e] font-medium tabular-nums">
                      {p.recommendedUnits} units
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!report && !running && (
            <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 px-5 py-8 text-center">
              <div className="text-4xl mb-3">🌙</div>
              <div className="text-sm font-semibold text-white mb-1">Ready to run</div>
              <div className="text-[12px] text-white/40 leading-relaxed">
                The all-Bangalore vulnerability layer is shown on the map. Select a simulation count
                above and click &ldquo;Run Night Watch&rdquo; to add a deep CBD microsimulation
                stress-test on top.
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                {[
                  ["Which corridors are most fragile?", "Corridor vulnerability ranking"],
                  ["Do we have enough resources?", "Resource sufficiency analysis"],
                  ["What's the worst-case scenario?", "Top 5 worst outcomes"],
                  ["Where to pre-position tow trucks?", "Resource repositioning plan"],
                ].map(([q, a]) => (
                  <div key={q} className="rounded-xl bg-white/5 px-3 py-2.5">
                    <div className="text-[10px] text-white/60 font-medium mb-0.5">{q}</div>
                    <div className="text-[9px] text-white/30">{a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
