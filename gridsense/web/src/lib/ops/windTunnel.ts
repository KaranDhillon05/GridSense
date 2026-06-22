// Strategy Wind Tunnel (ops wrapper).
//
// Reuses the existing headless microsim primitive simulatePlan() — which already
// runs do-nothing / recommended / diversion-only / signals+units through the real
// IDM engine with paired seeds — and re-presents the four measured outcomes as
// operator-facing Plan A/B/C/D, adds a derived resource cost, ranks them, and
// recommends the best. ZERO engine changes: the simulator proves the decision.
// Accepting a plan writes deployments + tasks back to the ops store and logs the
// counterfactual outcome to the playbook memory.

import { getNetwork } from "@/lib/sim/network";
import {
  simulatePlan,
  type PlanSimResult,
  type StrategyOutcome,
  type StrategyId,
} from "@/lib/sim/strategySimulator";
import { buildResponsePlan } from "@/lib/sim/decisionEngine";
import { logOutcome } from "@/lib/playbookMemory";
import { toSimIncident } from "./commander";
import { buildIncidentPlan } from "./incidentPlan";
import {
  addDeployment,
  upsertTask,
  updateIncidentStatus,
  assignResource,
  applyWindTunnelResult,
  applyIncidentPlan,
  nextId,
  getOpsState,
} from "./store";
import type { OpsIncident, Deployment, Task } from "./types";
import type { ResourceType } from "@/lib/sim/types";
import type { TrafficPlanOutput, MapplsContext } from "@/lib/types";

export type PlanId = "A" | "B" | "C" | "D";

export interface RankedPlan {
  id: PlanId;
  strategyId: StrategyId;
  label: string;
  blurb: string;
  outcome: StrategyOutcome;
  delayVehMin: number;
  maxQueueM: number;
  clearanceMin: number | null;
  gridlock: boolean;
  resourceCost: number; // derived, not simulated (units + barricades)
  reductionPct: number;
  rank: number;
  recommended: boolean;
}

export interface WindTunnelResult {
  /** Full-Bangalore map plan (same engine as /plan). Present for any incident. */
  trafficPlan: TrafficPlanOutput | null;
  mapplsContext?: MapplsContext;
  /** CBD micro-sim delay-proving table — only when the incident snaps into the CBD twin. */
  result?: PlanSimResult;
  plans?: RankedPlan[];
  recommended?: RankedPlan;
  recommendationText?: string;
}

const STRATEGY_TO_PLAN: Record<StrategyId, { id: PlanId; label: string; blurb: string }> = {
  recommended: { id: "A", label: "Plan A · Recommended", blurb: "Diversion + signals + units" },
  diversion_only: { id: "B", label: "Plan B · Diversion only", blurb: "Reroute through-traffic" },
  signals_resources: { id: "C", label: "Plan C · Signals + units", blurb: "Meter inflow, dispatch units" },
  do_nothing: { id: "D", label: "Plan D · Do nothing", blurb: "Baseline — no intervention" },
};

const UNIT_COST: Partial<Record<ResourceType, number>> = {
  officer: 1,
  supervisor: 1.5,
  rapid_response: 2,
  tow_truck: 2,
  recovery_van: 2,
  maintenance_crew: 1.5,
  ambulance: 2.5,
  fire_engine: 3,
};

function resourceCosts(o: OpsIncident): Record<StrategyId, number> {
  const simInc = toSimIncident(o);
  if (!simInc) return { do_nothing: 0, recommended: 6, diversion_only: 3, signals_resources: 4 };
  const plan = buildResponsePlan(getNetwork(), simInc, new Map());
  const unitsCost = plan.manpower.reduce((s, m) => s + (UNIT_COST[m.type] ?? 1) * m.count, 0);
  const barricadeCost = plan.barricades * 0.5;
  return {
    do_nothing: 0,
    diversion_only: Math.round((barricadeCost + 1) * 10) / 10,
    signals_resources: Math.round(unitsCost * 10) / 10,
    recommended: Math.round((unitsCost + barricadeCost) * 10) / 10,
  };
}

/**
 * Synchronous shaping of cached incident state into the panel view. Combines the
 * (optional) CBD micro-sim delay table with the (optional) full-Bangalore plan,
 * either of which may be absent depending on where the incident is.
 */
export function shapeResult(o: OpsIncident): WindTunnelResult | null {
  const trafficPlan = o.incidentPlan ?? null;
  const sim = o.windTunnel ? shapeSimResult(o, o.windTunnel) : null;
  if (!trafficPlan && !sim) return null;
  return {
    trafficPlan,
    mapplsContext: o.incidentPlanContext,
    ...(sim ?? {}),
  };
}

/** Shape only the CBD micro-sim result into the ranked A/B/C/D view. */
function shapeSimResult(
  o: OpsIncident,
  result: PlanSimResult
): Pick<WindTunnelResult, "result" | "plans" | "recommended" | "recommendationText"> {
  const costs = resourceCosts(o);
  const outcomes: StrategyOutcome[] = [result.recommended, ...result.alternatives, result.baseline];

  const plans: RankedPlan[] = outcomes.map((outcome) => {
    const meta = STRATEGY_TO_PLAN[outcome.id];
    return {
      id: meta.id,
      strategyId: outcome.id,
      label: meta.label,
      blurb: meta.blurb,
      outcome,
      delayVehMin: Math.round(outcome.totalDelayVehMin),
      maxQueueM: Math.round(outcome.maxQueueM),
      clearanceMin: outcome.clearanceMin != null ? Math.round(outcome.clearanceMin) : null,
      gridlock: outcome.gridlock,
      resourceCost: costs[outcome.id],
      reductionPct: outcome.reductionPctVsBaseline,
      rank: 0,
      recommended: false,
    };
  });

  const ranked = [...plans].sort(
    (a, b) =>
      a.outcome.vehicleHoursLost - b.outcome.vehicleHoursLost || a.resourceCost - b.resourceCost
  );
  ranked.forEach((p, i) => (p.rank = i + 1));
  const recommended = ranked.find((p) => p.id !== "D") ?? ranked[0];
  recommended.recommended = true;

  const recommendationText = `${recommended.label} cuts delay ${recommended.reductionPct}% vs. doing nothing (${result.vehicleHoursSaved.toFixed(1)} vehicle-hours saved), ${result.bestVsAlternativePct}% better than the next single-lever option. Simulated over ${result.windowMin.toFixed(0)} min across ${result.seeds} paired seeds.`;

  const order: PlanId[] = ["A", "B", "C", "D"];
  plans.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return { result, plans, recommended, recommendationText };
}

export async function runWindTunnel(
  o: OpsIncident,
  opts: { seeds?: number; onProgress?: (pct: number) => void } = {}
): Promise<WindTunnelResult | null> {
  // Always build the full-Bangalore map plan (works anywhere in the city). Run
  // the CBD micro-sim delay table in parallel only when the incident snaps into
  // the simulated CBD twin.
  const planP = buildIncidentPlan(o);
  const simP = o.scenario
    ? simulatePlan(o.scenario, { seeds: opts.seeds ?? 2, onProgress: opts.onProgress })
    : Promise.resolve(null);

  const [planRes, sim] = await Promise.all([planP, simP]);

  applyIncidentPlan(o.id, planRes?.traffic_plan ?? null, planRes?.mappls_context);
  if (sim) applyWindTunnelResult(o.id, sim);
  opts.onProgress?.(100);

  const trafficPlan = planRes?.traffic_plan ?? null;
  const simShaped = sim ? shapeSimResult(o, sim) : null;
  if (!trafficPlan && !simShaped) return null;

  return {
    trafficPlan,
    mapplsContext: planRes?.mappls_context,
    ...(simShaped ?? {}),
  };
}

const SEV_TIER: Record<string, string> = {
  severe: "Severe",
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

/** Commit the chosen plan to the live ops picture (deployments, tasks, units). */
export function acceptWindTunnelPlan(o: OpsIncident, wt: WindTunnelResult): void {
  const net = getNetwork();
  const simInc = toSimIncident(o);
  const rp = simInc ? buildResponsePlan(net, simInc, new Map()) : null;
  const now = getOpsState().clockMs;
  const trafficPlan = wt.trafficPlan;
  const plan = wt.recommended;
  const result = wt.result;
  const planLabel = plan?.label ?? "Full-Bangalore plan";

  // When the CBD micro-sim ran, honour the chosen strategy's levers; otherwise
  // (full-Bangalore-only) deploy the complete plan.
  const includesDiversion =
    !plan || plan.strategyId === "recommended" || plan.strategyId === "diversion_only";
  const includesUnits =
    !plan || plan.strategyId === "recommended" || plan.strategyId === "signals_resources";

  // PREFERRED: deploy diversions + barricades from the full-Bangalore plan (real
  // OSM geometry, same as /plan). Falls back to the CBD response plan only when
  // no traffic plan is available.
  if (includesDiversion && trafficPlan) {
    const divRoutes = [
      ...trafficPlan.routes.through_diversion,
      ...trafficPlan.routes.secondary_inbound,
    ];
    divRoutes.slice(0, 3).forEach((r) => {
      addDeployment({
        id: nextId("DEP"),
        incidentId: o.id,
        kind: "diversion",
        label: `${r.direction === "diversion" ? "Diversion" : "Reroute"} · ${o.corridor}`,
        edgeIds: r.edge_ids,
        geometry: r.geometry,
        status: "active",
        createdAt: now,
      });
    });
    trafficPlan.barricade_points.slice(0, 12).forEach((b) => {
      addDeployment({
        id: nextId("DEP"),
        incidentId: o.id,
        kind: "barricade",
        label: b.label,
        lat: b.lat,
        lon: b.lon,
        edgeIds: b.edge_id ? [b.edge_id] : undefined,
        status: "active",
        createdAt: now,
      });
    });
  } else if (includesDiversion && rp && rp.diversions[0]) {
    const div = rp.diversions[0];
    const geometry: number[][] = [];
    for (const eid of div.edgeIds) {
      const e = net.edge(eid);
      if (e) for (const [lon, lat] of e.geometry) geometry.push([lon, lat]);
    }
    const dep: Deployment = {
      id: nextId("DEP"),
      incidentId: o.id,
      kind: "diversion",
      label: div.label || `Diversion · ${o.corridor}`,
      edgeIds: div.edgeIds,
      geometry,
      status: "active",
      createdAt: now,
    };
    addDeployment(dep);
    if (rp.barricades > 0) {
      addDeployment({
        id: nextId("DEP"),
        incidentId: o.id,
        kind: "barricade",
        label: `${rp.barricades} barricade units`,
        lat: o.lat,
        lon: o.lon,
        status: "active",
        createdAt: now,
      });
    }
  }

  // Signal override + unit dispatch (CBD response plan only).
  if (includesUnits && rp) {
    if (rp.signalPlan.junctions.length) {
      addDeployment({
        id: nextId("DEP"),
        incidentId: o.id,
        kind: "signal_override",
        label: rp.signalPlan.action,
        junctions: rp.signalPlan.junctions,
        lat: o.lat,
        lon: o.lon,
        status: "active",
        createdAt: now,
      });
    }
    // Dispatch available units matching the plan's manpower.
    for (const m of rp.manpower) {
      let need = m.count;
      const pool = getOpsState().resources.filter(
        (r) => r.type === m.type && r.status === "available"
      );
      for (const r of pool) {
        if (need <= 0) break;
        assignResource(r.id, o.id);
        need--;
      }
    }
  }

  // Tasks: prefer the full-Bangalore plan's ops brief signage/control actions,
  // falling back to the CBD response template.
  const actions = rp
    ? rp.actions
    : trafficPlan
      ? trafficPlan.signage.slice(0, 4).map((s) => `${s.location}: ${s.message}`)
      : [];
  actions.slice(0, 4).forEach((action, i) => {
    const task: Task = {
      id: nextId("TSK"),
      incidentId: o.id,
      title: action,
      status: "todo",
      sourceRecommendation: planLabel,
      createdAt: now,
    };
    // stagger ids deterministically by appending index when nextId collides is avoided by seq
    void i;
    upsertTask(task);
  });

  updateIncidentStatus(o.id, "responding", `${planLabel} accepted (Wind Tunnel)`);

  // Log the proven counterfactual to playbook memory (only when the CBD sim ran).
  if (result) {
    logOutcome({
      source: "plan",
      label: `${o.title} · ${planLabel}`,
      context: {
        cause: o.type,
        corridor: o.corridor,
        tier: SEV_TIER[o.severity],
        closure: o.requiresClosure,
        incidentType: o.type,
        lat: o.lat,
        lon: o.lon,
      },
      outcome: {
        baselineVehHours: result.baseline.vehicleHoursLost,
        recommendedVehHours: result.recommended.vehicleHoursLost,
        vehHoursSaved: result.vehicleHoursSaved,
        reductionPct: result.reductionPct,
        bestVsAlternativePct: result.bestVsAlternativePct,
        clearanceMin: result.recommended.clearanceMin,
      },
    });
  }
}
