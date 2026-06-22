// Event → operations bridge. Turns a planned OpsEvent into a forecast + a staged
// OpsIncident (so the existing Incident Commander + Wind Tunnel + accept flow all
// apply) and pushes it into the live ops store.

import { forecast } from "@/lib/gridsense";
import { mapEventToScenario, pickIncidentType } from "@/lib/sim/planScenario";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import type { EventInput } from "@/lib/gridsense";
import type { Severity, IncidentType } from "@/lib/sim/types";
import type { OpsIncident } from "./types";
import { getOpsState, nextId, addIncident } from "./store";
import { markEventPlanned } from "./eventsStore";
import type { OpsEvent } from "./eventsStore";

export function eventToInput(e: OpsEvent): EventInput {
  return {
    event_name: e.name,
    event_type: e.type,
    cause: e.cause,
    corridor: e.corridor,
    requires_road_closure: e.requiresClosure,
    expected_attendance: e.attendance,
    attendance_band: e.attendanceBand,
    is_planned: true,
    is_peak: true,
    priority: "High",
    lat: e.lat,
    lon: e.lon,
  };
}

function tierToSeverity(tier: string): Severity {
  switch (tier) {
    case "Severe":
      return "severe";
    case "High":
      return "high";
    case "Moderate":
      return "moderate";
    default:
      return "low";
  }
}

export interface EventForecast {
  impact_score: number;
  tier: string;
  expected_duration_min: number;
  severity: Severity;
  type: IncidentType;
  simEligible: boolean;
}

export function forecastEvent(e: OpsEvent): EventForecast {
  const ei = eventToInput(e);
  const fc = forecast(ei);
  const severity = tierToSeverity(fc.tier);
  const type = pickIncidentType(ei, severity) as IncidentType;
  const scenario = mapEventToScenario(ei, { tier: fc.tier, expected_duration_min: fc.expected_duration_min });
  return {
    impact_score: fc.impact_score,
    tier: fc.tier,
    expected_duration_min: fc.expected_duration_min,
    severity,
    type,
    simEligible: scenario != null,
  };
}

/** Build a transient OpsIncident from an event (for assessment/sim preview). */
export function eventToIncident(e: OpsEvent, idOverride?: string): OpsIncident {
  const ei = eventToInput(e);
  const fc = forecast(ei);
  const severity = tierToSeverity(fc.tier);
  const type = pickIncidentType(ei, severity) as IncidentType;
  const scenario = mapEventToScenario(ei, { tier: fc.tier, expected_duration_min: Math.min(fc.expected_duration_min, 50) });
  const clockMs = getOpsState().clockMs;
  return {
    id: idOverride ?? e.id,
    type,
    severity,
    status: "verified",
    title: `${e.name} · ${e.venue}`,
    corridor: e.corridor,
    lat: scenario?.snappedLat ?? e.lat,
    lon: scenario?.snappedLon ?? e.lon,
    edgeId: scenario?.edgeId,
    scenario: scenario ?? undefined,
    detectedAt: clockMs,
    etaClearMin: Math.round(Math.min(fc.expected_duration_min, 90)),
    predictedDurationMin: Math.round(fc.expected_duration_min),
    requiresClosure: e.requiresClosure,
    assignedResourceIds: [],
    taskIds: [],
    deploymentIds: [],
    timeline: [{ t: clockMs, label: `Event staged for operations (${INCIDENT_CATALOG[type].label})` }],
    escalation: "low",
    source: "manual",
  };
}

/** Stage an event into the live ops store as a managed incident; returns its id. */
export function stageEvent(e: OpsEvent): string {
  const id = nextId("INC");
  const inc = eventToIncident(e, id);
  addIncident(inc);
  markEventPlanned(e.id, id);
  return id;
}
