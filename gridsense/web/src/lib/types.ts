// Shared types for the Plan-an-Event / Operational Playbook feature.
// These mirror the JSON shape returned by /api/recommend (TS route) and the
// Python /recommend endpoint, so both backends stay faithful to one contract.

export type EventPlannerInput = {
  event_name: string;
  event_type: EventType;
  attendance_band: AttendanceBand;
  expected_attendance: number;
  start_hour: number;
  end_hour: number;
  entry_gates: number;
  parking_required: boolean;
  heavy_vehicle_restriction: boolean;
  public_transport_involved: boolean;
  roads_to_close: RoadClosureSegment[];
  cause: string;
  corridor: string;
  zone?: string;
  junction?: string;
  priority: string;
  requires_road_closure: boolean;
  is_planned: boolean;
  veh_type?: string;
  hour: number;
  dow: number;
  is_weekend: boolean;
  is_peak: boolean;
  affected_junctions: number;
  lat?: number;
  lon?: number;
};

export type EventType =
  | "public_gathering"
  | "sports_match"
  | "concert_festival"
  | "political_rally"
  | "religious_procession"
  | "marathon_road_race"
  | "vip_movement"
  | "construction_road_closure";

export type AttendanceBand =
  | "under_500"
  | "between_500_2000"
  | "between_2000_10000"
  | "between_10000_50000"
  | "above_50000";

export type RoadClosureSegment = {
  id: string;
  name: string;
};

export type ForecastResponse = {
  impact_score: number;
  tier: string;
  expected_duration_min: number;
  affected_radius_m: number;
  factors: Record<string, number>;
  weights: Record<string, number>;
  contributions: Record<string, number>;
  /** Post-event-learning calibration applied to the duration estimate. */
  calibration?: { base: number; factor: number; calibrated: number };
};

export type Demand = "low" | "medium" | "high";
export type CommNeed = "low" | "medium" | "urgent";
export type StrategyType =
  | "diversion-heavy"
  | "flow-management"
  | "time-restriction"
  | "clearance"
  | "vehicle-restriction"
  | "communication"
  | "junction-control";

export type Strategy = {
  id: string;
  name: string;
  type: StrategyType;
  recommended: boolean;
  use_when: string;
  expected_congestion_reduction: Demand;
  resource_demand: Demand;
  barricade_demand: Demand;
  public_communication_need: CommNeed;
  operational_complexity: Demand;
  confidence: "low" | "medium" | "high";
  reasoning: string[];
  actions: string[];
};

export type DiversionRoute = {
  provider: string;
  geometry: number[][]; // [lon, lat] pairs
  distance_km: number;
  extra_travel_min: number;
};

export type DiversionRouteOption = DiversionRoute & {
  id: string;
  rank: number;
  label?: string;
  route_type?: "primary" | "secondary" | "heavy_vehicle";
  road_type?: "arterial" | "sub_arterial" | "mixed";
  estimated_clearance_relief: Demand;
  advisory_note: string;
};

export type ResourcePlan = {
  officers_range: string;
  barricades_range: string;
  shifts: number;
  wardens: number;
  head_constables: number;
  constables: number;
  special_units: string[];
  confidence: string;
  narrative: string;
};

export type BarricadePoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  type: "hard" | "soft" | "coning";
  /** Vehicle road barricade vs pedestrian crowd-control barrier. */
  purpose?: "vehicle" | "crowd";
  officers_required: number;
  edge_id?: string;
  phase_active?: TrafficPhase[];
  /** Structured "why" behind this barricade placement (map-intelligence engine). */
  reasoning?: RoutingReasoning;
};

export type DeploymentPost = {
  id: string;
  lat: number;
  lon: number;
  role:
    | "traffic_point"
    | "crowd_control"
    | "diversion_guide"
    | "vip_escort"
    | "quick_response";
  officers: number;
  shift: "pre_event" | "during" | "post_event" | "all";
  label: string;
  edge_id?: string;
  phase_active?: TrafficPhase[];
};

export type TrafficPhase =
  | "pre_event"
  | "arrival"
  | "during"
  | "dispersal"
  | "post_event"
  | "contingency";

export type TrafficRoute = {
  id: string;
  phase: TrafficPhase;
  direction: "inbound" | "outbound" | "diversion" | "emergency";
  rank: number;
  geometry: number[][];
  edge_ids: string[];
  distance_km: number;
  free_flow_min: number;
  expected_travel_min: number;
  assigned_flow_vph: number;
  capacity_vph: number;
  utilization: number;
  bottleneck_edges: string[];
  control_points: ControlPoint[];
  signage: SignageRequirement[];
  eta_source?: DataSource;
  /** Where the line geometry came from: real OSM roads, the graph, or synthetic. */
  geometry_source?: "osrm" | "graph" | "synthetic" | "network";
  /** Structured "why" behind this route choice (map-intelligence engine). */
  reasoning?: RoutingReasoning;
};

/** Structured reasoning attached to a routing / barricade decision. */
export type RoutingReasoning = {
  summary: string;
  metric?: string;
  value?: number | string;
  alternatives?: string[];
};

export type TrafficRouteBundle = {
  primary_inbound: TrafficRoute[];
  secondary_inbound: TrafficRoute[];
  primary_outbound: TrafficRoute[];
  secondary_outbound: TrafficRoute[];
  through_diversion: TrafficRoute[];
  emergency_access: TrafficRoute[];
  contingency: TrafficRoute[];
};

export type EdgeUtilization = {
  edge_id: string;
  name: string;
  assigned_flow_vph: number;
  capacity_vph: number;
  utilization: number;
};

export type TrafficImpactReport = {
  peak_arrival_vph: number;
  peak_departure_vph: number;
  total_vehicle_trips: number;
  critical_edges: EdgeUtilization[];
  junction_queue_risk: Array<{ junction: string; spillback_probability: string }>;
  time_to_disperse_p50_min: number;
  time_to_disperse_p90_min: number;
  baseline_delay_min: number;
  traffic_load_factor: number;
  dispersal_scenarios: Array<{
    scenario: string;
    time_to_disperse_p50_min: number;
    time_to_disperse_p90_min: number;
    peak_queue_delay_min: number;
    routes_used: number;
  }>;
  mode_split: {
    private_car: number;
    taxi_ridehail: number;
    bus_metro: number;
    walk: number;
  };
};

export type ControlPoint = {
  id: string;
  lat: number;
  lon: number;
  edge_id?: string;
  type: string;
  officers: number;
  phase_active: TrafficPhase[];
};

export type SignageRequirement = {
  id: string;
  phase: TrafficPhase;
  location: string;
  message: string;
};

export type RiskAssessment = {
  risk: string;
  likelihood: string;
  impact: string;
  trigger: string;
  contingency_action: string;
  routes_to_activate: string[];
};

export type AccessCorridor = {
  id: string;
  name: string;
  direction: "inbound" | "outbound" | "bidirectional";
  gateway_node_ids: string[];
  road_class: string;
  base_capacity_vph: number;
  edge_ids: string[];
};

export type TrafficPlanOutput = {
  venue_node_id: string;
  /** Which engine produced the routes: real OSM network, legacy graph, or ring. */
  plan_source?: "network" | "graph" | "ring";
  /** AI operations brief grounded on the computed routing metrics. */
  ops_brief?: string;
  /** One-line description of the algorithm that produced this plan. */
  methodology?: string;
  access_corridors: AccessCorridor[];
  traffic_impact: TrafficImpactReport;
  routes: TrafficRouteBundle;
  control_points: ControlPoint[];
  barricade_points: BarricadePoint[];
  deployment_posts: DeploymentPost[];
  risks: RiskAssessment[];
  signage: SignageRequirement[];
  bottleneck_edges: EdgeUtilization[];
};

export type AreaAnalysis = {
  estimated_radius_m: number;
  nearby_junctions: string[];
  nearby_corridors: string[];
  peak_conflict_windows: string[];
};

export type Advisory = {
  control_style: string;
  impacted_corridor: string;
  candidate_alternates: string[];
  control_points: string[];
  public_note: string;
  selected_route_id?: string;
  route_options?: DiversionRouteOption[];
  routing_source?: string;
  fallback_reason?: string;
  route?: DiversionRoute;
};

export type Checklist = {
  before: string[];
  during: string[];
  after: string[];
};

export type Playbook = {
  recommended_strategy_id: string;
  why: string[];
  strategies: Strategy[];
  resource_plan: ResourcePlan;
  advisory: Advisory;
  barricade_points: BarricadePoint[];
  deployment_posts: DeploymentPost[];
  checklist: Checklist;
};

// --- Mappls real-data context (attached when Mappls APIs succeed) ----------

export type DataSource = "mappls" | "osrm" | "synthetic";

export type IsochroneContour = {
  /** Drive-time in minutes this contour represents */
  minutes: number;
  /** GeoJSON Polygon / MultiPolygon coordinates ([lon,lat][]) */
  geometry: number[][][];
  /** Approximate area in km² */
  area_km2: number;
  color: string;
};

export type GatewayMatrixEntry = {
  corridor_id: string;
  corridor_name: string;
  duration_min: number;
  distance_km: number;
  source: DataSource;
};

export type PoiFacility = {
  id: string;
  name: string;
  category: "hospital" | "police" | "fuel" | "parking";
  lat: number;
  lon: number;
  /** Route ID this facility is nearest to */
  route_id?: string;
  distance_m: number;
};

export type MapplsContext = {
  isochrones: IsochroneContour[];
  isochrone_source: DataSource;
  gateway_matrix: GatewayMatrixEntry[];
  gateway_matrix_source: DataSource;
  /** Road-snapped primary diversion route (replaces mock arc when source=mappls) */
  predictive_diversion?: DiversionRouteOption;
  predictive_diversion_source: DataSource;
  facilities: PoiFacility[];
  facilities_source: DataSource;
};

export type RecommendResponse = {
  forecast: ForecastResponse;
  mappls_context?: MapplsContext;
  // legacy single-plan block, kept for back-compat
  plan: {
    manpower: {
      head_constables: number;
      constables: number;
      wardens: number;
      shifts: number;
      total_deployment: number;
    };
    barricading: { barricade_units: number; placement: string; equipment: string[] };
    diversion: {
      needed: boolean;
      strategy: string;
      advisory_lead_time_min: number;
      selected_route_id?: string;
      route_options?: DiversionRouteOption[];
      routing_source?: string;
      fallback_reason?: string;
      route?: DiversionRoute;
    };
    confidence: string;
    narrative: string;
    deployment_posts: DeploymentPost[];
  };
  playbook: Playbook;
  area?: AreaAnalysis;
  traffic_plan?: TrafficPlanOutput | null;
  // How the playbook was produced: "ai" (Groq, grounded on our forecast + data)
  // or "rules" (deterministic rule-engine fallback).
  source: "ai" | "rules";
};
