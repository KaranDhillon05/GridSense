// Venue-agnostic routing engine — REAL road geometry via OSRM.
//
// The synthetic road graph (road_graph.json) only covers a ~2 km box around
// Chinnaswamy Stadium, so graph-based routing yields EMPTY plans for any other
// venue. This module generates a complete, generalizable traffic plan for ANY
// lat/lon using a compass "gateway ring" (approach points on real bearings
// around the venue) and snaps every corridor to the actual road network with
// OSRM so the lines align precisely with the basemap.
//
// Produced deterministically for every event:
//   • primary / secondary inbound  (approach → venue, real roads)
//   • primary / secondary outbound (venue → dispersal gateway)
//   • through-diversion            (bypass routes routed AROUND the venue)
//   • emergency access             (shortest gateway → venue, never barricaded)
//   • contingency                  (OSRM alternate corridors)
//   • vehicle barricades           (hard closures on the real approach road)
//   • crowd-control barriers        (pedestrian barriers at venue gates)
//   • deployment posts             (traffic / crowd / diversion guides)
//
// If OSRM is unreachable, each route falls back to a smooth synthetic curve so
// the plan is always complete.

import type { EventInput } from "@/lib/gridsense";
import type { buildTripDemand } from "@/lib/tripDemand";
import type {
  AccessCorridor,
  BarricadePoint,
  DeploymentPost,
  TrafficRoute,
  TrafficRouteBundle,
} from "@/lib/types";
import { snapRoute, pointFromEnd, type SnappedRoute } from "@/lib/roadRouting";

type Demand = ReturnType<typeof buildTripDemand>;

const M_PER_DEG_LAT = 111_320;

function mPerDegLon(lat: number) {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Offset a [lat,lon] by a distance (m) along a compass bearing (deg, 0=N). */
function offset(lat: number, lon: number, distM: number, bearingDeg: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dNorth = distM * Math.cos(rad);
  const dEast = distM * Math.sin(rad);
  return [lat + dNorth / M_PER_DEG_LAT, lon + dEast / mPerDegLon(lat)];
}

/**
 * Synthetic fallback geometry: a gently curved road-like path from origin →
 * destination as [lon,lat] pairs, used only when OSRM is unreachable.
 */
function curvedPath(
  from: [number, number], // [lat, lon]
  to: [number, number],
  bowM = 0,
  steps = 6
): number[][] {
  const [lat1, lon1] = from;
  const [lat2, lon2] = to;
  const dLatM = (lat2 - lat1) * M_PER_DEG_LAT;
  const dLonM = (lon2 - lon1) * mPerDegLon(lat1);
  const len = Math.hypot(dLatM, dLonM) || 1;
  const perpLat = -dLonM / len;
  const perpLon = dLatM / len;
  const coords: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bow = bowM * Math.sin(Math.PI * t);
    const lat = lat1 + (lat2 - lat1) * t + (perpLat * bow) / M_PER_DEG_LAT;
    const lon = lon1 + (lon2 - lon1) * t + (perpLon * bow) / mPerDegLon(lat1);
    coords.push([lon, lat]);
  }
  return coords;
}

function haversineKm(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function pathKm(coords: number[][]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(
      [coords[i - 1][1], coords[i - 1][0]],
      [coords[i][1], coords[i][0]]
    );
  }
  return Math.round(km * 10) / 10;
}

const ATTENDANCE_RADIUS: Record<string, number> = {
  under_500: 350,
  between_500_2000: 500,
  between_2000_10000: 750,
  between_10000_50000: 1100,
  above_50000: 1500,
};

// Eight compass gateways. Capacity scales with arterial likelihood by direction.
const GATEWAYS: Array<{ key: string; name: string; bearing: number; capacity: number }> = [
  { key: "n", name: "North approach", bearing: 0, capacity: 2400 },
  { key: "ne", name: "North-East approach", bearing: 45, capacity: 1600 },
  { key: "e", name: "East approach", bearing: 90, capacity: 2200 },
  { key: "se", name: "South-East approach", bearing: 135, capacity: 1500 },
  { key: "s", name: "South approach", bearing: 180, capacity: 2400 },
  { key: "sw", name: "South-West approach", bearing: 225, capacity: 1600 },
  { key: "w", name: "West approach", bearing: 270, capacity: 2200 },
  { key: "nw", name: "North-West approach", bearing: 315, capacity: 1500 },
];

export type VenueRingPlan = {
  routes: TrafficRouteBundle;
  barricades: BarricadePoint[];
  posts: DeploymentPost[];
  corridors: AccessCorridor[];
  /** "osrm" if at least one route snapped to real roads, else "synthetic". */
  geometry_source: "osrm" | "synthetic";
};

const ROUND = (n: number) => Math.round(n);

/**
 * Generate a complete venue-centric traffic plan for any lat/lon, with route
 * geometry snapped to the real road network via OSRM.
 */
export async function buildVenueRingPlan(input: EventInput, demand: Demand): Promise<VenueRingPlan> {
  const lat = input.lat!;
  const lon = input.lon!;
  const venueRadiusM = ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"] ?? 750;
  const ringM = venueRadiusM + 1500; // gateways sit ~1.5 km beyond the cordon
  const isPeak = input.is_peak ?? false;
  const venueLL: [number, number] = [lon, lat]; // OSRM uses [lon,lat]
  const venue: [number, number] = [lat, lon];

  const gateways = GATEWAYS.map((g) => {
    const [glat, glon] = offset(lat, lon, ringM, g.bearing);
    const cap = ROUND(g.capacity * (isPeak ? 0.78 : 1));
    return { ...g, lat: glat, lon: glon, ll: [glon, glat] as [number, number], capacity: cap };
  });

  const byCap = [...gateways].sort((a, b) => b.capacity - a.capacity);
  const inboundGw = byCap.slice(0, 3);
  const outboundGw = byCap.slice(0, 3);

  const corridors: AccessCorridor[] = gateways.map((g, i) => ({
    id: `ring_${g.key}`,
    name: g.name,
    direction: i % 2 === 0 ? "inbound" : "outbound",
    gateway_node_ids: [`ring_node_${g.key}`],
    road_class: g.capacity >= 2200 ? "arterial" : "sub_arterial",
    base_capacity_vph: g.capacity,
    edge_ids: [],
  }));

  // Diversion gateway pairs (near-opposite) + the perpendicular bypass waypoint.
  const divPairs = [
    [0, 4], // N ↔ S
    [2, 6], // E ↔ W
  ];
  const divSpecs = divPairs.map(([a, b]) => {
    const ga = gateways[a];
    const gb = gateways[b];
    const sideBearing = (ga.bearing + 90) % 360;
    const wp = offset(lat, lon, ringM + 900, sideBearing); // [lat,lon]
    return { ga, gb, via: [wp[1], wp[0]] as [number, number] };
  });

  const emGw = byCap[0];

  // Lateral waypoint per inbound gateway → forces OSRM onto a parallel arterial,
  // guaranteeing a real-road contingency corridor even when no native alternative
  // exists. Point sits ~60% of the way in, swung 40° off the approach bearing.
  const inboundContingencyVia = inboundGw.map((g) => {
    const wp = offset(lat, lon, ringM * 0.62, (g.bearing + 40) % 360); // [lat,lon]
    return [wp[1], wp[0]] as [number, number]; // [lon,lat]
  });

  // ---- Fire all OSRM road-snapping calls in parallel ----
  const [inboundSnaps, inboundAltSnaps, outboundSnaps, divSnaps, emSnap] = await Promise.all([
    Promise.all(inboundGw.map((g) => snapRoute(g.ll, venueLL, { alternatives: 2 }))),
    Promise.all(inboundGw.map((g, i) => snapRoute(g.ll, venueLL, { via: inboundContingencyVia[i] }))),
    Promise.all(outboundGw.map((g) => snapRoute(venueLL, g.ll))),
    Promise.all(divSpecs.map((d) => snapRoute(d.ga.ll, d.gb.ll, { via: d.via }))),
    snapRoute(emGw.ll, venueLL),
  ]);

  let anySnapped = false;
  const markSnapped = (s: SnappedRoute[] | null) => {
    if (s && s.length) anySnapped = true;
    return s;
  };
  inboundSnaps.forEach(markSnapped);
  outboundSnaps.forEach(markSnapped);
  divSnaps.forEach(markSnapped);
  markSnapped(emSnap);

  const primary_inbound: TrafficRoute[] = [];
  const secondary_inbound: TrafficRoute[] = [];
  const primary_outbound: TrafficRoute[] = [];
  const secondary_outbound: TrafficRoute[] = [];
  const through_diversion: TrafficRoute[] = [];
  const emergency_access: TrafficRoute[] = [];
  const contingency: TrafficRoute[] = [];

  const totalInCap = inboundGw.reduce((s, g) => s + g.capacity, 0);
  const totalOutCap = outboundGw.reduce((s, g) => s + g.capacity, 0);
  const speedKmh = isPeak ? 18 : 26;
  const etaFromKm = (km: number, util: number) =>
    Math.round((km / speedKmh) * 60 * (1 + util * 0.4) * 10) / 10;
  // Real OSRM duration scaled for peak congestion.
  const etaFromOsrm = (durMin: number, util: number) =>
    Math.round(durMin * (isPeak ? 1.5 : 1.1) * (1 + util * 0.25) * 10) / 10;

  // ---- INBOUND (approach → venue) ----
  inboundGw.forEach((g, idx) => {
    const gw: [number, number] = [g.lat, g.lon];
    const flow = ROUND(demand.peak_arrival_vph * (g.capacity / totalInCap));
    const util = Math.min(1.4, flow / g.capacity);
    const snaps = inboundSnaps[idx];
    const primarySnap = snaps?.[0];
    const geom = primarySnap?.geometry ?? curvedPath(gw, venue, idx === 0 ? 120 : 220 * (idx % 2 ? 1 : -1));
    const km = primarySnap ? primarySnap.distance_km : pathKm(geom);
    const eta = primarySnap ? etaFromOsrm(primarySnap.duration_min, util) : etaFromKm(km, util);

    const route: TrafficRoute = {
      id: `in_primary_${idx + 1}`,
      phase: idx === 0 ? "arrival" : "pre_event",
      direction: "inbound",
      rank: idx + 1,
      geometry: geom,
      edge_ids: [],
      distance_km: km,
      free_flow_min: Math.round((km / speedKmh) * 60),
      expected_travel_min: eta,
      assigned_flow_vph: flow,
      capacity_vph: g.capacity,
      utilization: Math.round(util * 100) / 100,
      bottleneck_edges: [],
      control_points: [],
      signage: [
        {
          id: `sig_in_${idx}`,
          phase: "arrival",
          location: g.name,
          message: `Incoming traffic via ${g.name} → divert to event parking / bypass. ~${eta} min.`,
        },
      ],
      eta_source: primarySnap ? "osrm" : "synthetic",
      geometry_source: primarySnap ? "osrm" : "synthetic",
    };
    if (idx === 0) primary_inbound.push(route);
    else secondary_inbound.push(route);

    // Contingency = OSRM native alternate if it exists, else the lateral
    // waypoint detour (a genuinely different real road via a parallel arterial).
    const altSnap = snaps?.[1] ?? inboundAltSnaps[idx]?.[0];
    if (altSnap) {
      const altKm = altSnap.distance_km;
      contingency.push({
        id: `cont_in_${idx + 1}`,
        phase: "contingency",
        direction: "inbound",
        rank: idx + 1,
        geometry: altSnap.geometry,
        edge_ids: [],
        distance_km: altKm,
        free_flow_min: Math.round((altKm / speedKmh) * 60),
        expected_travel_min: etaFromOsrm(altSnap.duration_min, util * 0.6),
        assigned_flow_vph: ROUND(flow * 0.5),
        capacity_vph: g.capacity,
        utilization: Math.round(util * 0.6 * 100) / 100,
        bottleneck_edges: [],
        control_points: [],
        signage: [
          {
            id: `sig_cont_${idx}`,
            phase: "contingency",
            location: g.name,
            message: `Contingency reroute for ${g.name} — activate if primary jams.`,
          },
        ],
        eta_source: "osrm",
        geometry_source: "osrm",
      });
    }
  });

  // ---- OUTBOUND (venue → dispersal gateway) ----
  outboundGw.forEach((g, idx) => {
    const gw: [number, number] = [g.lat, g.lon];
    const flow = ROUND(demand.peak_departure_vph * (g.capacity / totalOutCap));
    const util = Math.min(1.5, flow / g.capacity);
    const snap = outboundSnaps[idx]?.[0];
    const geom = snap?.geometry ?? curvedPath(venue, gw, idx === 0 ? -120 : 200 * (idx % 2 ? -1 : 1));
    const km = snap ? snap.distance_km : pathKm(geom);
    const eta = snap ? etaFromOsrm(snap.duration_min, util) : etaFromKm(km, util);
    const route: TrafficRoute = {
      id: `out_primary_${idx + 1}`,
      phase: "dispersal",
      direction: "outbound",
      rank: idx + 1,
      geometry: geom,
      edge_ids: [],
      distance_km: km,
      free_flow_min: Math.round((km / speedKmh) * 60),
      expected_travel_min: eta,
      assigned_flow_vph: flow,
      capacity_vph: g.capacity,
      utilization: Math.round(util * 100) / 100,
      bottleneck_edges: [],
      control_points: [],
      signage: [
        {
          id: `sig_out_${idx}`,
          phase: "dispersal",
          location: g.name,
          message: `Event exit via ${g.name}. Staggered release to avoid lock-up.`,
        },
      ],
      eta_source: snap ? "osrm" : "synthetic",
      geometry_source: snap ? "osrm" : "synthetic",
    };
    if (idx < 2) primary_outbound.push(route);
    else secondary_outbound.push(route);
  });

  // ---- THROUGH-DIVERSION: bypass routes that arc AROUND the venue ----
  divSpecs.forEach((d, i) => {
    const snap = divSnaps[i]?.[0];
    const fallback = [
      ...curvedPath([d.ga.lat, d.ga.lon], [d.via[1], d.via[0]], 0, 4),
      ...curvedPath([d.via[1], d.via[0]], [d.gb.lat, d.gb.lon], 0, 4),
    ];
    const geom = snap?.geometry ?? fallback;
    const km = snap ? snap.distance_km : pathKm(geom);
    const flow = ROUND(demand.peak_arrival_vph * 0.35);
    const cap = 2400;
    const util = Math.min(1, flow / cap);
    through_diversion.push({
      id: `through_diversion_${i + 1}`,
      phase: "during",
      direction: "diversion",
      rank: i + 1,
      geometry: geom,
      edge_ids: [],
      distance_km: km,
      free_flow_min: Math.round((km / speedKmh) * 60),
      expected_travel_min: snap ? etaFromOsrm(snap.duration_min, util) : etaFromKm(km, util),
      assigned_flow_vph: flow,
      capacity_vph: cap,
      utilization: Math.round(util * 100) / 100,
      bottleneck_edges: [],
      control_points: [],
      signage: [
        {
          id: `sig_div_${i}`,
          phase: "during",
          location: `${d.ga.name} ⇆ ${d.gb.name}`,
          message: `THROUGH TRAFFIC: bypass event via ${d.ga.name}/${d.gb.name} ring — do not enter cordon.`,
        },
      ],
      eta_source: snap ? "osrm" : "synthetic",
      geometry_source: snap ? "osrm" : "synthetic",
    });
  });

  // ---- EMERGENCY ACCESS: shortest direct corridor, never barricaded ----
  const emGeom = emSnap?.[0]?.geometry ?? curvedPath([emGw.lat, emGw.lon], venue, 40, 5);
  const emKm = emSnap?.[0] ? emSnap[0].distance_km : pathKm(emGeom);
  emergency_access.push({
    id: "emergency_access_1",
    phase: "during",
    direction: "emergency",
    rank: 1,
    geometry: emGeom,
    edge_ids: [],
    distance_km: emKm,
    free_flow_min: Math.round((emKm / 40) * 60),
    expected_travel_min: emSnap?.[0]
      ? Math.round(emSnap[0].duration_min * 10) / 10
      : Math.round((emKm / 40) * 60 * 10) / 10,
    assigned_flow_vph: 60,
    capacity_vph: 600,
    utilization: 0.1,
    bottleneck_edges: [],
    control_points: [],
    signage: [
      {
        id: "sig_em_1",
        phase: "during",
        location: `${emGw.name} (reserved lane)`,
        message: "EMERGENCY LANE — keep clear at all times. No general traffic, no barricades.",
      },
    ],
    eta_source: emSnap?.[0] ? "osrm" : "synthetic",
    geometry_source: emSnap?.[0] ? "osrm" : "synthetic",
  });

  const routes: TrafficRouteBundle = {
    primary_inbound,
    secondary_inbound,
    primary_outbound,
    secondary_outbound,
    through_diversion,
    emergency_access,
    contingency,
  };

  const { barricades, posts } = buildRingControls(input, routes);

  return {
    routes,
    barricades,
    posts,
    corridors,
    geometry_source: anySnapped ? "osrm" : "synthetic",
  };
}

/**
 * Build vehicle barricades, crowd-control barriers and deployment posts from a
 * (road-snapped) route bundle. Barricades sit ON the real approach road ~300 m
 * before the cordon so the placement aligns with the map.
 */
export function buildRingControls(
  input: EventInput,
  routes: TrafficRouteBundle
): { barricades: BarricadePoint[]; posts: DeploymentPost[] } {
  const lat = input.lat!;
  const lon = input.lon!;
  const venueRadiusM = ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"] ?? 750;
  const barricades: BarricadePoint[] = [];
  const posts: DeploymentPost[] = [];
  let bId = 0;
  let pId = 0;

  // Hard vehicle barricades: close each inbound approach ~300 m before the
  // cordon (on the real road) so only event/credentialed traffic enters.
  [...routes.primary_inbound, ...routes.secondary_inbound].forEach((r) => {
    const pt = pointFromEnd(r.geometry, 300) ?? r.geometry[Math.max(0, r.geometry.length - 2)];
    if (!pt) return;
    barricades.push({
      id: `barricade_${++bId}`,
      lat: pt[1],
      lon: pt[0],
      label: `Hard barricade — block & divert ${r.signage[0]?.location ?? r.id}`,
      type: "hard",
      purpose: "vehicle",
      officers_required: 2,
      phase_active: ["pre_event", "during", "dispersal"],
    });
  });

  // Soft tapers / lane merges at diversion entry points.
  routes.through_diversion.forEach((r) => {
    const node = r.geometry[1] ?? r.geometry[0];
    if (!node) return;
    barricades.push({
      id: `barricade_${++bId}`,
      lat: node[1],
      lon: node[0],
      label: `Soft taper — diversion merge ${r.id}`,
      type: "soft",
      purpose: "vehicle",
      officers_required: 1,
      phase_active: ["during"],
    });
  });

  // Operator-requested road closures → hard barricades around the cordon.
  const closedRoads = input.roads_to_close ?? [];
  closedRoads.forEach((road, i) => {
    const bearing = (i * 360) / Math.max(1, closedRoads.length);
    const [blat, blon] = offset(lat, lon, venueRadiusM * 0.9, bearing);
    barricades.push({
      id: `barricade_${++bId}`,
      lat: blat,
      lon: blon,
      label: `Road closure — ${road.name}`,
      type: "hard",
      purpose: "vehicle",
      officers_required: 2,
      phase_active: ["pre_event", "during", "dispersal"],
    });
  });

  // Crowd-control barriers (pedestrian) at each entry gate.
  barricades.push(...buildCrowdBarriers(input));

  // Deployment posts.
  [...routes.primary_inbound, ...routes.primary_outbound].forEach((r) => {
    const head = r.direction === "inbound" ? r.geometry[0] : r.geometry[r.geometry.length - 1];
    if (!head) return;
    posts.push({
      id: `post_${++pId}`,
      lat: head[1],
      lon: head[0],
      role: r.direction === "outbound" ? "diversion_guide" : "traffic_point",
      officers: Math.max(2, ROUND(r.assigned_flow_vph / 400)),
      shift: r.direction === "outbound" ? "post_event" : "pre_event",
      label: `${r.direction} control — ${r.signage[0]?.location ?? r.id}`,
      phase_active: [r.phase],
    });
  });

  routes.through_diversion.forEach((r) => {
    const mid = r.geometry[Math.floor(r.geometry.length / 2)];
    if (!mid) return;
    posts.push({
      id: `post_${++pId}`,
      lat: mid[1],
      lon: mid[0],
      role: "diversion_guide",
      officers: 2,
      shift: "during",
      label: `Diversion guide — ${r.id}`,
      phase_active: ["during"],
    });
  });

  const gates = Math.max(2, input.entry_gates ?? 3);
  posts.push({
    id: `post_${++pId}`,
    lat,
    lon,
    role: "crowd_control",
    officers: Math.max(4, gates * 2),
    shift: "during",
    label: "Venue gate crowd control",
    phase_active: ["during", "dispersal"],
  });

  const emHead = routes.emergency_access[0]?.geometry[0];
  if (emHead) {
    posts.push({
      id: `post_${++pId}`,
      lat: emHead[1],
      lon: emHead[0],
      role: "quick_response",
      officers: 2,
      shift: "all",
      label: "Emergency lane quick-response",
      phase_active: ["during"],
    });
  }

  return { barricades, posts };
}

/**
 * Pedestrian crowd-control barriers at the venue perimeter — one set per entry
 * gate. Venue-centric, so it applies to BOTH the graph and ring engines.
 */
export function buildCrowdBarriers(input: EventInput): BarricadePoint[] {
  if (input.lat == null || input.lon == null) return [];
  const lat = input.lat;
  const lon = input.lon;
  const venueRadiusM = ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"] ?? 750;
  const gates = Math.max(2, input.entry_gates ?? 3);
  const out: BarricadePoint[] = [];
  for (let i = 0; i < gates; i++) {
    const bearing = (i * 360) / gates;
    const [blat, blon] = offset(lat, lon, venueRadiusM * 0.45, bearing);
    out.push({
      id: `crowd_barrier_${i + 1}`,
      lat: blat,
      lon: blon,
      label: `Crowd-control barrier — Gate ${i + 1}`,
      type: "coning",
      purpose: "crowd",
      officers_required: 2,
      phase_active: ["arrival", "during", "dispersal"],
    });
  }
  return out;
}

/** Count how many routes a bundle actually contains. */
export function bundleRouteCount(b: TrafficRouteBundle): number {
  return (
    b.primary_inbound.length +
    b.secondary_inbound.length +
    b.primary_outbound.length +
    b.secondary_outbound.length +
    b.through_diversion.length +
    b.emergency_access.length +
    b.contingency.length
  );
}
