// Heap-based shortest-path search for the real city subgraph.
//
// The simulation uses the heap core in pathfinding.ts (233-node CBD graph).
// The map-intelligence planner runs many shortest-path queries over a
// few-thousand-node subgraph (equilibrium assignment loop), so this module
// provides a binary-heap Dijkstra with a pluggable edge-cost function and a
// dynamic closed-edge set.

import type { GraphEdge, GraphNode } from "@/lib/roadGraph";

export type PathResult = {
  node_ids: string[];
  edge_ids: string[];
  cost: number; // sum of the cost function along the path
};

// Min-heap keyed by number.
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

export type CostFn = (edge: GraphEdge) => number;

/**
 * Dijkstra with a pluggable cost function and closed-edge set.
 * `cost(edge)` returns the edge's traversal cost (minutes). Closed edges and
 * non-finite costs are skipped.
 */
export function shortestPath(
  adjacency: Map<string, GraphEdge[]>,
  startId: string,
  goalId: string,
  cost: CostFn,
  closed?: Set<string>
): PathResult | null {
  if (startId === goalId) return { node_ids: [startId], edge_ids: [], cost: 0 };
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, { nodeId: string; edgeId: string }>();
  const done = new Set<string>();
  const heap = new MinHeap();
  heap.push(startId, 0);

  while (heap.size) {
    const { id: u, key } = heap.pop()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === goalId) break;
    if (key > (dist.get(u) ?? Infinity)) continue;
    for (const e of adjacency.get(u) ?? []) {
      if (closed?.has(e.id)) continue;
      const c = cost(e);
      if (!Number.isFinite(c)) continue;
      const alt = (dist.get(u) ?? Infinity) + c;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, { nodeId: u, edgeId: e.id });
        heap.push(e.to, alt);
      }
    }
  }

  if (!prev.has(goalId)) return null;
  const node_ids = [goalId];
  const edge_ids: string[] = [];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (!p) break;
    edge_ids.unshift(p.edgeId);
    cur = p.nodeId;
    node_ids.unshift(cur);
  }
  return { node_ids, edge_ids, cost: dist.get(goalId) ?? Infinity };
}

/** Concatenate edge geometries into a single [lon,lat][] polyline (dedup joins). */
export function pathGeometry(edgeIds: string[], edgeById: Map<string, GraphEdge>): number[][] {
  const out: number[][] = [];
  for (const id of edgeIds) {
    const e = edgeById.get(id);
    if (!e) continue;
    for (const c of e.geometry) {
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
    }
  }
  return out;
}

export function pathLengthKm(edgeIds: string[], edgeById: Map<string, GraphEdge>): number {
  let m = 0;
  for (const id of edgeIds) m += edgeById.get(id)?.length_m ?? 0;
  return m / 1000;
}

export function nodePoint(nodes: Map<string, GraphNode>, id: string): [number, number] | null {
  const n = nodes.get(id);
  return n ? [n.lon, n.lat] : null;
}
