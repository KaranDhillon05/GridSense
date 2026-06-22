// Real road-network snapping via OSRM (OpenStreetMap routing).
//
// The synthetic compass-ring geometry does NOT follow real streets, so routes
// drawn on the basemap look "off-road" / misaligned. OSRM snaps any origin →
// destination to the actual road network and returns precise geometry that
// lines up with the map. It is free, key-less, supports route ALTERNATIVES
// (genuine alternate corridors) and intermediate WAYPOINTS (bypass diversions),
// and covers Bengaluru via OSM data — so every plan is map-accurate regardless
// of the Mappls API quota.
//
// Every helper degrades to null on failure; callers keep their synthetic
// geometry as a last resort so the demo never breaks.

const OSRM_BASE =
  process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const TIMEOUT_MS = 8000;

export type SnappedRoute = {
  geometry: number[][]; // [lon, lat][]
  distance_km: number;
  duration_min: number;
};

type LonLat = [number, number];

function coordStr(p: LonLat): string {
  return `${p[0]},${p[1]}`;
}

/**
 * Snap a route to the real road network. Optionally route through a `via`
 * waypoint (used to force diversion routes AROUND the venue) and/or request
 * `alternatives` (genuine alternate corridors for contingency planning).
 *
 * Returns an ordered list: index 0 is the recommended route, the rest are
 * alternates. Null on any failure.
 */
export async function snapRoute(
  origin: LonLat,
  dest: LonLat,
  opts: { via?: LonLat; alternatives?: number } = {}
): Promise<SnappedRoute[] | null> {
  const pts: LonLat[] = opts.via ? [origin, opts.via, dest] : [origin, dest];
  const path = pts.map(coordStr).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
  });
  // OSRM only returns alternatives for two-coordinate requests.
  if (opts.alternatives && !opts.via) {
    params.set("alternatives", String(opts.alternatives));
  }

  try {
    const res = await fetch(
      `${OSRM_BASE}/route/v1/driving/${path}?${params}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        geometry?: { coordinates?: number[][] };
        distance?: number;
        duration?: number;
      }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) return null;

    const out: SnappedRoute[] = [];
    for (const r of data.routes) {
      const coords = r.geometry?.coordinates ?? [];
      if (coords.length < 2) continue;
      out.push({
        geometry: coords,
        distance_km: Math.round(((r.distance ?? 0) / 1000) * 10) / 10,
        duration_min: Math.round(((r.duration ?? 0) / 60) * 10) / 10,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Haversine distance in metres between two [lon,lat] points. */
export function metersLL(a: LonLat, b: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Walk backward from the END of a [lon,lat] path until ~`meters` of road has
 * been covered, and return that point. Used to place a barricade/cordon on the
 * real road a set distance before the venue.
 */
export function pointFromEnd(geom: number[][], meters: number): number[] | null {
  if (geom.length < 2) return geom[0] ?? null;
  let acc = 0;
  for (let i = geom.length - 1; i > 0; i--) {
    const seg = metersLL(geom[i] as LonLat, geom[i - 1] as LonLat);
    if (acc + seg >= meters) {
      const t = (meters - acc) / seg;
      const lon = geom[i][0] + (geom[i - 1][0] - geom[i][0]) * t;
      const lat = geom[i][1] + (geom[i - 1][1] - geom[i][1]) * t;
      return [lon, lat];
    }
    acc += seg;
  }
  return geom[0];
}
