// Loads the full Bengaluru road network (export.geojson → sim_network_real.json)
// from the public folder at runtime. Constructs a SimNetwork from the data and
// injects it as the module-level singleton so any Engine built afterwards uses it.

import { SimNetwork, overrideNetwork } from "./network";

const REAL_NETWORK_URL = "/sim_network_real.json";

export const REAL_CBD_CENTER: [number, number] = [12.9882, 77.6105];

let initPromise: Promise<SimNetwork> | null = null;

export function initRealNetwork(): Promise<SimNetwork> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const resp = await fetch(REAL_NETWORK_URL);
    if (!resp.ok) throw new Error(`Failed to fetch real network: ${resp.status}`);
    const data = await resp.json();

    // SimNetwork reads from a hardcoded import in its constructor.
    // We build an equivalent instance by constructing a vanilla SimNetwork
    // (which will initialise from the bundled small network), then we
    // completely replace its internal state with the real data.
    const net = buildNetworkFrom(data);
    overrideNetwork(net);
    return net;
  })();
  return initPromise;
}

/** Construct a SimNetwork from raw sim_network JSON (no fetch, no singleton
 *  side-effect). Shared by the runtime loader above and dev harnesses that need
 *  to build a network from a JSON object directly (e.g. a CBD crop). */
export function buildNetworkFrom(data: { meta: { center: [number, number] }; nodes: RawNode[]; edges: RawEdge[] }): SimNetwork {
  const net = new SimNetwork();
  loadIntoNetwork(net, data);
  return net;
}

interface RawNode {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  signalized?: boolean;
  kind?: string;
  jid?: number;
}
interface RawEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  length_m: number;
  lanes: number;
  road_class: string;
  base_capacity_vph: number;
  allows_heavy_vehicle: boolean;
  geometry: number[][];
  synthetic?: boolean;
  kind?: string;
  level?: number;
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlam = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metersPerLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function loadIntoNetwork(net: SimNetwork, data: { meta: { center: [number,number] }; nodes: RawNode[]; edges: RawEdge[] }) {
  // Clear the default state
  net.nodes.clear();
  net.edges.length = 0;
  net.edgeMap.clear();
  net.outgoing.clear();
  net.incoming.clear();
  net.sources.length = 0;
  net.signalized.clear();
  net.syntheticEdges.clear();
  net.roundabouts.length = 0;
  net.junctionId.clear();
  net.edgeKind.clear();
  net.edgeLevel.clear();
  net.rivers.length = 0;

  // Expose the private runtime map through a cast (we need to populate it)
  const anyNet = net as unknown as {
    runtime: Map<string, {
      edge: typeof net.edges[0];
      centre: { lat: number; lon: number; cum: number }[];
      lengthM: number;
    }>;
    byFromTo: Map<string, string>;
    connectors: Map<string, unknown>;
  };
  anyNet.runtime.clear();
  anyNet.byFromTo.clear();
  anyNet.connectors.clear();

  // Load nodes
  for (const n of data.nodes) {
    net.nodes.set(n.id, { id: n.id, lat: n.lat, lon: n.lon, name: n.name });
    if (n.signalized) net.signalized.add(n.id);
    if (n.kind === "source") net.sources.push(n.id);
    if (n.jid != null) net.junctionId.set(n.id, n.jid);
  }

  // Load edges
  for (const raw of data.edges) {
    const centre: { lat: number; lon: number; cum: number }[] = [];
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
    const edge = {
      id: raw.id,
      from: raw.from,
      to: raw.to,
      name: raw.name,
      length_m: Math.round(lengthM),
      lanes: raw.lanes,
      road_class: raw.road_class as typeof net.edges[0]["road_class"],
      base_capacity_vph: raw.base_capacity_vph,
      allows_heavy_vehicle: raw.allows_heavy_vehicle,
      geometry: raw.geometry,
    };
    net.edges.push(edge);
    net.edgeMap.set(edge.id, edge);
    anyNet.runtime.set(edge.id, { edge, centre, lengthM });
    if (raw.synthetic) net.syntheticEdges.add(edge.id);
    if (raw.kind) net.edgeKind.set(edge.id, raw.kind);
    if (raw.level) net.edgeLevel.set(edge.id, raw.level);
  }

  // Build adjacency
  for (const e of net.edges) {
    if (!net.outgoing.has(e.from)) net.outgoing.set(e.from, []);
    net.outgoing.get(e.from)!.push(e);
    if (!net.incoming.has(e.to)) net.incoming.set(e.to, []);
    net.incoming.get(e.to)!.push(e);
    anyNet.byFromTo.set(`${e.from}__${e.to}`, e.id);
  }

  // Fallback sources if not flagged
  if (net.sources.length < 4) {
    const candidates = [...net.nodes.keys()].filter(
      (id) => (net.outgoing.get(id)?.length ?? 0) >= 1
    );
    net.sources.push(...candidates.slice(0, 40));
  }
}
