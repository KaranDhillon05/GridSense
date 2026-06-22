// Bridge between the event PLANNER (statistical forecast on the city OSM graph)
// and the microsimulation TWIN (IDM agents on the 236-node CBD network).
//
// It maps an EventInput + its forecast into a concrete sim incident scenario,
// and decides whether the venue actually falls inside the simulated CBD service
// area (the twin only covers central Bengaluru). This is the join that lets the
// simulator score the planner's recommendation instead of the two living in
// separate worlds.

import { getNetwork } from "./network";
import { INCIDENT_CATALOG } from "./incidents";
import type { IncidentType, Severity } from "./types";
import type { EventInput } from "@/lib/gridsense";

// How close the venue must snap to a sim edge to be simulatable (metres).
export const SERVICE_SNAP_M = 750;

export interface PlanScenario {
  edgeId: string;
  distOnEdge: number;
  incidentType: IncidentType;
  severity: Severity;
  lanesAffected: number;
  fullBlockage: boolean;
  durationSec: number;
  snappedLat: number;
  snappedLon: number;
  snapDistanceM: number;
  edgeName: string;
}

export interface ServiceAreaCheck {
  inServiceArea: boolean;
  snapDistanceM: number | null;
  reason?: string;
}

/** Minimal forecast shape the scenario mapping needs. */
export interface ScenarioForecast {
  tier: string;
  expected_duration_min: number;
}

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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

const HEAVY = new Set(["truck", "heavy_vehicle", "lcv"]);
const BUSES = new Set(["bmtc_bus", "ksrtc_bus", "private_bus"]);

// Planner EventType (UI) → microsim incident type for crowd/event causes.
const EVENT_TYPE_MAP: Record<string, IncidentType> = {
  sports_match: "sports_event",
  concert_festival: "concert",
  political_rally: "political_rally",
  religious_procession: "religious_gathering",
  marathon_road_race: "road_closure",
  vip_movement: "vip_movement",
  construction_road_closure: "road_construction",
  public_gathering: "crowd_gathering",
};

/** Map an ASTraM cause (+ context) onto one of the 25 catalog incident types. */
export function pickIncidentType(input: EventInput, severity: Severity): IncidentType {
  const cause = (input.cause || "others").toLowerCase();
  const veh = input.veh_type;
  const closure = !!input.requires_road_closure;

  switch (cause) {
    case "accident":
      return severity === "severe"
        ? "multi_vehicle_accident"
        : severity === "high" || closure
          ? "major_accident"
          : "minor_accident";
    case "vehicle_breakdown":
      return HEAVY.has(veh ?? "")
        ? "truck_breakdown"
        : BUSES.has(veh ?? "")
          ? "bus_breakdown"
          : "vehicle_breakdown";
    case "water_logging":
      return severity === "severe" ? "flooding" : "waterlogging";
    case "construction":
      return input.event_type === "construction_road_closure" ? "metro_construction" : "road_construction";
    case "pot_holes":
    case "road_conditions":
      return "road_construction";
    case "tree_fall":
    case "debris":
      return "fallen_tree";
    case "protest":
      return "protest";
    case "procession":
      return EVENT_TYPE_MAP[input.event_type ?? ""] ?? "religious_gathering";
    case "vip_movement":
      return "vip_movement";
    case "public_event": {
      const mapped = EVENT_TYPE_MAP[input.event_type ?? ""];
      if (mapped) return mapped;
      const att = input.expected_attendance ?? 0;
      return att >= 10000 ? "sports_event" : "crowd_gathering";
    }
    case "congestion":
    case "low_visibility":
      return "vehicle_breakdown"; // mild partial-lane disturbance proxy
    case "others":
    default:
      return closure ? "road_closure" : "crowd_gathering";
  }
}

/** Is the venue inside the simulated CBD twin? Used to gate the live sim card. */
export function checkServiceArea(input: EventInput): ServiceAreaCheck {
  if (input.lat == null || input.lon == null) {
    return { inServiceArea: false, snapDistanceM: null, reason: "No venue pin set." };
  }
  const net = getNetwork();
  const snap = net.snapToEdge(input.lat, input.lon);
  if (!snap) return { inServiceArea: false, snapDistanceM: null, reason: "Outside the simulated network." };
  const d = metersBetween(input.lat, input.lon, snap.lat, snap.lon);
  return {
    inServiceArea: d <= SERVICE_SNAP_M,
    snapDistanceM: Math.round(d),
    reason: d <= SERVICE_SNAP_M ? undefined : "Venue is outside the simulated CBD network.",
  };
}

/**
 * Turn a planned event + its forecast into a concrete microsim scenario.
 * Returns null when the venue is outside the simulated CBD network.
 */
export function mapEventToScenario(input: EventInput, forecast: ScenarioForecast): PlanScenario | null {
  if (input.lat == null || input.lon == null) return null;
  const net = getNetwork();
  const snap = net.snapToEdge(input.lat, input.lon);
  if (!snap) return null;
  const snapDistanceM = Math.round(metersBetween(input.lat, input.lon, snap.lat, snap.lon));
  if (snapDistanceM > SERVICE_SNAP_M) return null;

  const severity = tierToSeverity(forecast.tier);
  const incidentType = pickIncidentType(input, severity);
  const spec = INCIDENT_CATALOG[incidentType];
  const edgeLanes = net.laneCount(snap.edgeId);
  const fullBlockage = !!input.requires_road_closure;
  const lanesAffected = fullBlockage
    ? edgeLanes
    : Math.min(spec.defaultLanes || 1, Math.max(1, edgeLanes - 1));
  const durationSec = Math.max(5, forecast.expected_duration_min) * 60;

  return {
    edgeId: snap.edgeId,
    distOnEdge: snap.distOnEdge,
    incidentType,
    severity,
    lanesAffected,
    fullBlockage,
    durationSec,
    snappedLat: snap.lat,
    snappedLon: snap.lon,
    snapDistanceM,
    edgeName: net.edge(snap.edgeId)?.name ?? "road",
  };
}
