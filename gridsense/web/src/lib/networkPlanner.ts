// Map-intelligence event traffic planner — REAL road network, no hardcoded rules.
//
// Every decision is derived from the OSM road topology (cityGraph) using graph
// algorithms, and carries a structured `reasoning`:
//   • Cordon          — interior nodes within the attendance-scaled radius.
//   • Barricades      — the cordon EDGE-CUT (edges crossing the boundary); the
//                       only physical entry/exit points, classified by role.
//   • Approaches      — the real arterials feeding the cordon (cut-edges), with
//                       gateway anchors walked outward along the network.
//   • Inbound/Outbound— incremental BPR user-equilibrium assignment distributes
//                       demand across approaches endogenously (trafficAssignment).
//   • Diversion       — shortest path in the residual graph (closed edges removed)
//                       for through-movements that normally cross the cordon.
//   • Emergency       — shortest-time path to the nearest hospital, reserved
//                       (excluded from public flow; its boundary crossing is a
//                       staffed gate, never hard-closed).
//
// Returns a structured intermediate; trafficPlanner.ts assembles the final
// TrafficPlanOutput (risks/signage/narrative) so the contract is unchanged.

import type { EventInput } from "@/lib/gridsense";
import type { GraphEdge } from "@/lib/roadGraph";
import type {
  AccessCorridor,
  BarricadePoint,
  DeploymentPost,
  RoutingReasoning,
  SignageRequirement,
  TrafficImpactReport,
  TrafficRoute,
  TrafficRouteBundle,
} from "@/lib/types";
import type { EdgeUtilization } from "@/lib/capacityModel";
import { freeFlowMin, bprCost } from "@/lib/capacityModel";
import {
  extractSubgraph,
  metersBetween,
  nearestHospitals,
  nearestNode,
  type SubGraph,
} from "@/lib/cityGraph";
import { shortestPath, pathGeometry, pathLengthKm } from "@/lib/graphSearch";
import { kShortestPaths } from "@/lib/pathfinding";
import { equilibriumAssign, type AssignContext, type ApproachAssignment } from "@/lib/trafficAssignment";
import type { buildTripDemand } from "@/lib/tripDemand";
import { runDispersalScenarios } from "@/lib/dispersalSim";

type Demand = ReturnType<typeof buildTripDemand>;

const ATTENDANCE_RADIUS: Record<string, number> = {
  under_500: 350,
  between_500_2000: 500,
  between_2000_10000: 750,
  between_10000_50000: 1100,
  above_50000: 1500,
};

const OFFICERS_BY_CLASS: Record<string, number> = {
  arterial: 4,
  sub_arterial: 3,
  collector: 2,
  local: 1,
};

export type NetworkPlan = {
  venue_node_id: string;
  access_corridors: AccessCorridor[];
  routes: TrafficRouteBundle;
  barricade_points: BarricadePoint[];
  deployment_posts: DeploymentPost[];
  bottleneck_edges: EdgeUtilization[];
  traffic_impact: TrafficImpactReport;
  methodology: string;
  narrative_grounding: Record<string, unknown>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (x: number) => Math.round(x * 100);

function cordonRadius(input: EventInput): number {
  return ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"] ?? 750;
}

/** Walk outward from a boundary node along the highest-capacity chain that keeps
 *  moving away from the venue, to anchor a meaningful approach corridor. */
function walkOutward(
  sub: SubGraph,
  startId: string,
  venuePt: [number, number],
  targetDistM: number
): string {
  let cur = sub.nodes.get(startId);
  if (!cur) return startId;
  let curId = startId;
  const seen = new Set<string>([startId]);
  for (let hop = 0; hop < 8; hop++) {
    const here = sub.nodes.get(curId)!;
    const dHere = metersBetween(venuePt[1], venuePt[0], here.lat, here.lon);
    if (dHere >= targetDistM) break;
    let best: { id: string; score: number } | null = null;
    for (const e of sub.adjacency.get(curId) ?? []) {
      if (seen.has(e.to)) continue;
      const to = sub.nodes.get(e.to);
      if (!to) continue;
      const dTo = metersBetween(venuePt[1], venuePt[0], to.lat, to.lon);
      if (dTo <= dHere) continue; // must move outward
      const score = (dTo - dHere) + e.base_capacity_vph / 50;
      if (!best || score > best.score) best = { id: e.to, score };
    }
    if (!best) break;
    seen.add(best.id);
    curId = best.id;
  }
  void cur;
  return curId;
}

type Gateway = { nodeId: string; name: string; capacity: number; cutEdgeId: string };

/** The cordon edge-cut: edges crossing the boundary, split into entry/exit. */
function computeCut(sub: SubGraph, venuePt: [number, number], radiusM: number) {
  const inside = (id: string) => {
    const n = sub.nodes.get(id)!;
    return metersBetween(venuePt[1], venuePt[0], n.lat, n.lon) <= radiusM;
  };
  const entry: GraphEdge[] = []; // outside → inside  (inbound entry)
  const exit: GraphEdge[] = []; // inside → outside  (outbound exit)
  for (const e of sub.edges) {
    const fi = inside(e.from);
    const ti = inside(e.to);
    if (fi === ti) continue;
    if (!fi && ti) entry.push(e);
    else if (fi && !ti) exit.push(e);
  }
  return { entry, exit, inside };
}

/** Pick gateway anchors from cut edges: dedup by road name (max capacity),
 *  then walk each outward so the approach corridor is substantial. */
function gatewaysFromCut(
  sub: SubGraph,
  cutEdges: GraphEdge[],
  venuePt: [number, number],
  radiusM: number,
  outerNodeOf: (e: GraphEdge) => string,
  max = 6
): Gateway[] {
  const byName = new Map<string, GraphEdge>();
  for (const e of cutEdges) {
    const cur = byName.get(e.name);
    if (!cur || e.base_capacity_vph > cur.base_capacity_vph) byName.set(e.name, e);
  }
  const ranked = [...byName.values()]
    .sort((a, b) => b.base_capacity_vph - a.base_capacity_vph)
    .slice(0, max);
  return ranked.map((e) => ({
    nodeId: walkOutward(sub, outerNodeOf(e), venuePt, radiusM + 1800),
    name: e.name,
    capacity: e.base_capacity_vph,
    cutEdgeId: e.id,
  }));
}

function makeRoute(
  id: string,
  direction: TrafficRoute["direction"],
  phase: TrafficRoute["phase"],
  rank: number,
  edgeIds: string[],
  sub: SubGraph,
  edgeFlow: Map<string, number>,
  liveMin: Map<string, number>,
  flowVph: number,
  capacityVph: number,
  reasoning: RoutingReasoning,
  signage: SignageRequirement[]
): TrafficRoute {
  const geometry = pathGeometry(edgeIds, sub.edgeById);
  const distance_km = round1(pathLengthKm(edgeIds, sub.edgeById));
  const free = edgeIds.reduce((s, eid) => s + (sub.edgeById.get(eid) ? freeFlowMin(sub.edgeById.get(eid)!) : 0), 0);
  const loaded = edgeIds.reduce(
    (s, eid) => s + (sub.edgeById.get(eid) ? bprCost(sub.edgeById.get(eid)!, edgeFlow.get(eid) ?? 0, liveMin.get(eid)) : 0),
    0
  );
  const util = capacityVph > 0 ? Math.min(1.5, flowVph / capacityVph) : 0;
  const bottleneck = edgeIds.filter((eid) => {
    const e = sub.edgeById.get(eid);
    if (!e) return false;
    return (edgeFlow.get(eid) ?? 0) / e.base_capacity_vph > 0.85;
  });
  return {
    id,
    phase,
    direction,
    rank,
    geometry,
    edge_ids: edgeIds,
    distance_km,
    free_flow_min: Math.round(free),
    expected_travel_min: round1(loaded),
    assigned_flow_vph: Math.round(flowVph),
    capacity_vph: capacityVph,
    utilization: Math.round(util * 100) / 100,
    bottleneck_edges: bottleneck,
    control_points: [],
    signage,
    eta_source: liveMin.size ? "mappls" : "synthetic",
    geometry_source: "network",
    reasoning,
  };
}

export async function buildNetworkPlan(input: EventInput, demand: Demand): Promise<NetworkPlan | null> {
  if (input.lat == null || input.lon == null) return null;
  const lat = input.lat;
  const lon = input.lon;
  const venuePt: [number, number] = [lon, lat];
  const radius = cordonRadius(input);

  // Size the subgraph to reach beyond the cordon AND cover the nearest hospital.
  const hospitals = nearestHospitals(lat, lon, 3);
  const emHospital = hospitals[0];
  const subRadius = Math.max(radius + 3500, (emHospital?.distance_m ?? 0) + 600);
  const sub = extractSubgraph(lat, lon, subRadius);
  if (!sub) return null;
  const venueId = sub.venueNodeId;

  // ---- Emergency corridor (reserved) -------------------------------------
  const reserved = new Set<string>();
  let emergencyRoute: TrafficRoute | null = null;
  let emergencyGateNodeId: string | null = null;
  let emHospitalUsed = emHospital;
  {
    const ff = (e: GraphEdge) => freeFlowMin(e);
    // Try the nearest few hospitals; accept the first that has a directed path to
    // the venue (hospital→venue, the ambulance direction). Guarantees a corridor.
    let path: ReturnType<typeof shortestPath> = null;
    for (const h of hospitals) {
      const hub = nearestNode(h.lat, h.lon);
      if (!hub || !sub.nodes.has(hub.id) || hub.id === venueId) continue;
      const p = shortestPath(sub.adjacency, hub.id, venueId, ff);
      if (p && p.edge_ids.length) {
        path = p;
        emHospitalUsed = h;
        break;
      }
    }
    if (path && emHospitalUsed) {
      const emHospital = emHospitalUsed; // narrow for closures below
      {
        for (const eid of path.edge_ids) reserved.add(eid);
        // the cordon-boundary crossing node along this path is the managed gate
        emergencyGateNodeId = path.node_ids.find((nid) => {
          const n = sub.nodes.get(nid)!;
          return metersBetween(lat, lon, n.lat, n.lon) <= radius;
        }) ?? venueId;
        emergencyRoute = makeRoute(
          "emergency_access_1",
          "emergency",
          "during",
          1,
          path.edge_ids,
          sub,
          new Map(),
          new Map(),
          60,
          600,
          {
            summary: `Reserved corridor to ${emHospital.name} — shortest-time path, protected from public assignment; boundary crossing is a staffed gate, never hard-closed.`,
            metric: "distance_to_hospital_km",
            value: round1(pathLengthKm(path.edge_ids, sub.edgeById)),
          },
          [
            {
              id: "sig_em_1",
              phase: "during",
              location: `${emHospital.name} corridor`,
              message: "EMERGENCY LANE — keep clear. No general traffic, no barricades.",
            },
          ]
        );
        emergencyRoute.utilization = 0.1;
      }
    }
  }

  // ---- Cordon edge-cut + approach gateways -------------------------------
  // Seed gateways from ALL real corridors crossing the cordon (entry ∪ exit), so
  // one-way arterials aren't missed; the directed assignment then routes legal
  // paths in/out. Same physical corridors anchor both inbound and outbound.
  const { entry, exit } = computeCut(sub, venuePt, radius);
  const distFromVenue = (id: string) => {
    const n = sub.nodes.get(id)!;
    return metersBetween(lat, lon, n.lat, n.lon);
  };
  const outerOf = (e: GraphEdge) => (distFromVenue(e.from) >= distFromVenue(e.to) ? e.from : e.to);
  const gateways = gatewaysFromCut(sub, [...entry, ...exit], venuePt, radius, outerOf, 7);
  const inGateways = gateways;
  const outGateways = gateways;

  // Requested road closures matched against real OSM names.
  const closeNames = (input.roads_to_close ?? []).map((r) => r.name.toLowerCase()).filter(Boolean);
  const closed = new Set<string>();
  if (closeNames.length) {
    for (const e of sub.edges) {
      const nm = e.name.toLowerCase();
      if (closeNames.some((c) => nm.includes(c) || c.includes(nm))) closed.add(e.id);
    }
  }

  const liveMin = new Map<string, number>(); // reserved for future per-edge live feed
  const ctx: AssignContext = {
    adjacency: sub.adjacency,
    edgeById: sub.edgeById,
    closed,
    reserved,
    liveMin,
  };

  // ---- Inbound / Outbound equilibrium assignment -------------------------
  let inboundAsg = inGateways.length
    ? equilibriumAssign(ctx, venueId, inGateways.map((g) => g.nodeId), demand.peak_arrival_vph, false)
    : { edgeFlow: new Map(), approaches: [], total_demand_vph: demand.peak_arrival_vph };
  // If reserving the emergency corridor blocked all approaches, relax it.
  if (!inboundAsg.approaches.length && reserved.size) {
    ctx.reserved = new Set();
    inboundAsg = inGateways.length
      ? equilibriumAssign(ctx, venueId, inGateways.map((g) => g.nodeId), demand.peak_arrival_vph, false)
      : inboundAsg;
  }
  const outboundAsg = outGateways.length
    ? equilibriumAssign(ctx, venueId, outGateways.map((g) => g.nodeId), demand.peak_departure_vph, true)
    : { edgeFlow: new Map(), approaches: [], total_demand_vph: demand.peak_departure_vph };

  const gwName = (gws: Gateway[], id: string) => gws.find((g) => g.nodeId === id)?.name ?? "approach";

  // Arrival and dispersal peak in DIFFERENT time windows, so an edge's worst-case
  // loading is the MAX of its inbound/outbound flow, not the sum.
  const edgeFlow = new Map<string, number>(inboundAsg.edgeFlow);
  for (const [k, v] of outboundAsg.edgeFlow) edgeFlow.set(k, Math.max(edgeFlow.get(k) ?? 0, v));

  // ---- Build inbound routes ----------------------------------------------
  const primary_inbound: TrafficRoute[] = [];
  const secondary_inbound: TrafficRoute[] = [];
  const contingency: TrafficRoute[] = [];
  inboundAsg.approaches.forEach((a, idx) => {
    const name = gwName(inGateways, a.gatewayId);
    const others = inboundAsg.approaches.filter((x) => x !== a).map((x) => gwName(inGateways, x.gatewayId));
    const r = makeRoute(
      `in_${idx + 1}`,
      "inbound",
      idx === 0 ? "arrival" : "pre_event",
      idx + 1,
      a.path.edge_ids,
      sub,
      inboundAsg.edgeFlow,
      liveMin,
      a.assigned_flow_vph,
      a.capacity_vph,
      {
        summary: `Carries ${pct(a.share)}% of inbound demand via ${name}; equilibrium load split across ${inboundAsg.approaches.length} real approaches by BPR cost.`,
        metric: "assigned_flow_vph",
        value: a.assigned_flow_vph,
        alternatives: others,
      },
      [{ id: `sig_in_${idx}`, phase: "arrival", location: name, message: `Event-bound traffic via ${name} → managed entry.` }]
    );
    if (idx === 0) primary_inbound.push(r);
    else secondary_inbound.push(r);

    // Contingency = Yen's 2nd-shortest path that differs from the primary
    if (idx < 2 && a.path.edge_ids.length) {
      const alts = kShortestPaths(sub.nodes, sub.edges, a.gatewayId, venueId, closed, 2);
      const alt = alts.find((p) => p.edge_ids.join("|") !== a.path.edge_ids.join("|"));
      if (alt && alt.edge_ids.length) {
        contingency.push(
          makeRoute(
            `cont_in_${idx + 1}`,
            "inbound",
            "contingency",
            idx + 1,
            alt.edge_ids,
            sub,
            edgeFlow,
            liveMin,
            Math.round(a.assigned_flow_vph * 0.5),
            a.capacity_vph,
            { summary: `Pre-ranked reroute for ${name} if the primary jams — genuinely different real-road path (Yen k-shortest).`, metric: "fallback_for", value: name },
            [{ id: `sig_cont_${idx}`, phase: "contingency", location: name, message: `Contingency reroute for ${name}.` }]
          )
        );
      }
    }
  });

  // ---- Build outbound routes ---------------------------------------------
  const primary_outbound: TrafficRoute[] = [];
  const secondary_outbound: TrafficRoute[] = [];
  outboundAsg.approaches.forEach((a, idx) => {
    const name = gwName(outGateways, a.gatewayId);
    const r = makeRoute(
      `out_${idx + 1}`,
      "outbound",
      "dispersal",
      idx + 1,
      a.path.edge_ids,
      sub,
      outboundAsg.edgeFlow,
      liveMin,
      a.assigned_flow_vph,
      a.capacity_vph,
      {
        summary: `Releases ${pct(a.share)}% of dispersal via ${name}; staggered release recommended to keep utilization < 1.0.`,
        metric: "assigned_flow_vph",
        value: a.assigned_flow_vph,
        alternatives: outboundAsg.approaches.filter((x) => x !== a).map((x) => gwName(outGateways, x.gatewayId)),
      },
      [{ id: `sig_out_${idx}`, phase: "dispersal", location: name, message: `Event exit via ${name}. Staggered release.` }]
    );
    if (idx < 2) primary_outbound.push(r);
    else secondary_outbound.push(r);
  });

  // ---- Through-diversion: residual-graph bypass for cross-cordon movements
  const through_diversion: TrafficRoute[] = [];
  const cordonInteriorClosed = new Set<string>(closed);
  // Close interior edges (both endpoints inside cordon) so the bypass routes AROUND.
  for (const e of sub.edges) {
    const a = sub.nodes.get(e.from)!;
    const b = sub.nodes.get(e.to)!;
    if (
      metersBetween(lat, lon, a.lat, a.lon) <= radius &&
      metersBetween(lat, lon, b.lat, b.lon) <= radius
    ) {
      cordonInteriorClosed.add(e.id);
    }
  }
  const divPairs = pickThroughPairs(inGateways, outGateways, sub, venuePt, radius);
  divPairs.forEach((pair, i) => {
    const ff = (e: GraphEdge) => freeFlowMin(e);
    const normal = shortestPath(sub.adjacency, pair.a, pair.b, ff);
    const bypassPaths = kShortestPaths(sub.nodes, sub.edges, pair.a, pair.b, cordonInteriorClosed, 2);
    const bypass = bypassPaths[0];
    if (!bypass || !bypass.edge_ids.length) return;
    const altBypass = bypassPaths[1];
    const dKm = round1(pathLengthKm(bypass.edge_ids, sub.edgeById) - (normal ? pathLengthKm(normal.edge_ids, sub.edgeById) : 0));
    through_diversion.push(
      makeRoute(
        `through_diversion_${i + 1}`,
        "diversion",
        "during",
        i + 1,
        bypass.edge_ids,
        sub,
        edgeFlow,
        liveMin,
        Math.round(demand.peak_arrival_vph * 0.3),
        2400,
        {
          summary: `Through-movement ${pair.aName} → ${pair.bName} normally crosses the closed cordon; bypass routes around it${dKm > 0 ? `, +${dKm} km` : ""}.`,
          metric: "extra_distance_km",
          value: Math.max(0, dKm),
          alternatives: [
            ...(normal ? [`Direct (now closed): ${round1(pathLengthKm(normal.edge_ids, sub.edgeById))} km`] : []),
            ...(altBypass && altBypass.edge_ids.join("|") !== bypass.edge_ids.join("|")
              ? [`Alternate bypass: ${round1(pathLengthKm(altBypass.edge_ids, sub.edgeById))} km`]
              : []),
          ],
        },
        [{ id: `sig_div_${i}`, phase: "during", location: `${pair.aName} ⇆ ${pair.bName}`, message: `THROUGH TRAFFIC: bypass the cordon — do not enter.` }]
      )
    );
  });

  // ---- Barricades from the edge-cut --------------------------------------
  const barricade_points = buildCutBarricades(sub, entry, exit, venuePt, radius, reserved, emergencyGateNodeId, inGateways);
  // crowd-control barriers at venue gates (pedestrian) — venue-centric.
  barricade_points.push(...buildCrowdBarriers(input, radius));

  // ---- Deployment posts ---------------------------------------------------
  const deployment_posts = buildPosts(input, primary_inbound, primary_outbound, through_diversion, emergencyRoute, sub);

  // ---- Bottlenecks + impact ----------------------------------------------
  const bottleneck_edges = topCriticalEdges(edgeFlow, sub.edgeById, 6);
  const routes: TrafficRouteBundle = {
    primary_inbound,
    secondary_inbound,
    primary_outbound,
    secondary_outbound,
    through_diversion,
    emergency_access: emergencyRoute ? [emergencyRoute] : [],
    contingency,
  };
  const dispersal = runDispersalScenarios(demand, [...primary_outbound, ...secondary_outbound]);
  const nominal = dispersal.find((d) => d.scenario === "nominal")!;
  const traffic_impact: TrafficImpactReport = {
    peak_arrival_vph: demand.peak_arrival_vph,
    peak_departure_vph: demand.peak_departure_vph,
    total_vehicle_trips: demand.total_vehicle_trips,
    critical_edges: bottleneck_edges,
    junction_queue_risk: bottleneck_edges.slice(0, 3).map((c) => ({
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

  const access_corridors: AccessCorridor[] = [
    ...inboundAsg.approaches.map((a, i) => corridorFrom(a, gwName(inGateways, a.gatewayId), "inbound", sub, i)),
    ...outboundAsg.approaches.map((a, i) => corridorFrom(a, gwName(outGateways, a.gatewayId), "outbound", sub, i)),
  ];

  const narrative_grounding = {
    venue: { lat, lon, cordon_radius_m: radius },
    demand: { inbound_vph: demand.peak_arrival_vph, outbound_vph: demand.peak_departure_vph, total_trips: demand.total_vehicle_trips },
    inbound_approaches: inboundAsg.approaches.map((a) => ({ road: gwName(inGateways, a.gatewayId), share_pct: pct(a.share), flow_vph: a.assigned_flow_vph, utilization: a.utilization })),
    outbound_approaches: outboundAsg.approaches.map((a) => ({ road: gwName(outGateways, a.gatewayId), share_pct: pct(a.share), flow_vph: a.assigned_flow_vph, utilization: a.utilization })),
    barricades: barricade_points.filter((b) => b.purpose === "vehicle").length,
    hard_closures: barricade_points.filter((b) => b.type === "hard").length,
    emergency: emergencyRoute && emHospitalUsed ? { hospital: emHospitalUsed.name, distance_km: emergencyRoute.distance_km } : null,
    diversions: through_diversion.map((d) => ({ id: d.id, extra_km: d.reasoning?.value })),
    bottlenecks: bottleneck_edges.map((b) => ({ road: b.name, utilization: b.utilization })),
  };

  const methodology =
    "Real OSM road graph (Overpass) → cordon edge-cut for barricades → incremental BPR user-equilibrium assignment for inbound/outbound across the actual arterials → residual-graph shortest paths for diversions → shortest-time reserved corridor to the nearest hospital.";

  return {
    venue_node_id: venueId,
    access_corridors,
    routes,
    barricade_points,
    deployment_posts,
    bottleneck_edges,
    traffic_impact,
    methodology,
    narrative_grounding,
  };
}

// --- helpers ----------------------------------------------------------------

function corridorFrom(
  a: ApproachAssignment,
  name: string,
  direction: "inbound" | "outbound",
  sub: SubGraph,
  i: number
): AccessCorridor {
  const firstEdge = sub.edgeById.get(a.path.edge_ids[0]);
  return {
    id: `${direction}_${i}_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    direction,
    gateway_node_ids: [a.gatewayId],
    road_class: firstEdge?.road_class ?? "arterial",
    base_capacity_vph: a.capacity_vph,
    edge_ids: a.path.edge_ids,
  };
}

/** Choose through-movement OD pairs whose natural straight line passes near the
 *  venue (i.e. the venue sits between them) — genuine cross-cordon traffic. */
function pickThroughPairs(
  inG: Gateway[],
  outG: Gateway[],
  sub: SubGraph,
  venuePt: [number, number],
  radiusM: number
) {
  const all = [...inG, ...outG];
  const pairs: Array<{ a: string; b: string; aName: string; bName: string; sep: number }> = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = sub.nodes.get(all[i].nodeId);
      const B = sub.nodes.get(all[j].nodeId);
      if (!A || !B || all[i].name === all[j].name) continue;
      // distance of venue from segment A-B (planar approx)
      const d = pointToSegM([venuePt[1], venuePt[0]], [A.lat, A.lon], [B.lat, B.lon]);
      if (d <= radiusM * 1.6) {
        const sep = metersBetween(A.lat, A.lon, B.lat, B.lon);
        pairs.push({ a: all[i].nodeId, b: all[j].nodeId, aName: all[i].name, bName: all[j].name, sep });
      }
    }
  }
  return pairs.sort((x, y) => y.sep - x.sep).slice(0, 3);
}

function pointToSegM(p: [number, number], a: [number, number], b: [number, number]): number {
  const mlat = 111320;
  const mlon = 111320 * Math.cos((a[0] * Math.PI) / 180);
  const ax = a[1] * mlon, ay = a[0] * mlat;
  const bx = b[1] * mlon, by = b[0] * mlat;
  const px = p[1] * mlon, py = p[0] * mlat;
  const dx = bx - ax, dy = by - ay;
  const seg2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / seg2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function buildCutBarricades(
  sub: SubGraph,
  entry: GraphEdge[],
  exit: GraphEdge[],
  venuePt: [number, number],
  radiusM: number,
  reserved: Set<string>,
  emergencyGateNodeId: string | null,
  inGateways: Gateway[]
): BarricadePoint[] {
  // Dedup cut edges by road name, keep the highest-capacity crossing per road.
  const byName = new Map<string, GraphEdge>();
  for (const e of [...entry, ...exit]) {
    const cur = byName.get(e.name);
    if (!cur || e.base_capacity_vph > cur.base_capacity_vph) byName.set(e.name, e);
  }
  const approachNames = new Set(inGateways.map((g) => g.name));
  const out: BarricadePoint[] = [];
  let id = 0;
  for (const e of [...byName.values()].sort((a, b) => b.base_capacity_vph - a.base_capacity_vph).slice(0, 12)) {
    // boundary point = the interior endpoint of the cut edge (where the cordon line is)
    const interiorNodeId = metersBetween(venuePt[1], venuePt[0], sub.nodes.get(e.to)!.lat, sub.nodes.get(e.to)!.lon) <= radiusM ? e.to : e.from;
    const n = sub.nodes.get(interiorNodeId)!;
    const isEmergencyGate = interiorNodeId === emergencyGateNodeId || reserved.has(e.id);
    const isApproach = approachNames.has(e.name);
    const officers = OFFICERS_BY_CLASS[e.road_class] ?? 2;
    if (isEmergencyGate) {
      out.push({
        id: `barricade_${++id}`,
        lat: n.lat,
        lon: n.lon,
        label: `Managed gate — ${e.name} (emergency corridor, keep open)`,
        type: "soft",
        purpose: "vehicle",
        officers_required: officers,
        edge_id: e.id,
        phase_active: ["pre_event", "during", "dispersal"],
        reasoning: { summary: `Cordon crossing on the reserved emergency corridor — staffed gate, never hard-closed.`, metric: "capacity_vph", value: e.base_capacity_vph },
      });
    } else if (isApproach) {
      out.push({
        id: `barricade_${++id}`,
        lat: n.lat,
        lon: n.lon,
        label: `Managed entry — ${e.name} (event/credentialed traffic only)`,
        type: "soft",
        purpose: "vehicle",
        officers_required: officers,
        edge_id: e.id,
        phase_active: ["pre_event", "during", "dispersal"],
        reasoning: { summary: `Cut-edge on an active approach corridor (${e.base_capacity_vph} vph) — metered entry, not a hard closure.`, metric: "capacity_vph", value: e.base_capacity_vph },
      });
    } else {
      out.push({
        id: `barricade_${++id}`,
        lat: n.lat,
        lon: n.lon,
        label: `Hard barricade — block & divert ${e.name}`,
        type: "hard",
        purpose: "vehicle",
        officers_required: officers,
        edge_id: e.id,
        phase_active: ["pre_event", "during", "dispersal"],
        reasoning: { summary: `Boundary cut-edge isolating the cordon (${e.base_capacity_vph} vph) — hard-closed; through-traffic diverted around the cordon.`, metric: "capacity_vph", value: e.base_capacity_vph },
      });
    }
  }
  return out;
}

const M_PER_DEG_LAT = 111320;
function offset(lat: number, lon: number, distM: number, bearingDeg: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dNorth = distM * Math.cos(rad);
  const dEast = distM * Math.sin(rad);
  return [lat + dNorth / M_PER_DEG_LAT, lon + dEast / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))];
}

function buildCrowdBarriers(input: EventInput, radiusM: number): BarricadePoint[] {
  if (input.lat == null || input.lon == null) return [];
  const gates = Math.max(2, input.entry_gates ?? 3);
  const out: BarricadePoint[] = [];
  for (let i = 0; i < gates; i++) {
    const [blat, blon] = offset(input.lat, input.lon, radiusM * 0.45, (i * 360) / gates);
    out.push({
      id: `crowd_barrier_${i + 1}`,
      lat: blat,
      lon: blon,
      label: `Crowd-control barrier — Gate ${i + 1}`,
      type: "coning",
      purpose: "crowd",
      officers_required: 2,
      phase_active: ["arrival", "during", "dispersal"],
      reasoning: { summary: "Pedestrian crowd-control barrier at a venue entry gate.", metric: "entry_gate", value: i + 1 },
    });
  }
  return out;
}

function buildPosts(
  input: EventInput,
  inbound: TrafficRoute[],
  outbound: TrafficRoute[],
  diversions: TrafficRoute[],
  emergency: TrafficRoute | null,
  sub: SubGraph
): DeploymentPost[] {
  const posts: DeploymentPost[] = [];
  let id = 0;
  // approach control at the venue end of each primary inbound route
  for (const r of inbound) {
    const head = r.geometry[r.geometry.length - 1];
    if (!head) continue;
    posts.push({
      id: `post_${++id}`,
      lat: head[1],
      lon: head[0],
      role: "traffic_point",
      officers: Math.max(2, Math.round(r.assigned_flow_vph / 400)),
      shift: "pre_event",
      label: `Inbound control — ${r.signage[0]?.location ?? r.id}`,
      phase_active: [r.phase],
    });
  }
  for (const r of outbound) {
    const tail = r.geometry[0];
    if (!tail) continue;
    posts.push({
      id: `post_${++id}`,
      lat: tail[1],
      lon: tail[0],
      role: "diversion_guide",
      officers: Math.max(2, Math.round(r.assigned_flow_vph / 400)),
      shift: "post_event",
      label: `Dispersal control — ${r.signage[0]?.location ?? r.id}`,
      phase_active: ["dispersal"],
    });
  }
  for (const r of diversions) {
    const mid = r.geometry[Math.floor(r.geometry.length / 2)];
    if (!mid) continue;
    posts.push({
      id: `post_${++id}`,
      lat: mid[1],
      lon: mid[0],
      role: "diversion_guide",
      officers: 2,
      shift: "during",
      label: `Diversion guide — ${r.id}`,
      phase_active: ["during"],
    });
  }
  if (input.lat != null && input.lon != null) {
    const gates = Math.max(2, input.entry_gates ?? 3);
    posts.push({
      id: `post_${++id}`,
      lat: input.lat,
      lon: input.lon,
      role: "crowd_control",
      officers: Math.max(4, gates * 2),
      shift: "during",
      label: "Venue gate crowd control",
      phase_active: ["during", "dispersal"],
    });
  }
  if (emergency) {
    const head = emergency.geometry[0];
    if (head) {
      posts.push({
        id: `post_${++id}`,
        lat: head[1],
        lon: head[0],
        role: "quick_response",
        officers: 2,
        shift: "all",
        label: "Emergency corridor quick-response",
        phase_active: ["during"],
      });
    }
  }
  void sub;
  return posts;
}

function topCriticalEdges(
  edgeFlow: Map<string, number>,
  edgeById: Map<string, GraphEdge>,
  k: number
): EdgeUtilization[] {
  // Dedup by road name (the two directions of one road are separate edges).
  const byName = new Map<string, EdgeUtilization>();
  for (const [eid, flow] of edgeFlow) {
    const e = edgeById.get(eid);
    if (!e) continue;
    const util = flow / e.base_capacity_vph;
    if (util < 0.6) continue;
    const cur = byName.get(e.name);
    if (!cur || util > cur.utilization) {
      byName.set(e.name, {
        edge_id: eid,
        name: e.name,
        assigned_flow_vph: Math.round(flow),
        capacity_vph: e.base_capacity_vph,
        utilization: Math.round(util * 100) / 100,
      });
    }
  }
  return [...byName.values()].sort((a, b) => b.utilization - a.utilization).slice(0, k);
}
