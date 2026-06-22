// Incremental BPR traffic assignment — the engine that decides HOW event traffic
// distributes across the real road network, with no hardcoded per-approach split.
//
// Formulation: a virtual super-source feeds zero-cost connectors to every
// candidate approach gateway, then total demand is assigned incrementally toward
// the venue. Early demand takes the cheapest approach; as edges load, the BPR
// cost rises and later increments spill onto other approaches — so the split
// across corridors EMERGES from the network (capacity + topology + live traffic),
// rather than being assumed. Outbound is the mirror (super-sink over gateways).
//
// Reuses bprCost from capacityModel.ts; runs on the heap Dijkstra in graphSearch.ts.

import type { GraphEdge } from "@/lib/roadGraph";
import { bprCost } from "@/lib/capacityModel";
import { shortestPath, type PathResult } from "@/lib/graphSearch";

const SRC = "__SRC__";
const SINK = "__SINK__";
const CONNECTOR = "__conn__";

export type AssignContext = {
  adjacency: Map<string, GraphEdge[]>;
  edgeById: Map<string, GraphEdge>;
  closed: Set<string>; // edges physically closed (cordon / requested closures)
  reserved: Set<string>; // edges reserved for the emergency corridor (excluded from public flow)
  liveMin: Map<string, number>; // optional live Mappls ETA per edge (overrides free-flow base)
};

export type ApproachAssignment = {
  gatewayId: string;
  assigned_flow_vph: number;
  share: number; // fraction of total demand
  path: PathResult; // representative loaded-network path gateway↔venue
  capacity_vph: number; // capacity of the first real edge out of the gateway
  utilization: number;
};

export type AssignResult = {
  edgeFlow: Map<string, number>;
  approaches: ApproachAssignment[];
  total_demand_vph: number;
};

const INCREMENTS = 12;
// Steeper congestion sensitivity than the display-ETA BPR, so demand spreads
// across multiple real approaches for resilience instead of piling onto one.
const ASSIGN_ALPHA = 0.9;
const ASSIGN_BETA = 4;

function connector(from: string, to: string): GraphEdge {
  return {
    id: `${CONNECTOR}${from}_${to}`,
    from,
    to,
    name: "connector",
    length_m: 0,
    lanes: 99,
    road_class: "arterial",
    base_capacity_vph: 1e9,
    allows_heavy_vehicle: true,
    geometry: [],
  };
}

function isConnector(id: string) {
  return id.startsWith(CONNECTOR);
}

/** Cost of an edge under current loading; reserved edges are excluded (Infinity). */
function makeCost(ctx: AssignContext, edgeFlow: Map<string, number>) {
  return (e: GraphEdge): number => {
    if (isConnector(e.id)) return 0;
    if (ctx.reserved.has(e.id)) return Infinity;
    return bprCost(e, edgeFlow.get(e.id) ?? 0, ctx.liveMin.get(e.id), ASSIGN_ALPHA, ASSIGN_BETA);
  };
}

/** Assign `totalDemand` from many gateways → venue (inbound) or venue → many
 *  gateways (outbound, set `outbound=true`), distributing flow endogenously. */
export function equilibriumAssign(
  ctx: AssignContext,
  venueId: string,
  gateways: string[],
  totalDemand: number,
  outbound = false
): AssignResult {
  // Build an augmented adjacency = real subgraph + virtual super node + connectors.
  const adj = new Map(ctx.adjacency); // shallow copy; we add the virtual node only
  const virtualNode = outbound ? SINK : SRC;
  const conns: GraphEdge[] = [];
  if (outbound) {
    // gateway → SINK connectors; assign venue → SINK
    for (const g of gateways) {
      const c = connector(g, SINK);
      conns.push(c);
      adj.set(g, [...(adj.get(g) ?? []), c]);
    }
  } else {
    // SRC → gateway connectors; assign SRC → venue
    adj.set(SRC, gateways.map((g) => connector(SRC, g)));
    conns.push(...adj.get(SRC)!);
  }
  for (const c of conns) ctx.edgeById.set(c.id, c);

  const startId = outbound ? venueId : SRC;
  const goalId = outbound ? SINK : venueId;

  const edgeFlow = new Map<string, number>();
  const gatewayFlow = new Map<string, number>();
  const per = totalDemand / INCREMENTS;
  let routedPaths: PathResult | null = null;

  for (let k = 0; k < INCREMENTS; k++) {
    const cost = makeCost(ctx, edgeFlow);
    const path = shortestPath(adj, startId, goalId, cost, ctx.closed);
    if (!path) break;
    routedPaths = path;
    // Which gateway did this increment use? It's the node adjacent to the virtual
    // node on the path (2nd node inbound, 2nd-last node outbound).
    const gw = outbound ? path.node_ids[path.node_ids.length - 2] : path.node_ids[1];
    if (gw) gatewayFlow.set(gw, (gatewayFlow.get(gw) ?? 0) + per);
    for (const eid of path.edge_ids) {
      if (isConnector(eid)) continue;
      edgeFlow.set(eid, (edgeFlow.get(eid) ?? 0) + per);
    }
  }
  void routedPaths;

  // Build a representative loaded-network route for each gateway that carries flow.
  const finalCost = makeCost(ctx, edgeFlow);
  const approaches: ApproachAssignment[] = [];
  for (const [gw, flow] of gatewayFlow) {
    if (flow < totalDemand * 0.02) continue; // drop negligible approaches
    const path = outbound
      ? shortestPath(ctx.adjacency, venueId, gw, finalCost, ctx.closed)
      : shortestPath(ctx.adjacency, gw, venueId, finalCost, ctx.closed);
    if (!path || !path.edge_ids.length) continue;
    const firstEdge = ctx.edgeById.get(path.edge_ids[0]);
    const cap = firstEdge?.base_capacity_vph ?? 1500;
    approaches.push({
      gatewayId: gw,
      assigned_flow_vph: Math.round(flow),
      share: flow / totalDemand,
      path,
      capacity_vph: cap,
      utilization: Math.round((flow / cap) * 100) / 100,
    });
  }
  approaches.sort((a, b) => b.assigned_flow_vph - a.assigned_flow_vph);

  // Clean up virtual connectors from the shared edge index.
  for (const c of conns) ctx.edgeById.delete(c.id);

  return { edgeFlow, approaches, total_demand_vph: totalDemand };
}
