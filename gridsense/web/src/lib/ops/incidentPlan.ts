// Incident → full-Bangalore traffic plan adapter.
//
// The /plan page produces high-quality diversions / reroutes / barricades /
// deployment posts by running buildTrafficPlan() → buildNetworkPlan() on the
// FULL Bangalore OSM graph (14.9k nodes). The Wind Tunnel previously only had
// the 236-node CBD micro-sim, which yields delay metrics but no map geometry and
// is gated to the CBD. This adapter feeds any ops incident — anywhere in
// Bangalore — through the exact same engine the plan page uses, so the incident
// map can render a plan of identical quality.
//
// Pure reuse: no new routing/planning logic. We only translate an OpsIncident
// into the EventInput the planner already understands.

import type { EventInput } from "@/lib/gridsense";
import type {
  TrafficPlanOutput,
  AttendanceBand,
  EventType,
  MapplsContext,
} from "@/lib/types";
import type { OpsIncident, Severity } from "./types";

// Incident severity scales the cordon radius (radiusFor uses attendance_band).
// Severe incidents warrant a wide cordon + more approaches; low incidents a tight one.
const SEVERITY_BAND: Record<Severity, AttendanceBand> = {
  severe: "between_10000_50000",
  high: "between_2000_10000",
  moderate: "between_500_2000",
  low: "under_500",
};

const SEVERITY_ATTENDANCE: Record<Severity, number> = {
  severe: 20000,
  high: 6000,
  moderate: 1200,
  low: 300,
};

/** Translate an ops incident into the planner's EventInput contract. */
export function incidentToPlannerInput(o: OpsIncident): EventInput {
  const band = SEVERITY_BAND[o.severity];
  // Cordon-style traffic management around the incident, sized by severity.
  const eventType: EventType = "construction_road_closure";
  const roads_to_close =
    o.requiresClosure && o.corridor && o.corridor !== "Non-corridor"
      ? [{ id: `inc-${o.id}`, name: o.corridor }]
      : [];

  return {
    event_name: `${o.title} · ${o.corridor}`,
    event_type: eventType,
    attendance_band: band,
    expected_attendance: SEVERITY_ATTENDANCE[o.severity],
    cause: o.type,
    corridor: o.corridor || "Non-corridor",
    priority: o.severity === "severe" || o.severity === "high" ? "high" : "medium",
    requires_road_closure: o.requiresClosure,
    heavy_vehicle_restriction: o.requiresClosure,
    roads_to_close,
    is_planned: false,
    lat: o.lat,
    lon: o.lon,
  };
}

export interface IncidentPlanResult {
  traffic_plan: TrafficPlanOutput | null;
  mappls_context?: MapplsContext;
}

/**
 * Build a full-Bangalore traffic plan for an incident. Works anywhere in the
 * city — the network engine runs server-side via /api/incident-plan (it loads a
 * multi-MB OSM graph) and only falls back to the ring engine when the venue is
 * off-network. Returns null on failure so callers can degrade gracefully.
 */
export async function buildIncidentPlan(o: OpsIncident): Promise<IncidentPlanResult | null> {
  try {
    const res = await fetch("/api/incident-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incidentToPlannerInput(o)),
    });
    if (!res.ok) return null;
    return (await res.json()) as IncidentPlanResult;
  } catch {
    return null;
  }
}
