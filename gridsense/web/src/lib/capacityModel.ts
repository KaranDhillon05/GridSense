import type { GraphEdge } from "@/lib/roadGraph";

export type EdgeUtilization = {
  edge_id: string;
  name: string;
  assigned_flow_vph: number;
  capacity_vph: number;
  utilization: number;
};

const FREE_FLOW_KMH: Record<string, number> = {
  arterial: 35,
  sub_arterial: 28,
  collector: 22,
  motorway: 55,
  local: 16,
};

/** Free-flow travel time (minutes) for an edge, by road class. */
export function freeFlowMin(edge: GraphEdge): number {
  const speedKmh = FREE_FLOW_KMH[edge.road_class] ?? 22;
  return (edge.length_m / 1000 / speedKmh) * 60;
}

export function edgeTravelMin(edge: GraphEdge, congestionFactor = 1): number {
  const speedKmh =
    edge.road_class === "arterial" ? 32 : edge.road_class === "collector" ? 24 : 18;
  const base = (edge.length_m / 1000 / speedKmh) * 60;
  return base * congestionFactor;
}

// BPR (Bureau of Public Roads) congestion function. Travel time grows with the
// volume/capacity ratio: t = t0 · (1 + α·(v/c)^β). This is the cost the
// equilibrium assignment minimizes. `liveMin`, when provided (real Mappls ETA),
// overrides the free-flow base so the optimization is live-traffic aware.
export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;

export function bprCost(
  edge: GraphEdge,
  assignedFlowVph: number,
  liveMin?: number,
  alpha: number = BPR_ALPHA,
  beta: number = BPR_BETA
): number {
  const t0 = liveMin != null && liveMin > 0 ? liveMin : freeFlowMin(edge);
  const vc = assignedFlowVph / Math.max(1, edge.base_capacity_vph);
  return t0 * (1 + alpha * Math.pow(vc, beta));
}

export function edgeCost(
  edge: GraphEdge,
  utilization: number,
  alpha: number,
  closed: boolean
): number {
  if (closed) return Infinity;
  const travel = edgeTravelMin(edge);
  return travel * (1 + alpha * utilization) + (edge.road_class === "local" ? 0.5 : 0);
}

export function assignFlowToEdges(
  edgeIds: string[],
  flowVph: number,
  edges: Map<string, GraphEdge>,
  state: Map<string, number>
): EdgeUtilization[] {
  const out: EdgeUtilization[] = [];
  for (const id of edgeIds) {
    const e = edges.get(id);
    if (!e) continue;
    const prev = state.get(id) ?? 0;
    const next = prev + flowVph;
    state.set(id, next);
    const util = Math.min(1.5, next / e.base_capacity_vph);
    out.push({
      edge_id: id,
      name: e.name,
      assigned_flow_vph: next,
      capacity_vph: e.base_capacity_vph,
      utilization: util,
    });
  }
  return out;
}

export function criticalEdges(state: Map<string, number>, edges: Map<string, GraphEdge>, threshold = 0.85) {
  const critical: EdgeUtilization[] = [];
  for (const [id, flow] of state) {
    const e = edges.get(id);
    if (!e) continue;
    const util = flow / e.base_capacity_vph;
    if (util >= threshold) {
      critical.push({
        edge_id: id,
        name: e.name,
        assigned_flow_vph: flow,
        capacity_vph: e.base_capacity_vph,
        utilization: util,
      });
    }
  }
  return critical.sort((a, b) => b.utilization - a.utilization);
}
