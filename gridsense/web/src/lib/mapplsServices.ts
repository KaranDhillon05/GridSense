// Server-only Mappls REST API helpers.
// Each helper returns { data, source: "mappls" } on success or null on any failure.
// Callers must degrade gracefully to synthetic data when null is returned.
//
// Auth: reuses the OAuth2 access token from getMapplsToken() (client-credentials).
// If the token is rejected by the REST endpoints (some older resources require a
// static key), set MAPPLS_REST_KEY in .env.local as a fallback.

import { getMapplsToken } from "@/lib/gridsense";
import type { IsochroneContour, PoiFacility } from "@/lib/types";

const TIMEOUT_MS = 6000;

async function mapplsToken(): Promise<string | null> {
  const staticKey = process.env.MAPPLS_REST_KEY;
  if (staticKey) return staticKey;
  return getMapplsToken();
}

function sig(t: AbortSignal | null) {
  return t ?? AbortSignal.timeout(TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Driving-Range Isochrone
// Endpoint: https://route.mappls.com/routev2/optimization/isopolygon
// Returns drive-time catchment polygons (contours) around a venue.
// ---------------------------------------------------------------------------

export type IsochroneResult = { contours: IsochroneContour[] };

export async function fetchIsochrone(
  lat: number,
  lon: number,
  contoursMin: number[] = [10, 20],
  dateTime?: string // ISO or Mappls format e.g. "0,2024-12-31T19:00"
): Promise<IsochroneResult | null> {
  const token = await mapplsToken();
  if (!token) return null;

  const contourParam = contoursMin
    .map((m, i) => {
      const colors = ["ff6600", "ffcc00"];
      return `{"time":${m},"color":"${colors[i] ?? "aaaaaa"}"}`;
    })
    .join(",");

  const params = new URLSearchParams({
    locations: `${lat},${lon}`,
    rangeType: "time",
    costing: "auto",
    speedTypes: dateTime ? "predictive" : "optimal",
    contours: `[${contourParam}]`,
    access_token: token,
  });
  if (dateTime) params.set("date_time", dateTime);

  try {
    const res = await fetch(
      `https://route.mappls.com/routev2/optimization/isopolygon?${params}`,
      { signal: sig(null) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;

    const features: any[] = data?.features ?? [];
    if (!features.length) return null;

    const contours: IsochroneContour[] = features.map((f: any, i: number) => {
      const coords: number[][][] =
        f.geometry?.type === "Polygon"
          ? f.geometry.coordinates
          : f.geometry?.type === "MultiPolygon"
          ? f.geometry.coordinates.flat()
          : [];
      const minuteVal = f.properties?.contour ?? contoursMin[i] ?? contoursMin[0];
      const color = f.properties?.color ?? (i === 0 ? "ff6600" : "ffcc00");
      // Rough area: sum shoelace formula on first ring
      const ring = coords[0] ?? [];
      let area = 0;
      for (let j = 0; j < ring.length - 1; j++) {
        area += ring[j][0] * ring[j + 1][1] - ring[j + 1][0] * ring[j][1];
      }
      const area_km2 = Math.abs(area / 2) * (111.32 * 111.32);
      return { minutes: minuteVal, geometry: coords, area_km2: Math.round(area_km2 * 100) / 100, color: `#${color}` };
    });
    return { contours };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Distance Matrix (traffic-aware)
// Endpoint: https://route.mappls.com/route/dm/distance_matrix_traffic/driving/...
// Returns duration and distance from multiple origin gateways to a venue node.
// ---------------------------------------------------------------------------

export type MatrixCell = { duration_min: number; distance_km: number };

export async function fetchGatewayMatrix(
  sources: [number, number][], // [lon, lat]
  destination: [number, number] // [lon, lat]
): Promise<MatrixCell[] | null> {
  const token = await mapplsToken();
  if (!token) return null;
  if (!sources.length) return null;

  // Max 100 total points; trim to 9 sources to stay safe.
  const trimmed = sources.slice(0, 9);
  const coords = [...trimmed, destination]
    .map(([lon, lat]) => `${lon},${lat}`)
    .join(";");
  const srcIdx = trimmed.map((_, i) => i).join(";");
  const dstIdx = String(trimmed.length);

  const url =
    `https://route.mappls.com/route/dm/distance_matrix_traffic/driving/${coords}` +
    `?sources=${srcIdx}&destinations=${dstIdx}&access_token=${token}`;

  try {
    const res = await fetch(url, { signal: sig(null) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;

    const durRows: number[][] = data?.durations ?? [];
    const distRows: number[][] = data?.distances ?? [];

    if (!durRows.length) return null;
    return trimmed.map((_, i) => ({
      duration_min: Math.round((durRows[i]?.[0] ?? 0) / 60),
      distance_km: Math.round((distRows[i]?.[0] ?? 0) / 100) / 10,
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Predictive Routing — road-snapped geometry + predictive ETA
// Endpoint: https://route.mappls.com/routev2/direction/route
// ---------------------------------------------------------------------------

export type PredictiveRouteResult = {
  geometry: number[][]; // [lon, lat]
  distance_km: number;
  duration_min: number;
};

export async function fetchPredictiveRoute(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
  dateTime?: string // e.g. "0,2024-12-31T19:00" (predictive) or absent (optimal)
): Promise<PredictiveRouteResult | null> {
  const token = await mapplsToken();
  if (!token) return null;

  const speedTypes = dateTime ? "traffic" : "optimal";
  const params = new URLSearchParams({
    locations: `${originLon},${originLat};${destLon},${destLat}`,
    profile: "driving",
    speedTypes,
    date_time: dateTime ?? `0,${new Date().toISOString().slice(0, 16)}`,
    geometries: "geojson",
    overview: "full",
    access_token: token,
  });

  try {
    const res = await fetch(
      `https://route.mappls.com/routev2/direction/route?${params}`,
      { signal: sig(null) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const route = data?.routes?.[0];
    if (!route) return null;
    const coords: number[][] = route.geometry?.coordinates ?? [];
    if (coords.length < 2) return null;
    return {
      geometry: coords,
      distance_km: Math.round((route.distance ?? 0) / 100) / 10,
      duration_min: Math.round((route.duration ?? 0) / 60),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POI Along Route
// Endpoint: https://search.mappls.com/search/places/along-route
// Returns hospitals, police stations, fuel, parking near a diversion corridor.
// ---------------------------------------------------------------------------

const POI_CATEGORIES: Array<{ code: string; label: PoiFacility["category"] }> = [
  { code: "HLTH010", label: "hospital" },
  { code: "ADMN002", label: "police" },
  { code: "TRPT013", label: "fuel" },
  { code: "TRPT006", label: "parking" },
];

// Simple polyline5 encoder for a [lon,lat][] path
function encodePolyline5(coords: number[][]): string {
  let prev_lat = 0;
  let prev_lon = 0;
  let result = "";
  const encode = (v: number) => {
    let n = Math.round(v * 1e5);
    n = n < 0 ? ~(n << 1) : n << 1;
    while (n >= 0x20) {
      result += String.fromCharCode(((0x20 | (n & 0x1f)) + 63));
      n >>= 5;
    }
    result += String.fromCharCode((n + 63));
  };
  for (const [lon, lat] of coords) {
    encode(lat - prev_lat);
    encode(lon - prev_lon);
    prev_lat = lat;
    prev_lon = lon;
  }
  return result;
}

export async function fetchPoiAlongRoute(
  geometry: number[][], // [lon, lat][]
  routeId: string,
  buffer = 300
): Promise<PoiFacility[]> {
  const token = await mapplsToken();
  if (!token || geometry.length < 2) return [];

  const encoded = encodePolyline5(geometry);
  const results: PoiFacility[] = [];

  await Promise.all(
    POI_CATEGORIES.map(async ({ code, label }) => {
      try {
        const params = new URLSearchParams({
          path: encoded,
          category: code,
          geometries: "polyline5",
          buffer: String(buffer),
          page: "1",
          access_token: token,
        });
        const res = await fetch(
          `https://search.mappls.com/search/places/along-route?${params}`,
          { signal: sig(null) }
        );
        if (!res.ok) return;
        const data = (await res.json()) as any;
        const pois: any[] = data?.suggestedLocations ?? data?.results ?? [];
        for (const p of pois.slice(0, 3)) {
          const lat = parseFloat(p.latitude ?? p.lat ?? "0");
          const lon = parseFloat(p.longitude ?? p.lng ?? p.lon ?? "0");
          if (!lat || !lon) continue;
          results.push({
            id: p.eLoc ?? `${label}_${results.length}`,
            name: p.placeName ?? p.name ?? label,
            category: label,
            lat,
            lon,
            route_id: routeId,
            distance_m: Math.round((p.distance ?? 0)),
          });
        }
      } catch {
        // silent — POI is best-effort
      }
    })
  );

  return results;
}
