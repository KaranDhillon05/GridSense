"use client";

// Simulation Proof card — the join between the planner and the digital twin.
// Once a plan is forecast, this runs the real IDM microsimulation in the browser
// for the recommended response vs do-nothing vs two single-lever alternatives,
// using paired demand seeds, and shows the MEASURED vehicle-hours saved. It then
// logs the outcome to the counterfactual playbook memory and cites prior similar
// incidents. Replaces the heuristic "projected delay reduction" with proof.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { EventPlannerInput, ForecastResponse } from "@/lib/types";
import type { EventInput } from "@/lib/gridsense";
import { checkServiceArea, mapEventToScenario } from "@/lib/sim/planScenario";
import { simulatePlan, type PlanSimResult, type StrategyOutcome } from "@/lib/sim/strategySimulator";
import { findSimilar, logOutcome, type MemoryEvidence } from "@/lib/playbookMemory";

type Status = "idle" | "out" | "running" | "done" | "error";

function toEventInput(input: EventPlannerInput): EventInput {
  return {
    event_name: input.event_name,
    event_type: input.event_type,
    cause: input.cause,
    corridor: input.corridor,
    lat: input.lat,
    lon: input.lon,
    requires_road_closure: input.requires_road_closure,
    is_peak: input.is_peak,
    is_planned: input.is_planned,
    priority: input.priority,
    affected_junctions: input.affected_junctions,
    expected_attendance: input.expected_attendance,
    veh_type: input.veh_type,
    start_hour: input.start_hour,
  };
}

function fmt(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

export function PlanSimulationCard({
  input,
  forecast,
  recommendedStrategyName,
}: {
  input: EventPlannerInput;
  forecast: ForecastResponse;
  recommendedStrategyName?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PlanSimResult | null>(null);
  const [evidence, setEvidence] = useState<MemoryEvidence | null>(null);
  const [snapM, setSnapM] = useState<number | null>(null);
  const runToken = useRef(0);

  const signature = [
    input.lat?.toFixed(4),
    input.lon?.toFixed(4),
    input.cause,
    input.corridor,
    input.requires_road_closure,
    forecast.tier,
    Math.round(forecast.expected_duration_min),
    input.veh_type,
    input.event_type,
  ].join("|");

  useEffect(() => {
    const token = ++runToken.current;
    // All state updates happen inside the (asynchronous) timer callback, never
    // synchronously in the effect body, and stale runs bail via the token.
    const timer = setTimeout(async () => {
      if (token !== runToken.current) return;
      const ei = toEventInput(input);
      const area = checkServiceArea(ei);
      setSnapM(area.snapDistanceM);
      if (!area.inServiceArea) {
        setStatus("out");
        setResult(null);
        return;
      }
      const scenario = mapEventToScenario(ei, {
        tier: forecast.tier,
        expected_duration_min: forecast.expected_duration_min,
      });
      if (!scenario) {
        setStatus("out");
        setResult(null);
        return;
      }
      setStatus("running");
      setProgress(0);
      try {
        const res = await simulatePlan(scenario, {
          seeds: 3,
          onProgress: (p) => {
            if (token === runToken.current) setProgress(p);
          },
        });
        if (token !== runToken.current) return;

        const context = {
          cause: input.cause,
          corridor: input.corridor,
          tier: forecast.tier,
          closure: !!input.requires_road_closure,
          incidentType: scenario.incidentType,
          lat: input.lat,
          lon: input.lon,
        };
        logOutcome({
          source: "plan",
          label: input.event_name || input.cause,
          context,
          outcome: {
            baselineVehHours: res.baseline.vehicleHoursLost,
            recommendedVehHours: res.recommended.vehicleHoursLost,
            vehHoursSaved: res.vehicleHoursSaved,
            reductionPct: res.reductionPct,
            bestVsAlternativePct: res.bestVsAlternativePct,
            clearanceMin: res.recommended.clearanceMin,
          },
        });
        setEvidence(findSimilar(context));
        setResult(res);
        setStatus("done");
      } catch {
        if (token === runToken.current) setStatus("error");
      }
    }, 450);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div className="surface-panel p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-[#6e6e73] uppercase tracking-wide">Simulation proof</div>
          <div className="text-sm font-semibold text-[#1d1d1f]">Live microsim · CBD digital twin</div>
        </div>
        <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-[#0a84ff]/10 text-[#0a84ff]">
          measured, not estimated
        </span>
      </div>

      {status === "out" && (
        <div className="text-sm text-[#424245] bg-[#f5f5f7] rounded-xl p-4 leading-relaxed">
          This venue is{" "}
          {snapM != null ? `~${snapM} m from` : "outside"} the simulated CBD network, so the live
          microsimulation is unavailable here — the statistical forecast above still applies.
          <div className="mt-2 text-[#6e6e73]">
            Try a CBD venue (e.g. <span className="font-medium">Chinnaswamy</span>,{" "}
            <span className="font-medium">Vidhana Soudha</span>,{" "}
            <span className="font-medium">Freedom Park</span>) to watch GridSense prove the plan.
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="space-y-2 py-2">
          <div className="text-sm text-[#424245]">
            Simulating do-nothing vs recommended vs alternatives…
          </div>
          <div className="h-2 rounded-full bg-[#e8e8ed] overflow-hidden">
            <motion.div
              className="h-full bg-[#0a84ff]"
              animate={{ width: `${progress}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          </div>
          <div className="text-xs text-[#86868b]">Running the IDM traffic engine over paired demand seeds.</div>
        </div>
      )}

      {status === "error" && (
        <div className="text-sm text-[#b00020]">Simulation failed to run for this scenario.</div>
      )}

      {status === "done" && result && (
        <SimResult result={result} forecast={forecast} evidence={evidence} recommendedStrategyName={recommendedStrategyName} />
      )}
    </div>
  );
}

function SimResult({
  result,
  forecast,
  evidence,
  recommendedStrategyName,
}: {
  result: PlanSimResult;
  forecast: ForecastResponse;
  evidence: MemoryEvidence | null;
  recommendedStrategyName?: string;
}) {
  const { baseline, recommended, alternatives } = result;
  const bars: StrategyOutcome[] = [baseline, recommended, ...alternatives];
  const maxVH = Math.max(...bars.map((b) => b.vehicleHoursLost), 0.001);

  const simClearance = recommended.clearanceMin;
  const queueDrop = Math.max(0, baseline.maxQueueM - recommended.maxQueueM);

  // Which single lever drives the most relief — an honest, robust insight (no
  // dependence on the noisy recommended-vs-alternative ordering).
  const divOnly = alternatives.find((a) => a.id === "diversion_only");
  const sigOnly = alternatives.find((a) => a.id === "signals_resources");
  const divPct = divOnly?.reductionPctVsBaseline ?? 0;
  const sigPct = sigOnly?.reductionPctVsBaseline ?? 0;
  const dominantLever = divPct >= sigPct ? "Diversion" : "Signal retiming + field units";
  const dominantPct = Math.max(divPct, sigPct);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gradient-to-br from-[#e9f7ef] to-[#f5f5f7] p-4">
        <div className="text-[28px] leading-none font-semibold text-[#11823b]">
          ≈ {fmt(result.vehicleHoursSaved)} <span className="text-base font-medium">vehicle-hours saved</span>
        </div>
        <div className="text-sm text-[#424245] mt-1">
          {recommendedStrategyName ? <span className="font-medium">{recommendedStrategyName}</span> : "Recommended plan"} cuts
          simulated delay in the affected area by{" "}
          <span className="font-semibold text-[#11823b]">{result.reductionPct}%</span> vs doing nothing.
        </div>
      </div>

      <div className="space-y-2">
        {bars.map((b) => {
          const isBaseline = b.id === "do_nothing";
          const isRec = b.id === "recommended";
          return (
            <div key={b.id} className="text-xs">
              <div className="flex justify-between mb-1">
                <span className={isRec ? "font-semibold text-[#1d1d1f]" : "text-[#424245]"}>
                  {b.label}
                  {isRec && recommendedStrategyName ? ` · ${recommendedStrategyName}` : ""}
                </span>
                <span className="tabular-nums text-[#6e6e73]">
                  {fmt(b.vehicleHoursLost)} veh-hr
                  {!isBaseline && b.reductionPctVsBaseline > 0 ? ` · −${b.reductionPctVsBaseline}%` : ""}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-[#f0f0f3] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: isBaseline ? "#ff453a" : isRec ? "#34c759" : "#c7c7cc" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(b.vehicleHoursLost / maxVH) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Forecast clearance" value={`${Math.round(forecast.expected_duration_min)}m`} />
        <Stat
          label="Sim clearance (plan)"
          value={simClearance != null ? `${Math.round(simClearance)}m` : "ongoing"}
        />
        <Stat label="Queue relieved" value={`${fmt(queueDrop)}m`} />
      </div>

      <div className="text-xs text-[#424245] bg-[#f5f5f7] rounded-lg p-3 leading-relaxed">
        <span className="font-medium text-[#1d1d1f]">Counterfactual:</span> {dominantLever.toLowerCase()} is the
        highest-impact lever for this incident (−{dominantPct}% on its own); the recommended plan applies it alongside the
        others
        {recommended.gridlock === false && baseline.gridlock ? " and prevents the gridlock the do-nothing case hits." : "."}
      </div>

      {evidence && evidence.n > 1 ? (
        <div className="text-xs text-[#424245] border border-[#0a84ff]/15 bg-[#0a84ff]/[0.04] rounded-lg p-3 leading-relaxed">
          <span className="font-medium text-[#0a84ff]">Playbook memory:</span> across {evidence.n} similar simulated
          incidents, this response cut delay by an average of{" "}
          <span className="font-semibold">{evidence.avgReductionPct}%</span> (median {evidence.medianReductionPct}%),
          saving ≈{evidence.totalVehHoursSaved.toLocaleString()} vehicle-hours in total.
        </div>
      ) : (
        <div className="text-xs text-[#86868b] leading-relaxed">
          Logged to the playbook memory. As you simulate more incidents, GridSense cites the measured track record of
          each response here.
        </div>
      )}

      <div className="text-[10px] text-[#a1a1a6] leading-relaxed">
        IDM microsimulation on the {`${result.scenario.edgeName}`} corridor · affected-area delay · {result.seeds} paired
        demand seeds · {Math.round(result.windowMin)}-min window · {(result.runtimeMs / 1000).toFixed(1)}s compute.
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f5f5f7] rounded-lg p-2">
      <div className="text-sm font-semibold text-[#1d1d1f] tabular-nums">{value}</div>
      <div className="text-[10px] text-[#86868b] mt-0.5">{label}</div>
    </div>
  );
}
