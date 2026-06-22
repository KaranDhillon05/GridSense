// Graph pathfinding: heap-based Dijkstra / A* and Yen's k-shortest paths.
// Used by the simulation (routing.ts) and legacy callers. For large subgraphs
// the planner uses graphSearch.ts directly; both share the same heap core.

import type { GraphEdge, GraphNode } from "@/lib/roadGraph";
import { edgeCost, edgeTravelMin } from "@/lib/capacityModel";

export type PathResult = {
  node_ids: string[];
  edge_ids: string[];
  cost: number;
  travel_min: number;
};

// ---- min-heap (shared by all search variants) --------------------------------

class MinHeap {
  private a: Array<{ id: string; key: number }> = [];
  get size() {
    return this.a.length;
  }
  push(id: string, key: number) {
    const a = this.a;
    a.push({ id, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { id: string; key: number } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l].key < a[s].key) s = l;
        if (r < a.length && a[r].key < a[s].key) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

function heuristic(a: GraphNode, b: GraphNode): number {
  const dx = (b.lon - a.lon) * 111320 * 0.85;
  const dy = (b.lat - a.lat) * 111320;
  return (dx * dx + dy * dy) ** 0.5 / 500;
}

function reconstruct(
  startId: string,
  goalId: string,
  prev: Map<string, { nodeId: string; edgeId: string }>,
  cost: number,
  edgeById: Map<string, GraphEdge>
): PathResult {
  const edgeIds: string[] = [];
  const nodeIds = [goalId];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (!p) break;
    edgeIds.unshift(p.edgeId);
    cur = p.nodeId;
    nodeIds.unshift(cur);
  }
  const travel = edgeIds.reduce((s, id) => {
    const e = edgeById.get(id);
    return s + (e ? edgeTravelMin(e) : 0);
  }, 0);
  return { node_ids: nodeIds, edge_ids: edgeIds, cost, travel_min: travel };
}

export type SearchContext = {
  adjacency: Map<string, GraphEdge[]>;
  nodes: Map<string, GraphNode>;
  edgeById: Map<string, GraphEdge>;
};

/** Build a reusable search context from a flat edge list. */
export function buildSearchContext(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[]
): SearchContext {
  const adjacency = new Map<string, GraphEdge[]>();
  const edgeById = new Map<string, GraphEdge>();
  for (const e of edges) {
    edgeById.set(e.id, e);
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }
  return { adjacency, nodes, edgeById };
}

type EdgeCostFn = (edge: GraphEdge) => number;

function heapSearch(
  ctx: SearchContext,
  startId: string,
  goalId: string,
  edgeCostFn: EdgeCostFn,
  closedEdges: Set<string>,
  h?: (nodeId: string) => number
): PathResult | null {
  if (startId === goalId) {
    return { node_ids: [startId], edge_ids: [], cost: 0, travel_min: 0 };
  }
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, { nodeId: string; edgeId: string }>();
  const done = new Set<string>();
  const heap = new MinHeap();
  heap.push(startId, h ? h(startId) : 0);

  while (heap.size) {
    const { id: u, key } = heap.pop()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === goalId) break;
    const g = dist.get(u) ?? Infinity;
    if (h && key > g + h(u)) continue;

    for (const e of ctx.adjacency.get(u) ?? []) {
      if (closedEdges.has(e.id)) continue;
      const c = edgeCostFn(e);
      if (!Number.isFinite(c)) continue;
      const alt = g + c;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, { nodeId: u, edgeId: e.id });
        heap.push(e.to, h ? alt + h(e.to) : alt);
      }
    }
  }

  if (!prev.has(goalId)) return null;
  return reconstruct(startId, goalId, prev, dist.get(goalId) ?? Infinity, ctx.edgeById);
}

export function dijkstraWithContext(
  ctx: SearchContext,
  startId: string,
  goalId: string,
  closedEdges: Set<string>
): PathResult | null {
  return heapSearch(ctx, startId, goalId, (e) => edgeTravelMin(e), closedEdges);
}

export function aStarWithContext(
  ctx: SearchContext,
  startId: string,
  goalId: string,
  closedEdges: Set<string>,
  utilization: Map<string, number>,
  alpha: number
): PathResult | null {
  const goal = ctx.nodes.get(goalId);
  if (!goal) return null;
  const h = (id: string) => {
    const n = ctx.nodes.get(id);
    return n ? heuristic(n, goal) : 0;
  };
  return heapSearch(
    ctx,
    startId,
    goalId,
    (e) => edgeCost(e, utilization.get(e.id) ?? 0, alpha, closedEdges.has(e.id)),
    closedEdges,
    h
  );
}

// Legacy API — builds context on each call (prefer WithContext + cached ctx).
export function dijkstra(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  startId: string,
  goalId: string,
  closedEdges: Set<string>
): PathResult | null {
  return dijkstraWithContext(buildSearchContext(nodes, edges), startId, goalId, closedEdges);
}

export function aStar(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  startId: string,
  goalId: string,
  closedEdges: Set<string>,
  utilization: Map<string, number>,
  alpha: number
): PathResult | null {
  return aStarWithContext(
    buildSearchContext(nodes, edges),
    startId,
    goalId,
    closedEdges,
    utilization,
    alpha
  );
}

/** Yen's algorithm — k genuinely distinct shortest paths. */
export function kShortestPaths(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  startId: string,
  goalId: string,
  closedEdges: Set<string>,
  k: number,
  utilization?: Map<string, number>,
  alpha = 0.9
): PathResult[] {
  const ctx = buildSearchContext(nodes, edges);
  const search = utilization
    ? (s: string, g: string, closed: Set<string>) =>
        aStarWithContext(ctx, s, g, closed, utilization, alpha)
    : (s: string, g: string, closed: Set<string>) => dijkstraWithContext(ctx, s, g, closed);

  const first = search(startId, goalId, closedEdges);
  if (!first) return [];

  const results: PathResult[] = [first];
  const candidates: PathResult[] = [];

  for (let ki = 1; ki < k; ki++) {
    const prev = results[ki - 1];
    for (let i = 0; i < prev.node_ids.length - 1; i++) {
      const spurNode = prev.node_ids[i];
      const rootPath = prev.edge_ids.slice(0, i);
      const rootNodes = prev.node_ids.slice(0, i + 1);

      const bannedEdges = new Set(closedEdges);
      const bannedNodes = new Set<string>();

      for (const r of results) {
        if (r.edge_ids.length > i && r.edge_ids.slice(0, i).join("|") === rootPath.join("|")) {
          bannedEdges.add(r.edge_ids[i]);
        }
      }
      for (let j = 0; j < i; j++) {
        if (j < rootNodes.length - 1) bannedNodes.add(rootNodes[j]);
      }

      // Temporarily ban spur-node edges that share the same root prefix
      const spurClosed = new Set(bannedEdges);
      for (const [nodeId, adj] of ctx.adjacency) {
        if (bannedNodes.has(nodeId)) {
          for (const e of adj) spurClosed.add(e.id);
        }
      }

      const spur = search(spurNode, goalId, spurClosed);
      if (!spur) continue;

      const combinedEdges = [...rootPath, ...spur.edge_ids];
      const combinedNodes = [...rootNodes.slice(0, -1), ...spur.node_ids];
      const key = combinedEdges.join("|");
      if (results.some((r) => r.edge_ids.join("|") === key)) continue;
      if (candidates.some((c) => c.edge_ids.join("|") === key)) continue;

      const cost = combinedEdges.reduce((s, id) => {
        const e = ctx.edgeById.get(id);
        if (!e) return s;
        return (
          s +
          (utilization
            ? edgeCost(e, utilization.get(id) ?? 0, alpha, false)
            : edgeTravelMin(e))
        );
      }, 0);
      const travel = combinedEdges.reduce(
        (s, id) => s + (ctx.edgeById.get(id) ? edgeTravelMin(ctx.edgeById.get(id)!) : 0),
        0
      );
      candidates.push({
        node_ids: combinedNodes,
        edge_ids: combinedEdges,
        cost,
        travel_min: travel,
      });
    }

    if (!candidates.length) break;
    candidates.sort((a, b) => a.cost - b.cost);
    results.push(candidates.shift()!);
  }

  return results;
}
