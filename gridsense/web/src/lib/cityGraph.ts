// Real Bengaluru road network — runtime graph layer (SERVER-ONLY).
//
// Loads the OSM-derived artifact (web/src/data/blr_road_graph.json, ~15k nodes /
// 27k directed edges, built offline by ml/build_osm_graph.py) and provides the
// primitives the map-intelligence planner needs:
//   • a grid spatial index for fast nearest-node snapping,
//   • subgraph extraction within R metres of a venue,
//   • venue snapping onto the largest connected component of that subgraph,
//   • nearest-hospital lookup for the reserved emergency corridor.
//
// Do NOT import this from a client component — it pulls a multi-MB JSON.

import graphData from "@/data/blr_road_graph.json";
import type { GraphEdge, GraphNode } from "@/lib/roadGraph";

type Hospital = { id: string; name: string; lat: number; lon: number };
type CityGraph = {
  meta: Record<string, unknown>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hospitals: Hospital[];
};

const RAW = graphData as unknown as CityGraph;

// ---- Module-level indexes (built once) -------------------------------------
const nodeById = new Map<string, GraphNode>(RAW.nodes.map((n) => [n.id, n]));
const edgesFrom = new Map<string, GraphEdge[]>();
for (const e of RAW.edges) {
  let arr = edgesFrom.get(e.from);
  if (!arr) edgesFrom.set(e.from, (arr = []));
  arr.push(e);
}

// Grid spatial index: bucket nodes into ~500 m cells for nearest-node queries.
const CELL_DEG = 0.005;
const cellKey = (lat: number, lon: number) =>
  `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
const grid = new Map<string, GraphNode[]>();
for (const n of RAW.nodes) {
  const k = cellKey(n.lat, n.lon);
  let arr = grid.get(k);
  if (!arr) grid.set(k, (arr = []));
  arr.push(n);
}

export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest graph node to a point, searching the grid cell + an expanding ring. */
export function nearestNode(lat: number, lon: number): GraphNode | null {
  const cl = Math.floor(lat / CELL_DEG);
  const cc = Math.floor(lon / CELL_DEG);
  let best: GraphNode | null = null;
  let bestD = Infinity;
  for (let ring = 0; ring <= 6 && !best; ring++) {
    for (let i = cl - ring; i <= cl + ring; i++) {
      for (let j = cc - ring; j <= cc + ring; j++) {
        if (ring > 0 && i > cl - ring && i < cl + ring && j > cc - ring && j < cc + ring) continue;
        for (const n of grid.get(`${i}:${j}`) ?? []) {
          const d = metersBetween(lat, lon, n.lat, n.lon);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    if (best && ring >= 1) break;
  }
  return best;
}

/** All node ids within radiusM of (lat, lon) using the grid index. */
function nodesWithinRadius(lat: number, lon: number, radiusM: number): Set<string> {
  const within = new Set<string>();
  const ringCells = Math.ceil(radiusM / (CELL_DEG * 111320)) + 1;
  const cl = Math.floor(lat / CELL_DEG);
  const cc = Math.floor(lon / CELL_DEG);
  for (let i = cl - ringCells; i <= cl + ringCells; i++) {
    for (let j = cc - ringCells; j <= cc + ringCells; j++) {
      for (const n of grid.get(`${i}:${j}`) ?? []) {
        if (metersBetween(lat, lon, n.lat, n.lon) <= radiusM) within.add(n.id);
      }
    }
  }
  return within;
}

export type SubGraph = {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  edgeById: Map<string, GraphEdge>;
  adjacency: Map<string, GraphEdge[]>;
  /** venue node, snapped onto the largest connected component of the subgraph */
  venueNodeId: string;
};

/**
 * Extract the working subgraph within `radiusM` of (lat,lon). Keeps only edges
 * with both endpoints inside the radius, then snaps the venue to the nearest node
 * on the subgraph's largest (strongly-reachable) component so routing always has
 * a connected origin/destination.
 */
export function extractSubgraph(lat: number, lon: number, radiusM: number): SubGraph | null {
  const within = nodesWithinRadius(lat, lon, radiusM);
  if (within.size < 5) return null;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeById = new Map<string, GraphEdge>();
  const adjacency = new Map<string, GraphEdge[]>();
  for (const id of within) nodes.set(id, nodeById.get(id)!);
  for (const id of within) {
    for (const e of edgesFrom.get(id) ?? []) {
      if (!within.has(e.to)) continue;
      edges.push(e);
      edgeById.set(e.id, e);
      let arr = adjacency.get(e.from);
      if (!arr) adjacency.set(e.from, (arr = []));
      arr.push(e);
    }
  }
  if (!edges.length) return null;

  const venueSnap = nearestNode(lat, lon);
  const seedId = venueSnap && nodes.has(venueSnap.id) ? venueSnap.id : edges[0].from;
  const comp = reachableSet(adjacency, seedId);
  const usable = comp.size >= 5 ? comp : within;

  let venueNodeId = seedId;
  let bestD = Infinity;
  for (const id of usable) {
    const n = nodes.get(id)!;
    const d = metersBetween(lat, lon, n.lat, n.lon);
    if (d < bestD) {
      bestD = d;
      venueNodeId = id;
    }
  }

  return { nodes, edges, edgeById, adjacency, venueNodeId };
}

function reachableSet(adjacency: Map<string, GraphEdge[]>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const u = stack.pop()!;
    for (const e of adjacency.get(u) ?? []) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

export function nearestHospitals(lat: number, lon: number, k = 3): Array<Hospital & { distance_m: number }> {
  return RAW.hospitals
    .map((h) => ({ ...h, distance_m: Math.round(metersBetween(lat, lon, h.lat, h.lon)) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, k);
}

export function getCityMeta() {
  return RAW.meta;
}
