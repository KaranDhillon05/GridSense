// Core simulation types for the Traffic Command Center digital twin.
// Coordinate convention: positions are {lat, lon}; geometry polylines are
// [lon, lat] pairs (GeoJSON order, matching the existing road_graph.json), and
// are converted to Leaflet [lat, lon] only at draw time.

import type { GraphEdge, GraphNode } from "@/lib/roadGraph";

export type RoadClass = GraphEdge["road_class"];

export type VehicleType =
  | "car"
  | "auto"
  | "bus"
  | "truck"
  | "ambulance"
  | "police"
  | "fire"
  | "tow";

/** Higher = more priority at signals / right of way. Emergency vehicles >= 5. */
export const VEHICLE_PRIORITY: Record<VehicleType, number> = {
  car: 1,
  auto: 1,
  bus: 2,
  truck: 1,
  tow: 3,
  police: 5,
  fire: 6,
  ambulance: 6,
};

export const VEHICLE_LENGTH_M: Record<VehicleType, number> = {
  car: 4.5,
  auto: 3.2,
  bus: 11,
  truck: 9,
  ambulance: 6,
  police: 4.8,
  fire: 8,
  tow: 7,
};

/** Desired free-flow speed in m/s by vehicle type. */
export const VEHICLE_DESIRED_MS: Record<VehicleType, number> = {
  car: 11,
  auto: 8,
  bus: 8.5,
  truck: 8,
  ambulance: 14,
  police: 13,
  fire: 12,
  tow: 9,
};

export interface Vehicle {
  id: number;
  type: VehicleType;
  priority: number;
  lengthM: number;
  // Route as a list of directed edge ids; index points at the current edge.
  route: string[];
  routeIdx: number;
  originNode: string;
  destNode: string;
  // Longitudinal position.
  edgeId: string;
  laneIndex: number;
  distOnEdge: number; // metres from edge start along the lane centreline
  speed: number; // m/s
  accel: number; // m/s^2 (last computed)
  // Derived render state (filled each step).
  lat: number;
  lon: number;
  heading: number; // radians
  // Stats.
  spawnTime: number;
  distanceTravelled: number;
  stoppedTime: number; // accumulated seconds at < 0.5 m/s
  arrived: boolean;
  // When traversing a junction turn connector instead of an edge.
  onConnector: boolean;
  connectorT: number; // metres travelled along the current turn connector
  connectorFrom?: string;
  connectorTo?: string;
  connectorFromLane?: number;
  connectorToLane?: number;
  connectorJunction?: string;
  emergency: boolean;
  isResource: boolean; // dispatched response vehicle (not counted in throughput demand)
}

export type SignalState = "red" | "yellow" | "green";

export interface SignalPhase {
  // edge ids (incoming, directed toward the junction) that get green this phase
  greenEdges: string[];
  greenSec: number;
  yellowSec: number;
  /** Incoming edges with protected left turns (separate sub-phase). */
  leftTurnEdges?: string[];
  leftTurnSec?: number;
}

export interface JunctionSignal {
  nodeId: string;
  phases: SignalPhase[];
  phaseIdx: number;
  timer: number; // seconds elapsed in current phase
  inYellow: boolean;
  inAllRed: boolean;
  inLeftTurn: boolean;
  mode: "fixed" | "adaptive" | "manual" | "emergency" | "failed";
  // Per incoming edge, the current light. Computed each step.
  edgeState: Map<string, SignalState>;
  // adaptive/override bookkeeping
  baseGreen: number[]; // original green durations, for restoring after adaptive
  overrideEdge?: string; // forced green (emergency / manual)
}

export type IncidentType =
  | "vehicle_breakdown"
  | "bus_breakdown"
  | "truck_breakdown"
  | "multi_vehicle_accident"
  | "minor_accident"
  | "major_accident"
  | "road_closure"
  | "road_construction"
  | "waterlogging"
  | "flooding"
  | "fallen_tree"
  | "signal_failure"
  | "vip_movement"
  | "political_rally"
  | "religious_gathering"
  | "festival"
  | "sports_event"
  | "concert"
  | "protest"
  | "emergency_evacuation"
  | "fire_incident"
  | "chemical_spill"
  | "utility_maintenance"
  | "metro_construction"
  | "crowd_gathering";

export type Severity = "low" | "moderate" | "high" | "severe";

export interface Incident {
  id: string;
  type: IncidentType;
  edgeId: string;
  distOnEdge: number;
  lat: number;
  lon: number;
  severity: Severity;
  lanesAffected: number;
  blockedLanes: number[]; // explicit lane indices that are physically blocked
  laneSide: "left" | "right" | "both";
  fullBlockage: boolean;
  startTime: number; // sim seconds
  durationSec: number; // remaining clearance time
  baseDurationSec: number;
  clearedTime?: number;
  // Response state
  resourcesOnScene: string[];
  responseApplied: boolean;
}

export type ResourceType =
  | "officer"
  | "supervisor"
  | "rapid_response"
  | "tow_truck"
  | "recovery_van"
  | "maintenance_crew"
  | "ambulance"
  | "fire_engine"
  | "barricade"
  | "cones"
  | "diversion_sign"
  | "portable_signal";

export type ResourceStatus = "idle" | "enroute" | "onscene" | "returning";

export interface Resource {
  id: string;
  type: ResourceType;
  status: ResourceStatus;
  homeNode: string;
  targetIncidentId?: string;
  // Optional moving vehicle backing this resource (officers/tow/ambulance...).
  vehicleId?: number;
  etaSec?: number;
}

export interface EdgeCongestion {
  edgeId: string;
  vehicleCount: number;
  queueLength: number; // metres of stopped vehicles back from the downstream end
  utilization: number; // 0..1.5 (flow vs capacity proxy via density)
  meanSpeed: number; // m/s
  blocked: boolean;
}

export interface Metrics {
  simTime: number;
  activeVehicles: number;
  arrived: number;
  meanSpeedKmh: number;
  totalDelayVehMin: number;
  vehicleHoursLost: number;
  meanTravelTimeMin: number;
  maxQueueM: number;
  networkUtilization: number;
  throughputPerMin: number;
  congestedEdges: number;
  gridlock: boolean;
}

export interface SimSnapshot {
  metrics: Metrics;
  incidents: Incident[];
  resources: Resource[];
  congestion: EdgeCongestion[];
  signals: { nodeId: string; state: SignalState; phase: number }[];
  vehicleCount: number;
}

export type { GraphEdge, GraphNode };
