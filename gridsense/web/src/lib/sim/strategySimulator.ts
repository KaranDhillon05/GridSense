// The shared "simulate a decision, measure the outcome" primitive.
//
// Given a PlanScenario it runs the real IDM microsimulation (Engine) under
// several response strategies against a do-nothing baseline, using PAIRED demand
// seeds (the same traffic realisations for every strategy) so the differences are
// attributable to the decision, not luck. It returns measured vehicle-hours lost,
// queue, clearance and the % reduction each strategy achieves.
//
// This turns the decision engine's *heuristic* projectedDelayReductionPct into a
// *measured* counterfactual, and is reused by the Plan card (wind tunnel), the
// Replay-and-Prove backtester, and the playbook memory loop.

import { Engine } from "./engine";
import { getNetwork, type SimNetwork } from "./network";
import { INCIDENT_CATALOG, type DiversionStrategy } from "./incidents";
import { buildResponsePlan } from "./decisionEngine";
import { VEHICLE_DESIRED_MS } from "./types";
import type { ResourceType } from "./types";
import type { PlanScenario } from "./planScenario";

const SIM_DT = 1.0; // coarse batch timestep (live sim uses 0.2s)
const WARMUP_STEPS = 90; // fill the network to a realistic load before the incident
// Moderate peak load: enough traffic through the corridor for a blockage to bite,
// without saturating the whole grid (which would make every strategy look equal).
const SPAWN_PER_MIN = 110;
const MAX_VEHICLES = 300;
// Radius (hops) of the symmetric neighborhood around the incident we measure
// delay over: wide enough to capture where a diversion's reroute lands (so its
// cost is netted in), tight enough not to be diluted by the whole city.
const IMPACT_HOPS = 3;

export type StrategyId = "do_nothing" | "recommended" | "diversion_only" | "signals_resources";

const STRATEGY_LABELS: Record<StrategyId, string> = {
  do_nothing: "Do nothing",
  recommended: "Recommended plan",
  diversion_only: "Diversion only",
  signals_resources: "Signals + units only",
};

export interface StrategyOutcome {
  id: StrategyId;
  label: string;
  vehicleHoursLost: number;
  totalDelayVehMin: number;
  maxQueueM: number;
  gridlock: boolean;
  arrived: number;
  clearanceMin: number | null; // null = incident did not clear within the window
  reductionPctVsBaseline: number;
}

export interface PlanSimResult {
  baseline: StrategyOutcome;
  recommended: StrategyOutcome;
  alternatives: StrategyOutcome[];
  best: StrategyOutcome; // best of {recommended, ...alternatives}
  vehicleHoursSaved: number; // baseline − recommended
  reductionPct: number; // recommended vs baseline
  bestVsAlternativePct: number; // recommended improvement over the best single-lever alternative
  scenario: PlanScenario;
  seeds: number;
  windowMin: number;
  runtimeMs: number;
}

/** Stable seed from the scenario so repeated runs are reproducible. */
function baseSeed(scenario: PlanScenario): number {
  let h = 2166136261;
  const s = `${scenario.edgeId}|${scenario.incidentType}|${scenario.fullBlockage}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

function windowMinFor(durationSec: number): number {
  // Long enough for spillback to develop and (for short incidents) to clear,
  // capped to keep the in-browser compute responsive.
  return Math.min(32, Math.max(20, (durationSec / 60) * 1.3));
}

/**
 * The "affected area": a tight symmetric neighborhood (both incoming and
 * outgoing edges, `hops` deep) around the incident. Including the upstream
 * approaches captures the queue the incident causes; including the immediate
 * downstream/adjacent edges captures where a diversion's reroute lands — so the
 * measured delta nets a diversion's relief against its local reroute cost rather
 * than over- or under-crediting it.
 */
function affectedArea(net: SimNetwork, edgeId: string, hops: number): Set<string> {
  const zone = new Set<string>([edgeId]);
  const rev = net.reverseId(edgeId);
  if (rev) zone.add(rev);
  const e0 = net.edge(edgeId);
  if (!e0) return zone;

  let frontier = new Set<string>([e0.from, e0.to]);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const e of net.outgoing.get(node) ?? []) {
        if (!zone.has(e.id)) {
          zone.add(e.id);
          next.add(e.to);
        }
      }
      for (const e of net.incoming.get(node) ?? []) {
        if (!zone.has(e.id)) {
          zone.add(e.id);
          next.add(e.from);
        }
      }
    }
    frontier = next;
  }
  return zone;
}

function applyStrategy(eng: Engine, incidentId: string, scenario: PlanScenario, id: StrategyId) {
  if (id === "do_nothing") return;
  const net = getNetwork();
  const spec = INCIDENT_CATALOG[scenario.incidentType];
  const inc = eng.activeIncidents().find((i) => i.id === incidentId);

  const wantDiversion = id === "recommended" || id === "diversion_only";
  const wantSignalsUnits = id === "recommended" || id === "signals_resources";

  // A planner-declared road closure means a full diversion, regardless of the
  // catalog's softer default — so the simulated response matches the plan.
  const diversionStrategy: DiversionStrategy = scenario.fullBlockage ? "full" : spec.response.diversion;

  let corridorEdges: string[] | undefined;
  if (inc) {
    const plan = buildResponsePlan(net, inc, eng.congestionByEdge());
    corridorEdges = plan.diversions[0]?.edgeIds;
  }

  if (wantDiversion) eng.applyDiversion(incidentId, diversionStrategy, corridorEdges);
  if (wantSignalsUnits) {
    eng.applySignalPlan(incidentId);
    for (const [rType, count] of Object.entries(spec.response.resources)) {
      for (let i = 0; i < (count as number); i++) {
        eng.dispatchResource(rType as ResourceType, incidentId);
      }
    }
  }
}

interface RunOutcome {
  vehicleHoursLost: number; // accumulated in the affected area only
  totalDelayVehMin: number;
  maxQueueM: number;
  gridlock: boolean;
  arrived: number;
  clearanceMin: number | null;
}

function runOne(
  scenario: PlanScenario,
  id: StrategyId,
  demandSeed: number,
  windowSec: number,
  zone: Set<string>
): RunOutcome {
  const eng = new Engine({
    seed: demandSeed,
    spawnPerMin: SPAWN_PER_MIN,
    applyInterventions: id !== "do_nothing",
    maxVehicles: MAX_VEHICLES,
  });
  for (let i = 0; i < WARMUP_STEPS; i++) eng.step(SIM_DT);

  const inc = eng.addIncident({
    type: scenario.incidentType,
    edgeId: scenario.edgeId,
    distOnEdge: scenario.distOnEdge,
    severity: scenario.severity,
    lanesAffected: scenario.lanesAffected,
    fullBlockage: scenario.fullBlockage,
    durationSec: scenario.durationSec,
  });
  applyStrategy(eng, inc.id, scenario, id);

  const steps = Math.ceil(windowSec / SIM_DT);
  let clearanceMin: number | null = null;
  let localDelaySec = 0; // delay accumulated by vehicles inside the affected area
  let maxQueueM = 0;
  for (let i = 0; i < steps; i++) {
    eng.step(SIM_DT);
    // Accumulate delay only for vehicles currently in the affected area, so the
    // measured impact is attributable to this incident, not background traffic.
    for (const v of eng.vehicles) {
      if (v.isResource || v.arrived || v.onConnector) continue;
      if (!zone.has(v.edgeId)) continue;
      const v0 = VEHICLE_DESIRED_MS[v.type];
      localDelaySec += Math.max(0, (v0 - v.speed) / v0) * SIM_DT;
    }
    const cong = eng.congestionByEdge();
    for (const eid of zone) {
      const q = cong.get(eid)?.queueLength ?? 0;
      if (q > maxQueueM) maxQueueM = q;
    }
    if (clearanceMin == null && !eng.activeIncidents().some((a) => a.id === inc.id)) {
      clearanceMin = ((WARMUP_STEPS + i) * SIM_DT) / 60;
    }
  }
  const m = eng.snapshot().metrics;
  return {
    vehicleHoursLost: localDelaySec / 3600,
    totalDelayVehMin: localDelaySec / 60,
    maxQueueM,
    gridlock: m.gridlock,
    arrived: m.arrived,
    clearanceMin,
  };
}

function aggregate(
  scenario: PlanScenario,
  id: StrategyId,
  seeds: number,
  windowSec: number,
  zone: Set<string>
): StrategyOutcome {
  const base = baseSeed(scenario);
  let vh = 0;
  let delay = 0;
  let queue = 0;
  let arrived = 0;
  let grid = 0;
  const clears: number[] = [];
  for (let k = 0; k < seeds; k++) {
    const r = runOne(scenario, id, base + k, windowSec, zone);
    vh += r.vehicleHoursLost;
    delay += r.totalDelayVehMin;
    queue += r.maxQueueM;
    arrived += r.arrived;
    grid += r.gridlock ? 1 : 0;
    if (r.clearanceMin != null) clears.push(r.clearanceMin);
  }
  return {
    id,
    label: STRATEGY_LABELS[id],
    vehicleHoursLost: vh / seeds,
    totalDelayVehMin: delay / seeds,
    maxQueueM: queue / seeds,
    gridlock: grid > seeds / 2,
    arrived: Math.round(arrived / seeds),
    clearanceMin: clears.length ? clears.reduce((a, b) => a + b, 0) / clears.length : null,
    reductionPctVsBaseline: 0,
  };
}

function reductionVs(baseline: StrategyOutcome, o: StrategyOutcome): number {
  if (baseline.vehicleHoursLost <= 0) return 0;
  return Math.round(
    Math.max(0, Math.min(100, (1 - o.vehicleHoursLost / baseline.vehicleHoursLost) * 100))
  );
}

/**
 * Full counterfactual "wind tunnel": baseline vs recommended vs two single-lever
 * alternatives. Async + yields between runs so the browser stays responsive and
 * progress can be reported.
 */
export async function simulatePlan(
  scenario: PlanScenario,
  opts: { seeds?: number; onProgress?: (pct: number) => void } = {}
): Promise<PlanSimResult> {
  const seeds = opts.seeds ?? 2;
  const windowMin = windowMinFor(scenario.durationSec);
  const windowSec = windowMin * 60;
  const zone = affectedArea(getNetwork(), scenario.edgeId, IMPACT_HOPS);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const ids: StrategyId[] = ["do_nothing", "recommended", "diversion_only", "signals_resources"];
  const outcomes = {} as Record<StrategyId, StrategyOutcome>;
  let done = 0;
  for (const id of ids) {
    outcomes[id] = aggregate(scenario, id, seeds, windowSec, zone);
    done++;
    opts.onProgress?.(Math.round((done / ids.length) * 100));
    await new Promise<void>((r) => setTimeout(r, 0)); // yield to the event loop
  }

  const baseline = outcomes.do_nothing;
  for (const id of ids) outcomes[id].reductionPctVsBaseline = reductionVs(baseline, outcomes[id]);

  const recommended = outcomes.recommended;
  const alternatives = [outcomes.diversion_only, outcomes.signals_resources];
  const best = [recommended, ...alternatives].reduce((a, b) =>
    a.vehicleHoursLost <= b.vehicleHoursLost ? a : b
  );
  const bestAlt = alternatives.reduce((a, b) => (a.vehicleHoursLost <= b.vehicleHoursLost ? a : b));
  const bestVsAlternativePct =
    bestAlt.vehicleHoursLost > 0
      ? Math.round(Math.max(0, (1 - recommended.vehicleHoursLost / bestAlt.vehicleHoursLost) * 100))
      : 0;

  return {
    baseline,
    recommended,
    alternatives,
    best,
    vehicleHoursSaved: Math.max(0, baseline.vehicleHoursLost - recommended.vehicleHoursLost),
    reductionPct: recommended.reductionPctVsBaseline,
    bestVsAlternativePct,
    scenario,
    seeds,
    windowMin,
    runtimeMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
  };
}

export interface ABResult {
  baseline: StrategyOutcome;
  recommended: StrategyOutcome;
  vehicleHoursSaved: number;
  reductionPct: number;
  windowMin: number;
}

/**
 * Lightweight do-nothing vs recommended comparison (2 runs/seed). Used by the
 * Replay-and-Prove backtester where we sweep many historical incidents.
 */
export function simulateAB(scenario: PlanScenario, seeds = 1): ABResult {
  const windowMin = Math.min(24, Math.max(18, (scenario.durationSec / 60) * 1.2));
  const windowSec = windowMin * 60;
  const zone = affectedArea(getNetwork(), scenario.edgeId, IMPACT_HOPS);
  const baseline = aggregate(scenario, "do_nothing", seeds, windowSec, zone);
  const recommended = aggregate(scenario, "recommended", seeds, windowSec, zone);
  recommended.reductionPctVsBaseline = reductionVs(baseline, recommended);
  return {
    baseline,
    recommended,
    vehicleHoursSaved: Math.max(0, baseline.vehicleHoursLost - recommended.vehicleHoursLost),
    reductionPct: recommended.reductionPctVsBaseline,
    windowMin,
  };
}
