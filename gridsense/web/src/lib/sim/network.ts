// Builds the runtime simulation network from the real-geometry CBD extract
// (web/src/data/sim_network.json, carved from the OSM road graph). Each edge
// carries its full polyline geometry; vehicles interpolate along that polyline
// (centreAt/laneAt), so roads overlay the basemap and follow real curves and
// roundabouts. Reuses GraphNode/GraphEdge so pathfinding.ts / capacityModel.ts
// work unchanged. Directionality (one-ways) is already encoded in the data.

import type { GraphEdge, GraphNode } from "@/lib/roadGraph";
import { metersBetween } from "@/lib/roadGraph";
import simNetwork from "@/data/sim_network.json";

const LANE_WIDTH_M = 3.4;
const CENTRE_GAP_M = 1.2; // gap between the centreline and the first lane centre

export type LatLonHeading = { lat: number; lon: number; heading: number };

type CentrePoint = { lat: number; lon: number; cum: number };

interface RawNode {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  signalized?: boolean;
  kind?: string;
  jid?: number; // sequential junction label for debug numbering
}
interface RawEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  length_m: number;
  lanes: number;
  road_class: GraphEdge["road_class"];
  base_capacity_vph: number;
  allows_heavy_vehicle: boolean;
  geometry: number[][];
  synthetic?: boolean;
  kind?: string; // "flyover" | "bridge" | "uturn" | "roundabout"
  level?: number; // 0 ground, 1 elevated
}
interface RawRoundabout {
  center: [number, number]; // [lat, lon]
  radius_m: number;
  node_count: number;
}
interface RawNet {
  meta: { center: [number, number]; roundabouts?: RawRoundabout[]; rivers?: number[][][] };
  nodes: RawNode[];
  edges: RawEdge[];
}

const DATA = simNetwork as unknown as RawNet;
export const CBD_CENTER: [number, number] = DATA.meta.center;

interface EdgeRuntime {
  edge: GraphEdge;
  centre: CentrePoint[]; // densified centreline with cumulative metres
  lengthM: number;
}

interface Connector {
  points: { lat: number; lon: number; cum: number }[];
  lengthM: number;
}

function metersPerLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export interface Roundabout {
  center: { lat: number; lon: number };
  radius_m: number;
}

export class SimNetwork {
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];
  edgeMap = new Map<string, GraphEdge>();
  outgoing = new Map<string, GraphEdge[]>();
  incoming = new Map<string, GraphEdge[]>();
  sources: string[] = [];
  signalized = new Set<string>();
  syntheticEdges = new Set<string>();
  roundabouts: Roundabout[] = [];
  junctionId = new Map<string, number>(); // nodeId → sequential label number
  edgeKind = new Map<string, string>(); // edgeId → "flyover"|"bridge"|"uturn"|"roundabout"
  edgeLevel = new Map<string, number>(); // edgeId → 0 ground, 1 elevated
  rivers: { lat: number; lon: number }[][] = [];

  private runtime = new Map<string, EdgeRuntime>();
  private connectors = new Map<string, Connector>();
  private byFromTo = new Map<string, string>(); // "from__to" -> edge id

  constructor() {
    for (const n of DATA.nodes) {
      this.nodes.set(n.id, { id: n.id, lat: n.lat, lon: n.lon, name: n.name });
      if (n.signalized) this.signalized.add(n.id);
      if (n.kind === "source") this.sources.push(n.id);
      if (n.jid != null) this.junctionId.set(n.id, n.jid);
    }
    for (const raw of DATA.edges) this.addEdge(raw);
    for (const rb of DATA.meta.roundabouts ?? []) {
      this.roundabouts.push({ center: { lat: rb.center[0], lon: rb.center[1] }, radius_m: rb.radius_m });
    }
    for (const riv of DATA.meta.rivers ?? []) {
      this.rivers.push(riv.map(([lon, lat]) => ({ lat, lon })));
    }
    for (const e of this.edges) {
      if (!this.outgoing.has(e.from)) this.outgoing.set(e.from, []);
      this.outgoing.get(e.from)!.push(e);
      if (!this.incoming.has(e.to)) this.incoming.set(e.to, []);
      this.incoming.get(e.to)!.push(e);
      this.byFromTo.set(`${e.from}__${e.to}`, e.id);
    }
    // fallback if the extract somehow lacks source flags
    if (this.sources.length < 4) {
      this.sources = [...this.nodes.keys()].filter(
        (id) => (this.outgoing.get(id)?.length ?? 0) >= 1
      ).slice(0, 16);
    }
  }

  private addEdge(raw: RawEdge) {
    const centre: CentrePoint[] = [];
    let cum = 0;
    for (let i = 0; i < raw.geometry.length; i++) {
      const [lon, lat] = raw.geometry[i];
      if (i > 0) {
        const [plon, plat] = raw.geometry[i - 1];
        cum += metersBetween(plat, plon, lat, lon);
      }
      centre.push({ lat, lon, cum });
    }
    const lengthM = Math.max(cum, raw.length_m || 0, 8);
    const edge: GraphEdge = {
      id: raw.id,
      from: raw.from,
      to: raw.to,
      name: raw.name,
      length_m: Math.round(lengthM),
      lanes: raw.lanes,
      road_class: raw.road_class,
      base_capacity_vph: raw.base_capacity_vph,
      allows_heavy_vehicle: raw.allows_heavy_vehicle,
      geometry: raw.geometry,
    };
    this.edges.push(edge);
    this.edgeMap.set(edge.id, edge);
    this.runtime.set(edge.id, { edge, centre, lengthM });
    if (raw.synthetic) this.syntheticEdges.add(edge.id);
    if (raw.kind) this.edgeKind.set(edge.id, raw.kind);
    if (raw.level) this.edgeLevel.set(edge.id, raw.level);
  }

  edge(id: string): GraphEdge | undefined {
    return this.edgeMap.get(id);
  }

  /** Edge id of the opposite direction of the same physical road, if any. */
  reverseId(edgeId: string): string | undefined {
    const e = this.edgeMap.get(edgeId);
    if (!e) return undefined;
    return this.byFromTo.get(`${e.to}__${e.from}`);
  }

  edgeLength(id: string): number {
    return this.runtime.get(id)?.lengthM ?? 100;
  }

  laneCount(id: string): number {
    return this.edgeMap.get(id)?.lanes ?? 1;
  }

  /** Centreline point + heading at distance d (metres) along an edge. */
  centreAt(id: string, d: number): LatLonHeading {
    const rt = this.runtime.get(id)!;
    const pts = rt.centre;
    // clamp to the geometry's actual cumulative length (not lengthM, which may be
    // rounded slightly larger) and keep p0/p1 as two distinct points so the
    // heading is always taken from a real segment — even exactly at the edge end.
    const total = pts[pts.length - 1].cum;
    const dist = Math.max(0, Math.min(d, total));
    let i = 1;
    while (i < pts.length - 1 && pts[i].cum < dist) i++;
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const seg = Math.max(1e-6, p1.cum - p0.cum);
    const t = Math.max(0, Math.min(1, (dist - p0.cum) / seg));
    const lat = p0.lat + (p1.lat - p0.lat) * t;
    const lon = p0.lon + (p1.lon - p0.lon) * t;
    const heading = Math.atan2(
      (p1.lat - p0.lat) * 111320,
      (p1.lon - p0.lon) * metersPerLon(lat)
    );
    return { lat, lon, heading };
  }

  /** Lane-offset point (left-hand traffic: travel lanes offset to the left). */
  laneAt(id: string, lane: number, d: number): LatLonHeading {
    const c = this.centreAt(id, d);
    const offset = CENTRE_GAP_M + (lane + 0.5) * LANE_WIDTH_M;
    // left normal of heading vector (east=lon, north=lat), CCW 90°
    const nx = -Math.sin(c.heading); // east component of left normal
    const ny = Math.cos(c.heading); // north component of left normal
    const dLat = (ny * offset) / 111320;
    const dLon = (nx * offset) / metersPerLon(c.lat);
    return { lat: c.lat + dLat, lon: c.lon + dLon, heading: c.heading };
  }

  /** Cached turn connector from the end of one edge to the start of the next. */
  connector(fromEdge: string, fromLane: number, toEdge: string, toLane: number): Connector {
    const key = `${fromEdge}:${fromLane}>${toEdge}:${toLane}`;
    const cached = this.connectors.get(key);
    if (cached) return cached;

    const start = this.laneAt(fromEdge, fromLane, this.edgeLength(fromEdge));
    const end = this.laneAt(toEdge, toLane, 0);
    const dist = metersBetween(start.lat, start.lon, end.lat, end.lon);

    // Straight-through movement: the lane-offset endpoints are (nearly) identical
    // because both segments share the same heading at the junction node. A bezier
    // with non-zero handles on a zero-distance path creates a figure-8 loop that
    // makes vehicles visually swirl. Use a trivial 2-point connector instead.
    if (dist < 2.5) {
      const pts = [
        { lat: start.lat, lon: start.lon, cum: 0 },
        { lat: end.lat, lon: end.lon, cum: Math.max(0.5, dist) },
      ];
      const connector: Connector = { points: pts, lengthM: Math.max(0.5, dist) };
      this.connectors.set(key, connector);
      return connector;
    }

    // control handles extend along each edge's heading for a smooth bezier
    const handle = Math.max(
      6,
      dist * 0.4
    );
    const c1lat = start.lat + (Math.sin(start.heading) * handle) / 111320;
    const c1lon = start.lon + (Math.cos(start.heading) * handle) / metersPerLon(start.lat);
    const c2lat = end.lat - (Math.sin(end.heading) * handle) / 111320;
    const c2lon = end.lon - (Math.cos(end.heading) * handle) / metersPerLon(end.lat);

    const pts: { lat: number; lon: number; cum: number }[] = [];
    let cum = 0;
    const N = 8;
    let prev: { lat: number; lon: number } | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const mt = 1 - t;
      const lat =
        mt * mt * mt * start.lat +
        3 * mt * mt * t * c1lat +
        3 * mt * t * t * c2lat +
        t * t * t * end.lat;
      const lon =
        mt * mt * mt * start.lon +
        3 * mt * mt * t * c1lon +
        3 * mt * t * t * c2lon +
        t * t * t * end.lon;
      if (prev) cum += metersBetween(prev.lat, prev.lon, lat, lon);
      pts.push({ lat, lon, cum });
      prev = { lat, lon };
    }
    const connector: Connector = { points: pts, lengthM: Math.max(cum, 3) };
    this.connectors.set(key, connector);
    return connector;
  }

  connectorAt(conn: Connector, d: number): LatLonHeading {
    const dist = Math.max(0, Math.min(d, conn.lengthM));
    let i = 1;
    while (i < conn.points.length && conn.points[i].cum < dist) i++;
    const p0 = conn.points[i - 1];
    const p1 = conn.points[Math.min(i, conn.points.length - 1)];
    const seg = Math.max(1e-6, p1.cum - p0.cum);
    const t = Math.max(0, Math.min(1, (dist - p0.cum) / seg));
    const lat = p0.lat + (p1.lat - p0.lat) * t;
    const lon = p0.lon + (p1.lon - p0.lon) * t;
    const heading = Math.atan2(
      (p1.lat - p0.lat) * 111320,
      (p1.lon - p0.lon) * metersPerLon(lat)
    );
    return { lat, lon, heading };
  }

  /** Snap a clicked lat/lon to the nearest edge + distance along it. */
  snapToEdge(lat: number, lon: number): { edgeId: string; distOnEdge: number; lat: number; lon: number } | null {
    let best: { edgeId: string; distOnEdge: number; lat: number; lon: number } | null = null;
    let bestD = Infinity;
    for (const rt of this.runtime.values()) {
      const len = rt.lengthM;
      const step = Math.max(8, len / 12);
      for (let d = 0; d <= len; d += step) {
        const p = this.centreAt(rt.edge.id, d);
        const dist = metersBetween(lat, lon, p.lat, p.lon);
        if (dist < bestD) {
          bestD = dist;
          best = { edgeId: rt.edge.id, distOnEdge: d, lat: p.lat, lon: p.lon };
        }
      }
    }
    return best; // nearest edge to the click
  }

  /** All edges leaving the downstream node of `edgeId` (valid next moves). */
  nextEdges(edgeId: string): GraphEdge[] {
    const e = this.edgeMap.get(edgeId);
    if (!e) return [];
    // exclude immediate U-turn back along the same physical link unless it's the
    // only option (dead-end), so vehicles don't bounce.
    const outs = this.outgoing.get(e.to) ?? [];
    const nonU = outs.filter((o) => o.to !== e.from);
    return nonU.length ? nonU : outs;
  }
}

let cached: SimNetwork | null = null;
export function getNetwork(): SimNetwork {
  if (!cached) cached = new SimNetwork();
  return cached;
}

/** Inject an externally-built network (e.g. from a fetched GeoJSON). The next
 *  Engine constructed in this module context will use it instead of the default. */
export function overrideNetwork(net: SimNetwork): void {
  cached = net;
}
