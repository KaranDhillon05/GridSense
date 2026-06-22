// AI Incident Commander — structured situation assessment.
//
// Reuses the existing decision engine (buildResponsePlan) and historical
// precedent engine (findSimilarEvents) to produce an honest, data-grounded
// assessment for one incident: risk, expected spillover, predicted clearance,
// historical similarity, and a recommended response. Pure + synchronous so it
// renders instantly; the Wind Tunnel later *proves* the recommendation.

import { getNetwork } from "@/lib/sim/network";
import { buildResponsePlan, type ResponsePlan } from "@/lib/sim/decisionEngine";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { RESOURCE_META } from "@/lib/sim/resources";
import { findSimilarEvents, type PrecedentSummary } from "@/lib/precedent";
import { prettyCause } from "@/lib/ui";
import type { EventInput } from "@/lib/gridsense";
import type { Incident, Severity } from "@/lib/sim/types";
import type { OpsIncident, IncidentAssessment } from "./types";

// Map a microsim incident type back onto an ASTraM cause for precedent lookup.
const TYPE_TO_CAUSE: Record<string, string> = {
  vehicle_breakdown: "vehicle_breakdown",
  bus_breakdown: "vehicle_breakdown",
  truck_breakdown: "vehicle_breakdown",
  minor_accident: "accident",
  major_accident: "accident",
  multi_vehicle_accident: "accident",
  waterlogging: "water_logging",
  flooding: "water_logging",
  road_construction: "construction",
  metro_construction: "construction",
  fallen_tree: "tree_fall",
  signal_failure: "others",
  road_closure: "others",
  protest: "protest",
  political_rally: "public_event",
  religious_gathering: "procession",
  vip_movement: "vip_movement",
  sports_event: "public_event",
  concert: "public_event",
  festival: "public_event",
  crowd_gathering: "public_event",
};

const SPILLOVER_BASE: Record<Severity, number> = { severe: 5, high: 4, moderate: 2, low: 1 };

export function toSimIncident(o: OpsIncident): Incident | null {
  if (!o.edgeId || !o.scenario) return null;
  return {
    id: o.id,
    type: o.type,
    edgeId: o.edgeId,
    distOnEdge: o.scenario.distOnEdge,
    lat: o.lat,
    lon: o.lon,
    severity: o.severity,
    lanesAffected: o.scenario.lanesAffected,
    blockedLanes: [],
    laneSide: "both",
    fullBlockage: o.scenario.fullBlockage,
    startTime: 0,
    durationSec: o.scenario.durationSec,
    baseDurationSec: o.scenario.durationSec,
    resourcesOnScene: [],
    responseApplied: false,
  };
}

export interface CommanderReport {
  responsePlan: ResponsePlan | null;
  precedent: PrecedentSummary;
  assessment: IncidentAssessment;
  recommendedManpower: { label: string; count: number }[];
  simEligible: boolean;
}

export function buildCommanderReport(o: OpsIncident): CommanderReport {
  const simInc = toSimIncident(o);
  const responsePlan = simInc ? buildResponsePlan(getNetwork(), simInc, new Map()) : null;

  const cause = TYPE_TO_CAUSE[o.type] ?? "others";
  const ei: EventInput = {
    cause,
    corridor: o.corridor,
    requires_road_closure: o.requiresClosure,
    lat: o.lat,
    lon: o.lon,
    is_peak: true,
  };
  const precedent = findSimilarEvents(ei, 15, o.predictedDurationMin);

  // Recommended manpower: from the response plan when in-network, else the catalog.
  const recommendedManpower = responsePlan
    ? responsePlan.manpower.map((m) => ({ label: m.label, count: m.count }))
    : (Object.entries(INCIDENT_CATALOG[o.type].response.resources) as [string, number][])
        .filter(([t]) => RESOURCE_META[t as keyof typeof RESOURCE_META]?.mobile)
        .map(([t, n]) => ({ label: RESOURCE_META[t as keyof typeof RESOURCE_META].label, count: n }));

  const spillover =
    SPILLOVER_BASE[o.severity] + (o.requiresClosure ? 2 : 0);
  const predictedDelay = Math.round(
    precedent.n ? precedent.median_clearance_min * 0.6 : o.predictedDurationMin * 0.6
  );
  const similarity = precedent.matches.length
    ? Math.round((precedent.matches[0].similarity ?? 0) * 100)
    : 0;

  // best wind-tunnel plan if already simulated
  let recommendedPlanId: IncidentAssessment["recommendedPlanId"];
  if (o.windTunnel) {
    const best = o.windTunnel.best;
    recommendedPlanId =
      best.id === "recommended"
        ? "A"
        : best.id === "diversion_only"
          ? "B"
          : best.id === "signals_resources"
            ? "C"
            : "D";
  } else if (simInc) {
    recommendedPlanId = "A";
  }

  const escalate = o.escalation === "high" || o.escalation === "critical";
  const recoSummary = responsePlan
    ? `${responsePlan.manpower.map((m) => `${m.count}× ${m.label}`).join(", ")}${responsePlan.diversions.length ? ` + ${responsePlan.diversionStrategy} diversion` : ""}`
    : recommendedManpower.map((m) => `${m.count}× ${m.label}`).join(", ");

  const assessment: IncidentAssessment = {
    summary: `${prettyCause(o.type)} on ${o.corridor}. ${spillover} junctions at spillover risk; ~${predictedDelay} min added delay. Recommended response: ${recoSummary}.`,
    severityCall: o.severity,
    escalate,
    recommendedPlanId,
    predictedDelayMin: predictedDelay,
    spilloverJunctions: spillover,
    historicalSimilarityPct: similarity,
    source: "rule",
  };

  return { responsePlan, precedent, assessment, recommendedManpower, simEligible: !!simInc };
}
