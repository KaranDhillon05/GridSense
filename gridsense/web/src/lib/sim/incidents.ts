// Generic incident model + catalog. Every one of the 25 incident types is a row
// of parameters (severity, lanes, duration, whether it closes the road / fails a
// signal) plus a response template (resources, signal action, diversion
// strategy, field actions). The engine applies the *physical* effect; the
// decision engine reads the *response template*. Adding/tuning a type is a data
// edit, not new code.

import type {
  IncidentType,
  ResourceType,
  Severity,
} from "./types";

export type DiversionStrategy =
  | "none"
  | "local"
  | "full"
  | "split"
  | "oneway"
  | "corridor"
  | "perimeter";

export interface IncidentSpec {
  label: string;
  category: "breakdown" | "accident" | "hazard" | "closure" | "event" | "infra";
  defaultSeverity: Severity;
  defaultLanes: number;
  closesRoad: boolean;
  signalFailure?: boolean;
  /** an area event (rally/festival/...) vs a point incident on one edge */
  isEvent?: boolean;
  durationMin: [number, number];
  response: {
    resources: Partial<Record<ResourceType, number>>;
    diversion: DiversionStrategy;
    signalAction: string;
    actions: string[];
  };
}

export const INCIDENT_CATALOG: Record<IncidentType, IncidentSpec> = {
  vehicle_breakdown: {
    label: "Vehicle Breakdown", category: "breakdown", defaultSeverity: "low",
    defaultLanes: 1, closesRoad: false, durationMin: [15, 35],
    response: { resources: { tow_truck: 1, officer: 1, cones: 4 }, diversion: "local",
      signalAction: "Reduce upstream green by 15% to throttle inflow",
      actions: ["Dispatch tow truck", "Deploy one officer", "Place warning cones/barricades", "Reduce inflow via nearby signal", "Local lane diversion"] },
  },
  bus_breakdown: {
    label: "Bus Breakdown", category: "breakdown", defaultSeverity: "moderate",
    defaultLanes: 1, closesRoad: false, durationMin: [25, 50],
    response: { resources: { recovery_van: 1, officer: 2, cones: 6 }, diversion: "local",
      signalAction: "Throttle upstream inflow; prioritise alternate corridor",
      actions: ["Dispatch heavy recovery vehicle", "Deploy officers", "Temporary diversion", "Prioritise passenger evacuation"] },
  },
  truck_breakdown: {
    label: "Truck Breakdown", category: "breakdown", defaultSeverity: "high",
    defaultLanes: 2, closesRoad: false, durationMin: [40, 80],
    response: { resources: { recovery_van: 1, tow_truck: 1, officer: 2, barricade: 4 }, diversion: "split",
      signalAction: "Restrict corridor entry; raise alternate corridor green",
      actions: ["Heavy recovery team", "Restrict entry into corridor", "Increase alternate corridor capacity"] },
  },
  multi_vehicle_accident: {
    label: "Multi-Vehicle Accident", category: "accident", defaultSeverity: "severe",
    defaultLanes: 3, closesRoad: true, durationMin: [45, 90],
    response: { resources: { ambulance: 2, officer: 4, tow_truck: 2, barricade: 8 }, diversion: "full",
      signalAction: "Full diversion plan; protect emergency corridor",
      actions: ["Ambulance dispatch", "Police deployment", "Barricade perimeter", "Full diversion plan"] },
  },
  minor_accident: {
    label: "Minor Accident", category: "accident", defaultSeverity: "low",
    defaultLanes: 1, closesRoad: false, durationMin: [15, 30],
    response: { resources: { officer: 1, cones: 4 }, diversion: "local",
      signalAction: "Brief upstream throttle",
      actions: ["Dispatch police", "Temporary lane closure", "Local diversion"] },
  },
  major_accident: {
    label: "Major Accident", category: "accident", defaultSeverity: "severe",
    defaultLanes: 2, closesRoad: true, durationMin: [40, 80],
    response: { resources: { ambulance: 1, officer: 3, tow_truck: 1, barricade: 6 }, diversion: "full",
      signalAction: "Full diversion; emergency corridor green wave",
      actions: ["Ambulance dispatch", "Police deployment", "Barricade perimeter", "Full diversion plan"] },
  },
  road_closure: {
    label: "Road Closure", category: "closure", defaultSeverity: "high",
    defaultLanes: 3, closesRoad: true, durationMin: [60, 180],
    response: { resources: { barricade: 6, officer: 2, diversion_sign: 4 }, diversion: "full",
      signalAction: "Re-time downstream signals for the diversion corridor",
      actions: ["Barricade closure", "Activate diversion routes", "Signpost alternate routes"] },
  },
  road_construction: {
    label: "Road Construction", category: "infra", defaultSeverity: "moderate",
    defaultLanes: 2, closesRoad: false, durationMin: [120, 360],
    response: { resources: { barricade: 6, cones: 10, diversion_sign: 4, officer: 2 }, diversion: "split",
      signalAction: "Long-term signal optimisation around the work zone",
      actions: ["Long-term diversion", "Signal optimisation", "Capacity reduction"] },
  },
  waterlogging: {
    label: "Waterlogging", category: "hazard", defaultSeverity: "high",
    defaultLanes: 2, closesRoad: true, durationMin: [40, 120],
    response: { resources: { barricade: 4, officer: 2, diversion_sign: 2 }, diversion: "full",
      signalAction: "Close affected approach; reroute downstream",
      actions: ["Road closure", "Hazard alerts", "Alternate routing"] },
  },
  flooding: {
    label: "Flooding", category: "hazard", defaultSeverity: "severe",
    defaultLanes: 3, closesRoad: true, durationMin: [90, 240],
    response: { resources: { barricade: 6, officer: 3, diversion_sign: 4 }, diversion: "full",
      signalAction: "Close corridor; full diversion",
      actions: ["Road closure", "Hazard alerts", "Alternate routing", "Evacuation support"] },
  },
  fallen_tree: {
    label: "Fallen Tree", category: "hazard", defaultSeverity: "moderate",
    defaultLanes: 1, closesRoad: false, durationMin: [30, 75],
    response: { resources: { maintenance_crew: 1, officer: 1, cones: 4 }, diversion: "local",
      signalAction: "Throttle upstream inflow",
      actions: ["Dispatch maintenance crew", "Clear obstruction", "Local diversion"] },
  },
  signal_failure: {
    label: "Signal Failure", category: "infra", defaultSeverity: "high",
    defaultLanes: 0, closesRoad: false, signalFailure: true, durationMin: [30, 90],
    response: { resources: { officer: 2, portable_signal: 1 }, diversion: "none",
      signalAction: "Manual control + portable signal",
      actions: ["Officer deployment", "Temporary manual control", "Portable signal"] },
  },
  vip_movement: {
    label: "VIP Movement", category: "event", defaultSeverity: "high",
    defaultLanes: 3, closesRoad: true, isEvent: true, durationMin: [10, 30],
    response: { resources: { officer: 6, barricade: 8 }, diversion: "corridor",
      signalAction: "Green wave on protected corridor; hold cross traffic",
      actions: ["Corridor protection", "Controlled diversions", "Minimise city-wide impact"] },
  },
  political_rally: {
    label: "Political Rally", category: "event", defaultSeverity: "high",
    defaultLanes: 3, closesRoad: true, isEvent: true, durationMin: [120, 300],
    response: { resources: { officer: 10, barricade: 12, diversion_sign: 6 }, diversion: "oneway",
      signalAction: "Temporary one-way plan; controlled access",
      actions: ["Pre-event barricading", "Controlled access", "Temporary one-way plans", "Crowd management"] },
  },
  religious_gathering: {
    label: "Religious Gathering", category: "event", defaultSeverity: "moderate",
    defaultLanes: 2, closesRoad: true, isEvent: true, durationMin: [120, 360],
    response: { resources: { officer: 8, barricade: 10 }, diversion: "perimeter",
      signalAction: "Perimeter control; pedestrian phases",
      actions: ["Perimeter barricading", "Pedestrian zones", "Alternate routes"] },
  },
  festival: {
    label: "Festival", category: "event", defaultSeverity: "moderate",
    defaultLanes: 2, closesRoad: true, isEvent: true, durationMin: [180, 480],
    response: { resources: { officer: 8, barricade: 10, diversion_sign: 6 }, diversion: "perimeter",
      signalAction: "Dynamic plan; pedestrian phases",
      actions: ["Dynamic traffic management", "Parking management", "Pedestrian zones", "Alternate routes"] },
  },
  sports_event: {
    label: "Sports Event", category: "event", defaultSeverity: "high",
    defaultLanes: 2, closesRoad: false, isEvent: true, durationMin: [120, 240],
    response: { resources: { officer: 10, barricade: 12, diversion_sign: 4 }, diversion: "split",
      signalAction: "Staggered release; phase entry/exit corridors",
      actions: ["Entry phase strategy", "Exit phase strategy", "Staggered traffic release"] },
  },
  concert: {
    label: "Concert", category: "event", defaultSeverity: "high",
    defaultLanes: 2, closesRoad: false, isEvent: true, durationMin: [120, 240],
    response: { resources: { officer: 8, barricade: 10 }, diversion: "split",
      signalAction: "Staggered exit release",
      actions: ["Entry/exit phasing", "Staggered release", "Parking & pedestrian management"] },
  },
  protest: {
    label: "Protest", category: "event", defaultSeverity: "high",
    defaultLanes: 3, closesRoad: true, isEvent: true, durationMin: [60, 240],
    response: { resources: { officer: 12, barricade: 14 }, diversion: "full",
      signalAction: "Close affected roads; activate diversions",
      actions: ["Close affected roads", "Install barricades", "Activate diversion routes", "Increase manpower"] },
  },
  emergency_evacuation: {
    label: "Emergency Evacuation", category: "event", defaultSeverity: "severe",
    defaultLanes: 3, closesRoad: false, isEvent: true, durationMin: [30, 120],
    response: { resources: { officer: 12, ambulance: 2, fire_engine: 1, barricade: 8 }, diversion: "corridor",
      signalAction: "Outbound green wave; inbound hold",
      actions: ["Protected outbound corridors", "Emergency vehicle priority", "Controlled inflow"] },
  },
  fire_incident: {
    label: "Fire Incident", category: "hazard", defaultSeverity: "severe",
    defaultLanes: 2, closesRoad: true, durationMin: [40, 120],
    response: { resources: { fire_engine: 2, ambulance: 1, officer: 4, barricade: 8 }, diversion: "perimeter",
      signalAction: "Perimeter closure; emergency corridor",
      actions: ["Fire vehicle dispatch", "Barricade perimeter", "Full diversion", "Emergency corridor"] },
  },
  chemical_spill: {
    label: "Chemical Spill", category: "hazard", defaultSeverity: "severe",
    defaultLanes: 3, closesRoad: true, durationMin: [90, 240],
    response: { resources: { fire_engine: 1, maintenance_crew: 2, officer: 4, barricade: 10 }, diversion: "perimeter",
      signalAction: "Wide perimeter closure; full diversion",
      actions: ["Hazmat response", "Wide perimeter", "Full diversion", "Hazard alerts"] },
  },
  utility_maintenance: {
    label: "Utility Maintenance", category: "infra", defaultSeverity: "low",
    defaultLanes: 1, closesRoad: false, durationMin: [60, 180],
    response: { resources: { maintenance_crew: 1, cones: 6, officer: 1 }, diversion: "local",
      signalAction: "Local throttle",
      actions: ["Maintenance crew", "Lane coning", "Local diversion"] },
  },
  metro_construction: {
    label: "Metro Construction", category: "infra", defaultSeverity: "moderate",
    defaultLanes: 2, closesRoad: false, durationMin: [240, 600],
    response: { resources: { barricade: 8, cones: 12, diversion_sign: 6, officer: 2 }, diversion: "split",
      signalAction: "Long-term corridor signal re-timing",
      actions: ["Long-term diversion", "Capacity reduction", "Signal optimisation"] },
  },
  crowd_gathering: {
    label: "Unexpected Crowd", category: "event", defaultSeverity: "moderate",
    defaultLanes: 2, closesRoad: false, isEvent: true, durationMin: [20, 60],
    response: { resources: { officer: 6, barricade: 6 }, diversion: "local",
      signalAction: "Pedestrian phase; throttle inflow",
      actions: ["Crowd control barriers", "Pedestrian management", "Local diversion"] },
  },
};

export const INCIDENT_TYPES = Object.keys(INCIDENT_CATALOG) as IncidentType[];

export const SEVERITY_DURATION_MULT: Record<Severity, number> = {
  low: 0.7,
  moderate: 1,
  high: 1.4,
  severe: 1.9,
};
