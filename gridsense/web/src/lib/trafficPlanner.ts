import type { EventInput } from "@/lib/gridsense";
import {
  discoverAccessCorridors,
  edgeGeometry,
  getRoadGraph,
  matchClosedEdges,
  metersBetween,
  pathDistanceKm,
  snapToNearestNode,
  type AccessCorridor,
} from "@/lib/roadGraph";
import { assignFlowToEdges, criticalEdges, edgeTravelMin } from "@/lib/capacityModel";
import { aStar, dijkstra, kShortestPaths } from "@/lib/pathfinding";
import { buildTripDemand } from "@/lib/tripDemand";
import { runDispersalScenarios } from "@/lib/dispersalSim";
import { buildVenueRingPlan, buildRingControls, bundleRouteCount } from "@/lib/venueRouting";
import { buildNetworkPlan } from "@/lib/networkPlanner";
import { generateOpsBrief } from "@/lib/routingNarrative";
import { snapRoute } from "@/lib/roadRouting";
import type {
  BarricadePoint,
  DeploymentPost,
  RiskAssessment,
  SignageRequirement,
  TrafficImpactReport,
  TrafficPlanOutput,
  TrafficRoute,
  TrafficRouteBundle,
} from "@/lib/types";

const ATTENDANCE_RADIUS: Record<string, number> = {
  under_500: 350,
  between_500_2000: 500,
  between_2000_10000: 750,
  between_10000_50000: 1100,
  above_50000: 1500,
};

function radiusFor(input: EventInput) {
  return ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"] ?? 750;
}

function toTrafficRoute(
  path: { edge_ids: string[]; travel_min: number },
  spec: {
    id: string;
    phase: TrafficRoute["phase"];
    direction: TrafficRoute["direction"];
    rank: number;
    flowVph: number;
    capacityVph: number;
    util: number;
    edges: Map<string, ReturnType<typeof getRoadGraph>["edges"][0]>;
    edgeUtilization?: Map<string, number>;
  }
): TrafficRoute {
  const bottleneck = path.edge_ids.filter((id) => {
    const e = spec.edges.get(id);
    if (!e) return false;
    // Use per-edge utilization when available; fall back to route-level util.
    const edgeUtil = spec.edgeUtilization?.get(id) != null
      ? (spec.edgeUtilization.get(id)! / e.base_capacity_vph)
      : spec.util;
    return edgeUtil > 0.85;
  });
  return {
    id: spec.id,
    phase: spec.phase,
    direction: spec.direction,
    rank: spec.rank,
    geometry: edgeGeometry(path.edge_ids),
    edge_ids: path.edge_ids,
    distance_km: Math.round(pathDistanceKm(path.edge_ids) * 10) / 10,
    free_flow_min: Math.round(spec.edges.get(path.edge_ids[0]) ? edgeTravelMin(spec.edges.get(path.edge_ids[0])!) : path.travel_min),
    expected_travel_min: Math.round(path.travel_min * (1 + spec.util * 0.3) * 10) / 10,
    assigned_flow_vph: spec.flowVph,
    capacity_vph: spec.capacityVph,
    utilization: Math.round(spec.util * 100) / 100,
    bottleneck_edges: bottleneck,
    control_points: [],
    signage: [],
  };
}

function buildRoutes(
  input: EventInput,
  venueNodeId: string,
  corridors: AccessCorridor[],
  closed: Set<string>,
  demand: ReturnType<typeof buildTripDemand>
): TrafficRouteBundle {
  const graph = getRoadGraph();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgeMap = new Map(graph.edges.map((e) => [e.id, e]));
  const utilization = new Map<string, number>();

  const inboundGateways = corridors.filter((c) => c.direction === "inbound" || c.direction === "bidirectional").slice(0, 3);
  const outboundGateways = corridors.filter((c) => c.direction === "outbound" || c.direction === "bidirectional").slice(0, 3);
  if (!outboundGateways.length) {
    outboundGateways.push(...inboundGateways);
  }

  const primary_inbound: TrafficRoute[] = [];
  const secondary_inbound: TrafficRoute[] = [];
  const primary_outbound: TrafficRoute[] = [];
  const secondary_outbound: TrafficRoute[] = [];
  const through_diversion: TrafficRoute[] = [];
  const emergency_access: TrafficRoute[] = [];
  const contingency: TrafficRoute[] = [];

  const arrivalShare = demand.peak_arrival_vph / Math.max(1, inboundGateways.length);
  inboundGateways.forEach((corridor, idx) => {
    const gateway = corridor.gateway_node_ids[0];
    if (!gateway) return;
    const path = aStar(
      nodeMap,
      graph.edges,
      gateway,
      venueNodeId,
      closed,
      utilization,
      input.is_peak ? 3 : 2
    );
    if (!path) return;
    assignFlowToEdges(path.edge_ids, arrivalShare, edgeMap, utilization);
    const util = arrivalShare / corridor.base_capacity_vph;
    const route = toTrafficRoute(path, {
      id: `in_primary_${idx + 1}`,
      phase: idx === 0 ? "arrival" : "pre_event",
      direction: "inbound",
      rank: idx + 1,
      flowVph: Math.round(arrivalShare),
      capacityVph: corridor.base_capacity_vph,
      util,
      edges: edgeMap,
      edgeUtilization: utilization,
    });
    route.signage = [
      { id: `sig_in_${idx}`, phase: "arrival", location: corridor.name, message: `Follow ${corridor.name} to venue parking` },
    ];
    if (idx === 0) primary_inbound.push(route);
    else secondary_inbound.push(route);

    const alts = kShortestPaths(nodeMap, graph.edges, gateway, venueNodeId, closed, 2);
    alts.slice(1).forEach((alt, j) => {
      contingency.push(
        toTrafficRoute(alt, {
          id: `cont_in_${idx}_${j}`,
          phase: "contingency",
          direction: "inbound",
          rank: j + 1,
          flowVph: Math.round(arrivalShare * 0.5),
          capacityVph: corridor.base_capacity_vph,
          util: util * 0.7,
          edges: edgeMap,
          edgeUtilization: utilization,
        })
      );
    });
  });

  const departureShare = demand.peak_departure_vph / Math.max(1, outboundGateways.length);
  outboundGateways.forEach((corridor, idx) => {
    const gateway = corridor.gateway_node_ids[0];
    if (!gateway) return;
    const path = aStar(
      nodeMap,
      graph.edges,
      venueNodeId,
      gateway,
      closed,
      utilization,
      input.is_peak ? 4 : 2.5
    );
    if (!path) {
      const alt = kShortestPaths(nodeMap, graph.edges, venueNodeId, gateway, closed, 3)[0];
      if (!alt) return;
      assignFlowToEdges(alt.edge_ids, departureShare, edgeMap, utilization);
      const util = departureShare / corridor.base_capacity_vph;
      const route = toTrafficRoute(alt, {
        id: `out_primary_${idx + 1}`,
        phase: "dispersal",
        direction: "outbound",
        rank: idx + 1,
        flowVph: Math.round(departureShare),
        capacityVph: corridor.base_capacity_vph,
        util,
        edges: edgeMap,
        edgeUtilization: utilization,
      });
      route.signage = [
        { id: `sig_out_${idx}`, phase: "dispersal", location: corridor.name, message: `Exit via ${corridor.name}` },
      ];
      if (idx < 2) primary_outbound.push(route);
      else secondary_outbound.push(route);
      return;
    }
    assignFlowToEdges(path.edge_ids, departureShare, edgeMap, utilization);
    const util = departureShare / corridor.base_capacity_vph;
    const route = toTrafficRoute(path, {
      id: `out_primary_${idx + 1}`,
      phase: "dispersal",
      direction: "outbound",
      rank: idx + 1,
      flowVph: Math.round(departureShare),
      capacityVph: corridor.base_capacity_vph,
      util,
      edges: edgeMap,
      edgeUtilization: utilization,
    });
    route.signage = [
      { id: `sig_out_${idx}`, phase: "dispersal", location: corridor.name, message: `Exit via ${corridor.name}` },
    ];
    if (idx < 2) primary_outbound.push(route);
    else secondary_outbound.push(route);
  });

  // Through-diversion: use well-known anchor nodes if they exist; otherwise pick
  // the first two inbound gateways as a proxy (different origin and destination).
  const divOriginId =
    nodeMap.has("irr_west") ? "irr_west"
    : inboundGateways[0]?.gateway_node_ids[0];
  const divDestId =
    nodeMap.has("hosur_feeder") ? "hosur_feeder"
    : (inboundGateways[1] ?? inboundGateways[0])?.gateway_node_ids[0];
  if (divOriginId && divDestId && divOriginId !== divDestId) {
    const divPath = aStar(nodeMap, graph.edges, divOriginId, divDestId, closed, utilization, 2);
    if (divPath) {
      through_diversion.push(
        toTrafficRoute(divPath, {
          id: "through_diversion_1",
          phase: "during",
          direction: "diversion",
          rank: 1,
          flowVph: Math.round(demand.peak_arrival_vph * 0.4),
          capacityVph: 2400,
          util: 0.55,
          edges: edgeMap,
          edgeUtilization: utilization,
        })
      );
    }
  }

  // Emergency access: use dedicated staging node if it exists; otherwise skip
  // (emergency routes are a nice-to-have; absence is non-fatal).
  const emOriginId = nodeMap.has("emergency_bay") ? "emergency_bay"
    : outboundGateways[outboundGateways.length - 1]?.gateway_node_ids[0];
  if (emOriginId) {
    const emPath = dijkstra(nodeMap, graph.edges, emOriginId, venueNodeId, closed);
    if (emPath) {
      emergency_access.push(
        toTrafficRoute(emPath, {
          id: "emergency_access_1",
          phase: "during",
          direction: "emergency",
          rank: 1,
          flowVph: 60,
          capacityVph: 600,
          util: 0.1,
          edges: edgeMap,
          edgeUtilization: utilization,
        })
      );
    }
  }

  return {
    primary_inbound,
    secondary_inbound,
    primary_outbound,
    secondary_outbound,
    through_diversion,
    emergency_access,
    contingency,
  };
}

function buildRisks(routes: TrafficRouteBundle, dispersal: ReturnType<typeof runDispersalScenarios>) {
  const nominal = dispersal.find((d) => d.scenario === "nominal")!;
  const closed = dispersal.find((d) => d.scenario === "one_primary_closed")!;
  const risks: RiskAssessment[] = [
    {
      risk: "Dispersal surge locks primary outbound corridor",
      likelihood: "high",
      impact: "high",
      trigger: "Outbound edge utilization > 95%",
      contingency_action: "Activate secondary outbound routes and stagger exit waves",
      routes_to_activate: routes.secondary_outbound.map((r) => r.id),
    },
    {
      risk: "Primary inbound route unavailable",
      likelihood: "medium",
      impact: "medium",
      trigger: "Officer report or live ETA spike on inbound primary",
      contingency_action: "Switch to pre-ranked contingency inbound paths",
      routes_to_activate: routes.contingency.filter((r) => r.direction === "inbound").map((r) => r.id),
    },
    {
      risk: "Emergency access compromised",
      likelihood: "low",
      impact: "severe",
      trigger: "Barricade placed on emergency corridor",
      contingency_action: "Keep emergency_access route open; never barricade emergency edges",
      routes_to_activate: routes.emergency_access.map((r) => r.id),
    },
    {
      risk: "Weather slowdown extends dispersal",
      likelihood: "medium",
      impact: "medium",
      trigger: `p90 dispersal exceeds ${closed.time_to_disperse_p90_min} min under rain scenario`,
      contingency_action: "Extend outbound officer deployment; reduce assigned flow on saturated edges",
      routes_to_activate: routes.primary_outbound.map((r) => r.id),
    },
  ];
  void nominal;
  return risks;
}

function buildSignage(routes: TrafficRouteBundle): SignageRequirement[] {
  const sigs: SignageRequirement[] = [
    { id: "sig_adv_24h", phase: "pre_event", location: "Outer gateways", message: "Major event — expect delays, follow diversion signage" },
    { id: "sig_adv_2h", phase: "pre_event", location: "MG Road / Cubbon approaches", message: "Event parking filling — use alternate inbound routes" },
  ];
  for (const r of [...routes.primary_inbound, ...routes.primary_outbound]) {
    sigs.push(...r.signage);
  }
  return sigs;
}

/**
 * Apply real Mappls travel times to a built traffic plan.
 * realTravelMin maps corridor_id → actual Mappls duration in minutes.
 * This overrides the synthetic expected_travel_min on each route and
 * marks eta_source: "mappls" so the UI can display a source badge.
 */
export function applyRealTravelTimes(
  plan: TrafficPlanOutput,
  realTravelMin: Map<string, number>
): TrafficPlanOutput {
  if (!realTravelMin.size) return plan;

  const applyToBundle = (routes: typeof plan.routes) => {
    const apply = (rs: typeof plan.routes.primary_inbound) =>
      rs.map((r, idx) => {
        const corridorId = plan.access_corridors[idx]?.id;
        const real = corridorId ? realTravelMin.get(corridorId) : undefined;
        if (real == null) return r;
        return { ...r, expected_travel_min: real, eta_source: "mappls" as const };
      });
    return {
      ...routes,
      primary_inbound: apply(routes.primary_inbound),
      secondary_inbound: apply(routes.secondary_inbound),
      primary_outbound: apply(routes.primary_outbound),
      secondary_outbound: apply(routes.secondary_outbound),
    };
  };

  return { ...plan, routes: applyToBundle(plan.routes) };
}

/**
 * Snap every route in a graph-built bundle to the real road network via OSRM so
 * the displayed geometry aligns with the basemap. Diversions are routed through
 * their existing midpoint as a waypoint to preserve the bypass shape. Each route
 * keeps its graph metadata; only geometry / distance / ETA are replaced. On
 * failure a route keeps its original geometry (geometry_source: "graph").
 */
async function snapBundleToRoads(bundle: TrafficRouteBundle): Promise<TrafficRouteBundle> {
  const snapOne = async (r: TrafficRoute): Promise<TrafficRoute> => {
    if (r.geometry.length < 2) return { ...r, geometry_source: "graph" };
    const origin = r.geometry[0] as [number, number];
    const dest = r.geometry[r.geometry.length - 1] as [number, number];
    const via =
      r.direction === "diversion"
        ? (r.geometry[Math.floor(r.geometry.length / 2)] as [number, number])
        : undefined;
    const snaps = await snapRoute(origin, dest, via ? { via } : {});
    const snap = snaps?.[0];
    if (!snap) return { ...r, geometry_source: "graph" };
    return {
      ...r,
      geometry: snap.geometry,
      distance_km: snap.distance_km,
      expected_travel_min: Math.round(snap.duration_min * (1 + r.utilization * 0.3) * 10) / 10,
      eta_source: "osrm",
      geometry_source: "osrm",
    };
  };
  const snapList = (rs: TrafficRoute[]) => Promise.all(rs.map(snapOne));
  const [
    primary_inbound,
    secondary_inbound,
    primary_outbound,
    secondary_outbound,
    through_diversion,
    emergency_access,
    contingency,
  ] = await Promise.all([
    snapList(bundle.primary_inbound),
    snapList(bundle.secondary_inbound),
    snapList(bundle.primary_outbound),
    snapList(bundle.secondary_outbound),
    snapList(bundle.through_diversion),
    snapList(bundle.emergency_access),
    snapList(bundle.contingency),
  ]);
  return {
    primary_inbound,
    secondary_inbound,
    primary_outbound,
    secondary_outbound,
    through_diversion,
    emergency_access,
    contingency,
  };
}

export async function buildTrafficPlan(input: EventInput): Promise<TrafficPlanOutput | null> {
  if (input.lat == null || input.lon == null) return null;

  const demandEarly = buildTripDemand(input);

  // PRIMARY: real map-intelligence engine (OSM graph + equilibrium assignment +
  // edge-cut barricades + reserved emergency corridor). Every decision is derived
  // from the road topology. Falls through to the ring engine only if the venue is
  // outside artifact coverage or the network plan is too thin.
  try {
    const net = await buildNetworkPlan(input, demandEarly);
    // Accept a real-road network plan as long as it has the essentials (an
    // inbound approach, an outbound corridor, and an emergency route). Only the
    // truly threadbare case (venue off-network) falls back to the ring engine.
    const netOk =
      net &&
      net.routes.primary_inbound.length >= 1 &&
      net.routes.primary_outbound.length >= 1 &&
      bundleRouteCount(net.routes) >= 3;
    if (netOk) {
      const dispersal = runDispersalScenarios(demandEarly, [
        ...net.routes.primary_outbound,
        ...net.routes.secondary_outbound,
      ]);
      const ops_brief = await generateOpsBrief(net.narrative_grounding);
      return {
        venue_node_id: net.venue_node_id,
        plan_source: "network",
        access_corridors: net.access_corridors,
        traffic_impact: net.traffic_impact,
        routes: net.routes,
        control_points: net.deployment_posts.map((p) => ({
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          edge_id: p.edge_id,
          type: p.role,
          officers: p.officers,
          phase_active: p.phase_active ?? ["during"],
        })),
        barricade_points: net.barricade_points,
        deployment_posts: net.deployment_posts,
        risks: buildRisks(net.routes, dispersal),
        signage: buildSignage(net.routes),
        bottleneck_edges: net.bottleneck_edges,
        ops_brief,
        methodology: net.methodology,
      };
    }
  } catch (e) {
    console.error("[trafficPlanner] network engine failed, falling back to ring:", e);
  }

  const radius = radiusFor(input);
  const venue = snapToNearestNode(input.lat, input.lon);
  const corridors = discoverAccessCorridors(input.lat, input.lon, radius);
  const closed = matchClosedEdges((input.roads_to_close ?? []).map((r) => r.name));
  const demand = buildTripDemand(input);

  // Is the venue actually inside the synthetic graph's coverage? The graph only
  // covers a ~2 km box around Chinnaswamy Stadium. If the nearest node is far,
  // or the graph yields a thin plan, fall back to the venue-agnostic ring engine
  // so EVERY venue gets full diversions / alternates / contingency / barricades.
  const distToGraphM = metersBetween(input.lat, input.lon, venue.lat, venue.lon);
  const graphRoutes = buildRoutes(input, venue.id, corridors, closed, demand);
  const graphThin =
    distToGraphM > 1200 ||
    corridors.length < 2 ||
    bundleRouteCount(graphRoutes) < 5 ||
    graphRoutes.through_diversion.length === 0 ||
    graphRoutes.contingency.length === 0;

  // The ring engine already road-snaps via OSRM. For the in-box graph case we
  // snap the graph routes to real roads too, so geometry aligns with the basemap
  // for EVERY venue (the graph's hand-built geometry otherwise looks off-road).
  const ring = graphThin ? await buildVenueRingPlan(input, demand) : null;
  const routes = ring ? ring.routes : await snapBundleToRoads(graphRoutes);
  const planSource: "graph" | "ring" = ring ? "ring" : "graph";
  const accessCorridors = ring ? ring.corridors : corridors;

  const graph = getRoadGraph();
  const edgeMap = new Map(graph.edges.map((e) => [e.id, e]));
  const flowState = new Map<string, number>();
  for (const r of [...routes.primary_inbound, ...routes.primary_outbound]) {
    assignFlowToEdges(r.edge_ids, r.assigned_flow_vph, edgeMap, flowState);
  }
  // Graph routing has real edge_ids → derive critical edges from flow state.
  // Ring routing has no edges, so synthesise critical "edges" (corridors) from
  // the highest-utilisation routes so junction-risk reporting still works.
  const critical = ring
    ? [...routes.primary_inbound, ...routes.primary_outbound, ...routes.secondary_inbound]
        .filter((r) => r.utilization > 0.7)
        .sort((a, b) => b.utilization - a.utilization)
        .slice(0, 5)
        .map((r) => ({
          edge_id: r.id,
          name: r.signage[0]?.location ?? r.id,
          assigned_flow_vph: r.assigned_flow_vph,
          capacity_vph: r.capacity_vph,
          utilization: r.utilization,
        }))
    : criticalEdges(flowState, edgeMap);
  const dispersal = runDispersalScenarios(demand, [
    ...routes.primary_outbound,
    ...routes.secondary_outbound,
  ]);
  const nominal = dispersal.find((d) => d.scenario === "nominal")!;
  // Place barricades / posts ON the (road-snapped) route geometry for BOTH
  // engines, so barricade markers sit on the real approach roads and align with
  // the drawn corridors. buildRingControls also emits crowd-control barriers.
  const controls = ring
    ? { barricades: ring.barricades, posts: ring.posts }
    : buildRingControls(input, routes);

  const traffic_impact: TrafficImpactReport = {
    peak_arrival_vph: demand.peak_arrival_vph,
    peak_departure_vph: demand.peak_departure_vph,
    total_vehicle_trips: demand.total_vehicle_trips,
    critical_edges: critical,
    junction_queue_risk: critical.slice(0, 3).map((c) => ({
      junction: c.name,
      spillback_probability: c.utilization > 1 ? "high" : c.utilization > 0.85 ? "medium" : "low",
    })),
    time_to_disperse_p50_min: nominal.time_to_disperse_p50_min,
    time_to_disperse_p90_min: nominal.time_to_disperse_p90_min,
    baseline_delay_min: Math.round(nominal.peak_queue_delay_min + 5),
    traffic_load_factor: Math.min(1, demand.peak_departure_vph / 3000),
    dispersal_scenarios: dispersal,
    mode_split: demand.mode_split,
  };

  return {
    venue_node_id: venue.id,
    plan_source: planSource,
    access_corridors: accessCorridors,
    traffic_impact,
    routes,
    control_points: controls.posts.map((p) => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      edge_id: p.edge_id,
      type: p.role,
      officers: p.officers,
      phase_active: p.phase_active ?? ["during"],
    })),
    barricade_points: controls.barricades,
    deployment_posts: controls.posts,
    risks: buildRisks(routes, dispersal),
    signage: buildSignage(routes),
    bottleneck_edges: critical,
  };
}
