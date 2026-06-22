// Orchestrates all four Mappls data calls in parallel and assembles a MapplsContext.
// Every field degrades independently to synthetic when its API call fails or is unconfigured.
// The EventInput's start_hour is converted to a future date_time for predictive routing.

import {
  fetchIsochrone,
  fetchGatewayMatrix,
  fetchPredictiveRoute,
  fetchPoiAlongRoute,
} from "@/lib/mapplsServices";
import type {
  MapplsContext,
  GatewayMatrixEntry,
  DiversionRouteOption,
  TrafficPlanOutput,
  DataSource,
} from "@/lib/types";
import type { EventInput } from "@/lib/gridsense";

// Build a predictive date_time string for Mappls: the next occurrence of
// the event's start_hour (same day if still future, else tomorrow).
function eventDateTime(startHour: number): string {
  const now = new Date();
  const target = new Date(now);
  target.setHours(startHour, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const iso = target.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  return `0,${iso}`;
}

export async function enrichWithMappls(
  input: EventInput,
  trafficPlan: TrafficPlanOutput | null
): Promise<MapplsContext> {
  if (input.lat == null || input.lon == null) {
    return emptySyntheticContext();
  }

  const { lat, lon } = input;
  const dateTime = eventDateTime(input.hour ?? 19);

  // --- Collect gateway lon/lat pairs from the traffic plan ---
  const gatewaySources: [number, number][] = [];
  const corridorMeta: Array<{ id: string; name: string }> = [];
  if (trafficPlan) {
    for (const c of trafficPlan.access_corridors.slice(0, 6)) {
      // Each corridor's gateway node has lat/lon from the graph nodes.
      // We approximate here by using the first inbound route's geometry start.
      const inRoute = [
        ...trafficPlan.routes.primary_inbound,
        ...trafficPlan.routes.secondary_inbound,
      ].find((r) => r.id.includes(`${corridorMeta.length + 1}`));
      const geomStart = inRoute?.geometry[0];
      if (geomStart) {
        gatewaySources.push([geomStart[0], geomStart[1]] as [number, number]);
        corridorMeta.push({ id: c.id, name: c.name });
      }
    }
    // Fallback: use the first edge geometry of the inbound routes directly
    if (!gatewaySources.length) {
      for (const r of [
        ...trafficPlan.routes.primary_inbound,
        ...trafficPlan.routes.secondary_inbound,
      ].slice(0, 4)) {
        const g = r.geometry[0];
        if (g) {
          gatewaySources.push([g[0], g[1]]);
          corridorMeta.push({ id: r.id, name: r.id });
        }
      }
    }
  }

  // Pick the best outbound route geometry for predictive diversion
  const primaryOutGeom =
    trafficPlan?.routes.through_diversion[0]?.geometry ??
    trafficPlan?.routes.primary_inbound[0]?.geometry;

  const destLon = lon;
  const destLat = lat;
  // Use first gateway as origin for the predictive diversion
  const originLon = gatewaySources[0]?.[0] ?? lon - 0.005;
  const originLat = gatewaySources[0]?.[1] ?? lat - 0.005;

  // Run all four calls in parallel
  const [isoResult, matrixResult, predRoute, poiFacilities] = await Promise.all([
    fetchIsochrone(lat, lon, [10, 20], dateTime),
    gatewaySources.length
      ? fetchGatewayMatrix(gatewaySources, [destLon, destLat])
      : Promise.resolve(null),
    fetchPredictiveRoute(originLon, originLat, destLon, destLat, dateTime),
    primaryOutGeom
      ? fetchPoiAlongRoute(primaryOutGeom, "primary_diversion")
      : Promise.resolve([] as ReturnType<typeof fetchPoiAlongRoute> extends Promise<infer T> ? T : never[]),
  ]);

  // --- Isochrone ---
  const isochrone_source: DataSource = isoResult ? "mappls" : "synthetic";
  const isochrones = isoResult?.contours ?? syntheticIsochrones(lat, lon);

  // --- Gateway matrix ---
  const gateway_matrix_source: DataSource = matrixResult ? "mappls" : "synthetic";
  const gateway_matrix: GatewayMatrixEntry[] = matrixResult
    ? matrixResult.map((cell, i) => ({
        corridor_id: corridorMeta[i]?.id ?? `gw_${i}`,
        corridor_name: corridorMeta[i]?.name ?? `Gateway ${i + 1}`,
        duration_min: cell.duration_min,
        distance_km: cell.distance_km,
        source: "mappls" as DataSource,
      }))
    : syntheticGatewayMatrix(corridorMeta, lat, lon);

  // --- Predictive diversion ---
  let predictive_diversion: DiversionRouteOption | undefined;
  const predictive_diversion_source: DataSource = predRoute ? "mappls" : "synthetic";
  if (predRoute) {
    predictive_diversion = {
      id: "predictive_primary",
      rank: 1,
      provider: "Mappls (predictive routing)",
      geometry: predRoute.geometry,
      distance_km: predRoute.distance_km,
      extra_travel_min: predRoute.duration_min,
      label: "Primary diversion (road-snapped)",
      route_type: "primary",
      road_type: "arterial",
      estimated_clearance_relief: "high",
      advisory_note: `Predictive ETA at event start: ${predRoute.duration_min} min (${predRoute.distance_km} km via real road network).`,
    };
  }

  // --- POI facilities ---
  const facilities_source: DataSource =
    Array.isArray(poiFacilities) && poiFacilities.length > 0 ? "mappls" : "synthetic";
  const facilities = Array.isArray(poiFacilities) && poiFacilities.length > 0
    ? poiFacilities
    : syntheticFacilities(lat, lon);

  return {
    isochrones,
    isochrone_source,
    gateway_matrix,
    gateway_matrix_source,
    predictive_diversion,
    predictive_diversion_source,
    facilities,
    facilities_source,
  };
}

// --- Synthetic fallbacks (always valid, clearly labeled) ---

function syntheticIsochrones(lat: number, lon: number) {
  const R = 111320;
  const makeRing = (radiusM: number): number[][] => {
    const dLat = radiusM / R;
    const dLon = radiusM / (R * Math.cos((lat * Math.PI) / 180));
    const pts: number[][] = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * 2 * Math.PI;
      pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return pts;
  };
  return [
    { minutes: 10, geometry: [makeRing(800)], area_km2: 2.0, color: "#ff6600" },
    { minutes: 20, geometry: [makeRing(1600)], area_km2: 8.0, color: "#ffcc00" },
  ];
}

function syntheticGatewayMatrix(
  corridors: Array<{ id: string; name: string }>,
  _lat: number,
  _lon: number
): GatewayMatrixEntry[] {
  return corridors.map((c, i) => ({
    corridor_id: c.id,
    corridor_name: c.name,
    duration_min: 6 + i * 2,
    distance_km: 1.2 + i * 0.4,
    source: "synthetic" as DataSource,
  }));
}

function syntheticFacilities(lat: number, lon: number) {
  return [
    { id: "syn_hosp_1", name: "Nearest Hospital (modelled)", category: "hospital" as const, lat: lat + 0.008, lon: lon + 0.006, distance_m: 950 },
    { id: "syn_police_1", name: "Traffic Police Post (modelled)", category: "police" as const, lat: lat - 0.004, lon: lon + 0.003, distance_m: 520 },
    { id: "syn_fuel_1", name: "Fuel Station (modelled)", category: "fuel" as const, lat: lat + 0.003, lon: lon - 0.007, distance_m: 780 },
    { id: "syn_park_1", name: "Public Parking (modelled)", category: "parking" as const, lat: lat - 0.006, lon: lon - 0.004, distance_m: 660 },
  ];
}

function emptySyntheticContext(): MapplsContext {
  return {
    isochrones: [],
    isochrone_source: "synthetic",
    gateway_matrix: [],
    gateway_matrix_source: "synthetic",
    predictive_diversion: undefined,
    predictive_diversion_source: "synthetic",
    facilities: [],
    facilities_source: "synthetic",
  };
}
