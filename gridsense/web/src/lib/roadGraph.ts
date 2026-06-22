import graphData from "@/data/road_graph.json";

export type GraphNode = {
  id: string;
  lat: number;
  lon: number;
  name?: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  name: string;
  length_m: number;
  lanes: number;
  road_class: "arterial" | "collector" | "local" | "motorway" | "sub_arterial";
  base_capacity_vph: number;
  allows_heavy_vehicle: boolean;
  geometry: number[][];
};

export type RoadGraph = {
  meta: { source: string; bbox: Record<string, number> };
  nodes: GraphNode[];
  edges: GraphEdge[];
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

const graph = graphData as RoadGraph;

const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
const edgesFrom = new Map<string, GraphEdge[]>();
const edgesTo = new Map<string, GraphEdge[]>();

for (const e of graph.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  edgesFrom.get(e.from)!.push(e);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesTo.get(e.to)!.push(e);
}

export function getRoadGraph(): RoadGraph {
  return graph;
}

export function getNode(id: string): GraphNode | undefined {
  return nodeById.get(id);
}

export function getOutgoingEdges(nodeId: string): GraphEdge[] {
  return edgesFrom.get(nodeId) ?? [];
}

export function getIncomingEdges(nodeId: string): GraphEdge[] {
  return edgesTo.get(nodeId) ?? [];
}

export function getEdge(id: string): GraphEdge | undefined {
  return graph.edges.find((e) => e.id === id);
}

export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function snapToNearestNode(lat: number, lon: number): GraphNode {
  let best = graph.nodes[0];
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = metersBetween(lat, lon, n.lat, n.lon);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function bearingToVenue(from: GraphNode, venue: GraphNode): number {
  const y = venue.lon - from.lon;
  const x = venue.lat - from.lat;
  return Math.atan2(y, x);
}

function edgeBearing(e: GraphEdge): number {
  const a = nodeById.get(e.from)!;
  const b = nodeById.get(e.to)!;
  return Math.atan2(b.lon - a.lon, b.lat - a.lat);
}

export function discoverAccessCorridors(
  lat: number,
  lon: number,
  radiusM: number
): AccessCorridor[] {
  const venue = snapToNearestNode(lat, lon);
  const gatewayEdges = graph.edges.filter((e) => {
    const n = nodeById.get(e.from)!;
    const d = metersBetween(n.lat, n.lon, venue.lat, venue.lon);
    return d <= radiusM && d > 80;
  });

  const byName = new Map<string, GraphEdge[]>();
  for (const e of gatewayEdges) {
    const key = e.name;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(e);
  }

  const corridors: AccessCorridor[] = [];
  for (const [name, edges] of byName) {
    const towardVenue = edges.filter((e) => {
      const from = nodeById.get(e.from)!;
      const to = nodeById.get(e.to)!;
      const dFrom = metersBetween(from.lat, from.lon, venue.lat, venue.lon);
      const dTo = metersBetween(to.lat, to.lon, venue.lat, venue.lon);
      return dTo < dFrom;
    });
    const awayVenue = edges.filter((e) => {
      const from = nodeById.get(e.from)!;
      const to = nodeById.get(e.to)!;
      const dFrom = metersBetween(from.lat, from.lon, venue.lat, venue.lon);
      const dTo = metersBetween(to.lat, to.lon, venue.lat, venue.lon);
      return dFrom < dTo;
    });

    const base = edges[0];
    const cap = Math.max(...edges.map((e) => e.base_capacity_vph));
    if (towardVenue.length) {
      corridors.push({
        id: `in_${name.toLowerCase().replace(/\s+/g, "_")}`,
        name,
        direction: "inbound",
        gateway_node_ids: [...new Set(towardVenue.map((e) => e.from))],
        road_class: base.road_class,
        base_capacity_vph: cap,
        edge_ids: towardVenue.map((e) => e.id),
      });
    }
    if (awayVenue.length) {
      corridors.push({
        id: `out_${name.toLowerCase().replace(/\s+/g, "_")}`,
        name,
        direction: "outbound",
        gateway_node_ids: [...new Set(awayVenue.map((e) => e.to))],
        road_class: base.road_class,
        base_capacity_vph: cap,
        edge_ids: awayVenue.map((e) => e.id),
      });
    }
    if (!towardVenue.length && !awayVenue.length) {
      corridors.push({
        id: `bi_${name.toLowerCase().replace(/\s+/g, "_")}`,
        name,
        direction: "bidirectional",
        gateway_node_ids: [...new Set(edges.map((e) => e.from))],
        road_class: base.road_class,
        base_capacity_vph: cap,
        edge_ids: edges.map((e) => e.id),
      });
    }
  }

  return corridors.sort((a, b) => b.base_capacity_vph - a.base_capacity_vph);
}

export function matchClosedEdges(roadNames: string[]): Set<string> {
  const closed = new Set<string>();
  const lower = roadNames.map((n) => n.toLowerCase());
  for (const e of graph.edges) {
    const name = e.name.toLowerCase();
    // Only close direct venue approach segments, not entire arterial corridors.
    if (
      lower.some(
        (n) =>
          (name.includes(n) || n.includes(name)) &&
          (name.includes("approach") || name.includes("stadium") || name.includes("link"))
      )
    ) {
      closed.add(e.id);
    }
  }
  return closed;
}

export function edgeGeometry(edgeIds: string[]): number[][] {
  const coords: number[][] = [];
  for (const id of edgeIds) {
    const e = getEdge(id);
    if (!e) continue;
    for (const c of e.geometry) {
      const prev = coords[coords.length - 1];
      if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) coords.push(c);
    }
  }
  return coords;
}

export function pathDistanceKm(edgeIds: string[]): number {
  return edgeIds.reduce((s, id) => s + (getEdge(id)?.length_m ?? 0), 0) / 1000;
}

export { bearingToVenue, edgeBearing };
