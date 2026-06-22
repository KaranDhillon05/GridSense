// GridSense core logic (TypeScript port of ml/scoring.py + ml/recommend.py).
// Reads precomputed artifacts so the deployed app is fully self-contained on
// Vercel — no Python runtime needed at request time. The duration estimate
// comes from a model-derived lookup table (ml/duration_lookup.json).

import aggregates from "@/data/aggregates.json";
import durationLookup from "@/data/duration_lookup.json";
import correctionFactors from "@/data/correction_factors.json";

export type EventInput = {
  event_name?: string;
  event_type?: string;
  attendance_band?:
    | "under_500"
    | "between_500_2000"
    | "between_2000_10000"
    | "between_10000_50000"
    | "above_50000";
  expected_attendance?: number;
  start_hour?: number;
  end_hour?: number;
  entry_gates?: number;
  parking_required?: boolean;
  heavy_vehicle_restriction?: boolean;
  public_transport_involved?: boolean;
  roads_to_close?: Array<{ id: string; name: string }>;
  cause: string;
  corridor: string;
  priority?: string;
  requires_road_closure?: boolean;
  is_planned?: boolean;
  is_peak?: boolean;
  affected_junctions?: number;
  lat?: number;
  lon?: number;
  // Extra context used by the playbook generator (not by scoring).
  zone?: string;
  junction?: string;
  veh_type?: string;
  hour?: number;
  dow?: number;
  is_weekend?: boolean;
};

export type DiversionRoutingContext = {
  lat: number;
  lon: number;
  requires_road_closure?: boolean;
  is_peak?: boolean;
  veh_type?: string;
};

const WEIGHTS = {
  duration: 0.34,
  closure: 0.22,
  cause: 0.16,
  location: 0.16,
  timing: 0.12,
} as const;

const DURATION_SATURATION_MIN = 720;

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function tierFor(score: number): string {
  if (score >= 70) return "Severe";
  if (score >= 50) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

// Post-event-learning correction (closes the loop): a per-segment multiplier
// learned on resolved events (ml/learn.py) and validated out-of-sample, applied
// on top of the model lookup so the live forecast self-corrects toward reality.
// See /learning for the before/after evidence.
export function correctionFor(cause: string, corridor: string): number {
  const cf = correctionFactors as {
    by_cause: Record<string, number>;
    by_cause_corridor: Record<string, Record<string, number>>;
  };
  return cf.by_cause_corridor[cause]?.[corridor] ?? cf.by_cause[cause] ?? 1;
}

// Base (uncalibrated) lookup duration. The lookup table is generated from the
// trained sklearn model for every (cause, corridor, closure, peak) combo.
function lookupDuration(inp: EventInput): number {
  const dl = durationLookup as {
    table: Record<string, Record<string, Record<string, number>>>;
    default_corridor: string;
  };
  const cause = dl.table[inp.cause] ? inp.cause : "others";
  const byCorridor = dl.table[cause] ?? {};
  const corr = byCorridor[inp.corridor] ?? byCorridor[dl.default_corridor];
  const closure = inp.requires_road_closure ? 1 : 0;
  const peak = inp.is_peak ? 1 : 0;
  return corr?.[`${closure}${peak}`] ?? 60;
}

// Calibration breakdown for a forecast — lets the UI badge "calibrated" and show
// the learned adjustment.
export function calibrationFor(inp: EventInput) {
  const base = lookupDuration(inp);
  const factor = correctionFor(inp.cause, inp.corridor);
  return { base: Math.round(base * 10) / 10, factor, calibrated: Math.round(base * factor * 10) / 10 };
}

// Model-derived predicted duration (minutes), with the learned post-event
// correction applied — this is the calibrated clearance estimate.
export function predictDuration(inp: EventInput): number {
  return lookupDuration(inp) * correctionFor(inp.cause, inp.corridor);
}

export function forecast(inp: EventInput) {
  const agg = aggregates as any;
  const duration = predictDuration(inp);

  const dur = clamp(duration / DURATION_SATURATION_MIN);
  const closure = inp.requires_road_closure ? 1 : 0;

  let causeSev = agg.cause_severity?.[inp.cause];
  if (causeSev == null) {
    const cd = agg.cause_median_duration_min?.[inp.cause];
    if (cd != null) {
      const mx = Math.max(
        ...(Object.values(agg.cause_median_duration_min) as number[])
      );
      causeSev = cd / mx;
    } else causeSev = 0.4;
  }
  causeSev = clamp(causeSev);

  const location = clamp(agg.corridor_sensitivity?.[inp.corridor] ?? 0.4);

  let timing = inp.is_peak ? 1.0 : 0.45;
  if ((inp.priority ?? "High") === "High") timing = clamp(timing + 0.2);

  const factors = { duration: dur, closure, cause: causeSev, location, timing };
  const raw = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce(
    (s, k) => s + WEIGHTS[k] * factors[k],
    0
  );
  const score = Math.round(1000 * clamp(raw)) / 10;

  const contributions = Object.fromEntries(
    (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => [
      k,
      Math.round(1000 * WEIGHTS[k] * factors[k]) / 10,
    ])
  );

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    impact_score: score,
    tier: tierFor(score),
    expected_duration_min: round1(duration),
    affected_radius_m: Math.round(250 + 4 * score),
    factors: Object.fromEntries(
      Object.entries(factors).map(([k, v]) => [k, round1(v)])
    ),
    weights: WEIGHTS,
    contributions,
    // Post-event-learning calibration applied to the duration estimate.
    calibration: calibrationFor(inp),
  };
}

export const CAUSE_EQUIPMENT: Record<string, string[]> = {
  construction: ["Lane-separator cones", "Caution boards", "Lighted barriers"],
  water_logging: ["Pump units", "Warning signage", "Lighted barriers"],
  pot_holes: ["Caution boards", "Cones around pit"],
  tree_fall: ["Tree-cutting crew", "Recovery vehicle"],
  accident: ["Recovery crane", "Medical standby", "Cones"],
  vehicle_breakdown: ["Tow vehicle", "Cones"],
  public_event: ["Crowd barricades", "PA system", "Watch towers"],
  procession: ["Mobile barricades", "Escort vehicles"],
  protest: ["Crowd barricades", "Reserve force standby"],
  vip_movement: ["Pilot vehicles", "Spot barricades", "Sniffer check"],
};

function tierBaseManpower(tier: string): number {
  return { Severe: 12, High: 7, Moderate: 4, Low: 2 }[tier] ?? 2;
}

export function recommend(inp: EventInput) {
  const fc = forecast(inp);
  const tier = fc.tier;
  const dur = fc.expected_duration_min;
  const junctions = inp.affected_junctions ?? 1;
  const closure = !!inp.requires_road_closure;

  let manpower = tierBaseManpower(tier);
  manpower += Math.max(0, junctions - 1) * 2;
  if (closure) manpower += 4;
  if (inp.is_peak) manpower = Math.ceil(manpower * 1.3);
  if (inp.corridor !== "Non-corridor") manpower += 2;
  const longEvent = dur > 240;
  const shifts = longEvent ? 2 : 1;

  const officers = {
    head_constables: Math.max(1, Math.floor(manpower / 4)),
    constables: manpower,
    wardens: closure ? 2 : 1,
    shifts,
    total_deployment: manpower * shifts + Math.max(1, Math.floor(manpower / 4)),
  };

  let barricades = 0;
  if (closure) barricades = 4 + junctions * 2;
  else if (tier === "Severe" || tier === "High") barricades = 2 + junctions;
  else if (tier === "Moderate") barricades = junctions;

  const barricading = {
    barricade_units: barricades,
    placement: closure
      ? "Both approaches + diversion points"
      : "Affected lane taper",
    equipment: CAUSE_EQUIPMENT[inp.cause] ?? ["Cones", "Caution boards"],
  };

  const diversionNeeded = closure || tier === "Severe";
  const diversion: any = {
    needed: diversionNeeded,
    strategy: diversionNeeded
      ? "Full diversion to parallel arterial; signal-time adjustment at feeder junctions"
      : "No diversion — lane management sufficient",
    advisory_lead_time_min: inp.is_planned ? 60 : 0,
  };
  if (diversionNeeded && inp.lat != null && inp.lon != null) {
    diversion.route = mockDiversionRoute(inp.lat, inp.lon);
  }

  const narrative = buildNarrative(
    tier,
    inp.cause,
    manpower,
    shifts,
    barricades,
    diversionNeeded,
    dur,
    closure
  );

  return {
    forecast: fc,
    plan: {
      manpower: officers,
      barricading,
      diversion,
      confidence: dur && inp.corridor !== "Non-corridor" ? "High" : "Medium",
      narrative,
      deployment_posts: buildDeploymentPosts(inp, officers.total_deployment),
    },
  };
}

function buildDeploymentPosts(inp: EventInput, totalDeployment: number) {
  if (inp.lat == null || inp.lon == null) return [];
  const specs = [
    { role: "traffic_point", shift: "pre_event", label: "Traffic point - upstream" },
    { role: "crowd_control", shift: "during", label: "Crowd control - venue gate" },
    { role: "diversion_guide", shift: "during", label: "Diversion guide - turn pocket" },
    { role: "quick_response", shift: "all", label: "Quick response unit" },
  ] as const;
  return specs.map((spec, idx) => ({
    id: `deployment_${idx + 1}`,
    lat: inp.lat! + ((idx - 1.5) * 150) / 111320,
    lon: inp.lon! + ((1.5 - idx) * 150) / (111320 * Math.cos((inp.lat! * Math.PI) / 180)),
    role: spec.role,
    officers: Math.max(1, Math.round(totalDeployment / (5 + idx))),
    shift: spec.shift,
    label: spec.label,
  }));
}

// MOCK MapmyIndia routing — plausible diversion polyline bowing around the site.
export function mockDiversionRoute(lat: number, lon: number) {
  let seed = Math.floor(Math.abs(lat * 1000) + Math.abs(lon * 1000));
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const d = 0.006;
  const theta = rand() * Math.PI * 2;
  const ox = Math.cos(theta) * d;
  const oy = Math.sin(theta) * d;
  const route = [
    [lon - ox * 1.2, lat - oy * 1.2],
    [lon - ox * 0.4 + oy * 0.8, lat - oy * 0.4 - ox * 0.8],
    [lon + ox * 0.4 + oy * 0.8, lat + oy * 0.4 - ox * 0.8],
    [lon + ox * 1.2, lat + oy * 1.2],
  ];
  const distKm = Math.round((1.2 + rand() * 2.2) * 10) / 10;
  return {
    provider: "MapmyIndia (mock)",
    geometry: route,
    distance_km: distKm,
    extra_travel_min: Math.round(distKm * (2.5 + rand() * 1.5)),
  };
}

type DiversionRouteOption = ReturnType<typeof mockDiversionRoute> & {
  id: string;
  rank: number;
  label?: string;
  route_type?: "primary" | "secondary" | "heavy_vehicle";
  road_type?: "arterial" | "sub_arterial" | "mixed";
  estimated_clearance_relief: "low" | "medium" | "high";
  advisory_note: string;
};

export type DiversionRoutingResult = {
  route_options: DiversionRouteOption[];
  selected_route_id: string;
  routing_source: "mapmyindia" | "mock";
  fallback_reason?: string;
};

function optionFromRoute(
  id: string,
  rank: number,
  route: ReturnType<typeof mockDiversionRoute>,
  relief: "low" | "medium" | "high",
  note: string
): DiversionRouteOption {
  const route_type =
    id === "primary_diversion"
      ? "primary"
      : id === "arterial_preferred"
      ? "secondary"
      : "heavy_vehicle";
  const road_type =
    id === "primary_diversion"
      ? "mixed"
      : id === "arterial_preferred"
      ? "arterial"
      : "sub_arterial";
  return {
    id,
    rank,
    ...route,
    label:
      id === "primary_diversion"
        ? "Primary diversion"
        : id === "arterial_preferred"
        ? "Secondary arterial"
        : "Heavy-vehicle safe",
    route_type,
    road_type,
    estimated_clearance_relief: relief,
    advisory_note: note,
  };
}

function mockAlternatives(ctx: DiversionRoutingContext): DiversionRoutingResult {
  const base = mockDiversionRoute(ctx.lat, ctx.lon);
  const second = mockDiversionRoute(ctx.lat + 0.0018, ctx.lon - 0.0015);
  const third = mockDiversionRoute(ctx.lat - 0.0016, ctx.lon + 0.0014);
  const options = [
    optionFromRoute(
      "primary_diversion",
      1,
      base,
      "high",
      "Balanced alternate corridor for most through-traffic."
    ),
    optionFromRoute(
      "arterial_preferred",
      2,
      { ...second, extra_travel_min: Math.max(1, second.extra_travel_min - 2) },
      "medium",
      "Faster arterial-oriented alternate; monitor feeder spillback."
    ),
    optionFromRoute(
      "heavy_vehicle_safe",
      3,
      { ...third, extra_travel_min: third.extra_travel_min + 3 },
      "medium",
      "Wider movement envelope for heavy vehicles and recovery access."
    ),
  ];
  return {
    route_options: options,
    selected_route_id: options[0].id,
    routing_source: "mock",
  };
}

// --- Mappls (MapmyIndia) OAuth2 token, cached + auto-refreshed --------------
// Mappls REST APIs are token-based: exchange client_id/secret for a short-lived
// access token, then embed it in the Route Advanced API path. We cache the token
// in module scope and refresh a minute before expiry.
let mapplsToken: { value: string; expiresAt: number } | null = null;

const MAPPLS_TOKEN_URL =
  process.env.MAPMYINDIA_TOKEN_URL ??
  "https://outpost.mappls.com/api/security/oauth/token";

export async function getMapplsToken(): Promise<string | null> {
  const id = process.env.MAPMYINDIA_CLIENT_ID;
  const secret = process.env.MAPMYINDIA_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (mapplsToken && Date.now() < mapplsToken.expiresAt) return mapplsToken.value;

  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    });
    const res = await fetch(MAPPLS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    const ttlMs = Math.max(60, (data.expires_in ?? 86400) - 60) * 1000;
    mapplsToken = { value: data.access_token, expiresAt: Date.now() + ttlMs };
    return mapplsToken.value;
  } catch {
    return null;
  }
}

async function fetchMapmyIndiaAlternatives(
  ctx: DiversionRoutingContext
): Promise<DiversionRoutingResult | null> {
  const token = await getMapplsToken();
  if (!token) return null;

  // Route Advanced API base; the access token sits in the path. Override-able
  // for tile/region variants via env.
  const base =
    process.env.MAPMYINDIA_DIRECTIONS_URL ??
    `https://apis.mappls.com/advancedmaps/v1/${token}/route_adv/driving`;

  const deltas = [
    { id: "primary_diversion", dLat: 0.0, dLon: 0.0, relief: "high" as const, note: "Primary alternate corridor with balanced diversion load." },
    { id: "arterial_preferred", dLat: 0.0016, dLon: -0.0011, relief: "medium" as const, note: "Arterial-priority route for faster through movement." },
    { id: "heavy_vehicle_safe", dLat: -0.0014, dLon: 0.0013, relief: "medium" as const, note: "Heavy-vehicle-friendly route with safer turning profile." },
  ];

  const settled = await Promise.all(
    deltas.map(async (d, idx) => {
      // Mappls expects lon,lat;lon,lat in the path, with the event point as a
      // via-waypoint so the route bows around the affected stretch.
      const oLon = ctx.lon + d.dLon - 0.004;
      const oLat = ctx.lat + d.dLat - 0.004;
      const vLon = ctx.lon;
      const vLat = ctx.lat;
      const dLon = ctx.lon + d.dLon + 0.004;
      const dLat = ctx.lat + d.dLat + 0.004;
      const url =
        `${base}/${oLon},${oLat};${vLon},${vLat};${dLon},${dLat}` +
        `?geometries=geojson&overview=full`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const data = (await res.json()) as any;
        const first = data?.routes?.[0];
        const coords = first?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const distanceKm = Number(first?.distance ?? 0) / 1000;
        const durationMin = Number(first?.duration ?? 0) / 60;
        if (!distanceKm || !durationMin) return null;
        return optionFromRoute(
          d.id,
          idx + 1,
          {
            provider: "MapmyIndia",
            geometry: coords as number[][],
            distance_km: Math.round(distanceKm * 10) / 10,
            extra_travel_min: Math.round(durationMin),
          },
          d.relief,
          d.note
        );
      } catch {
        return null;
      }
    })
  );

  const options = settled.filter((x): x is DiversionRouteOption => !!x);
  if (!options.length) return null;
  return {
    route_options: options,
    selected_route_id: options[0].id,
    routing_source: "mapmyindia",
  };
}

export async function getDiversionAlternatives(
  ctx: DiversionRoutingContext
): Promise<DiversionRoutingResult> {
  const live = await fetchMapmyIndiaAlternatives(ctx);
  if (live && live.route_options.length) return live;
  const mocked = mockAlternatives(ctx);
  return {
    ...mocked,
    fallback_reason: "MapmyIndia unavailable or incomplete response.",
  };
}

function buildNarrative(
  tier: string,
  cause: string,
  manpower: number,
  shifts: number,
  barricades: number,
  diversion: boolean,
  dur: number,
  closure: boolean
): string {
  const parts = [`${tier} impact event (${cause.replace(/_/g, " ")}).`];
  parts.push(
    `Deploy ~${manpower} field personnel${
      shifts > 1 ? ` across ${shifts} shifts` : ""
    }.`
  );
  if (barricades) parts.push(`Set up ${barricades} barricade units.`);
  if (diversion) parts.push("Activate a diversion to the parallel arterial.");
  if (closure)
    parts.push("Pre-position recovery and signage for the road closure.");
  if (dur) parts.push(`Plan for ~${(dur / 60).toFixed(1)}h of operations.`);
  return parts.join(" ");
}
