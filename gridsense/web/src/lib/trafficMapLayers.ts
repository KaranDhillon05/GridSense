import type { EdgeUtilization, TrafficPhase, TrafficRoute, TrafficRouteBundle } from "@/lib/types";

export type MapTrafficRoute = {
  id: string;
  path: [number, number][];
  color: string;
  weight: number;
  dashArray?: string;
  direction: TrafficRoute["direction"];
  phase: TrafficPhase;
  flow_vph: number;
  /** Bearing in degrees (0 = north) for midpoint arrow */
  bearing?: number;
  /** Source of this route's ETA (mappls / osrm / synthetic) */
  eta_source?: TrafficRoute["eta_source"];
};

const PHASE_MATCH: Record<TrafficPhase, TrafficPhase[]> = {
  pre_event: ["pre_event"],
  arrival: ["arrival", "pre_event"],
  during: ["during", "arrival", "pre_event"],
  dispersal: ["dispersal", "during"],
  post_event: ["post_event", "dispersal"],
  contingency: ["contingency"],
};

/** Map flow (vph) to a pixel line weight 3–9. */
export function volumeWeight(flow_vph: number): number {
  if (flow_vph >= 2000) return 9;
  if (flow_vph >= 1200) return 7;
  if (flow_vph >= 600) return 5;
  if (flow_vph >= 200) return 4;
  return 3;
}

/** Bearing in degrees between two [lat,lon] points (0=N, 90=E). */
function bearing(a: [number, number], b: [number, number]): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Pick the midpoint pair of a path for arrow placement. */
function midBearing(path: [number, number][]): number | undefined {
  if (path.length < 2) return undefined;
  const mid = Math.floor(path.length / 2);
  return bearing(path[mid - 1] ?? path[0], path[mid]);
}

export function flattenTrafficRoutes(
  bundle: TrafficRouteBundle | undefined,
  phase: TrafficPhase,
  showContingency: boolean,
  showAllPhases = false
): MapTrafficRoute[] {
  if (!bundle) return [];
  const allowed = new Set([...PHASE_MATCH[phase], ...(showContingency ? ["contingency"] : [])]);
  const routes: Array<{ route: TrafficRoute; color: string; weight: number; dash?: string }> = [
    ...bundle.primary_inbound.map((r) => ({ route: r, color: "#3b82f6", weight: volumeWeight(r.assigned_flow_vph) })),
    ...bundle.secondary_inbound.map((r) => ({ route: r, color: "#60a5fa", weight: Math.max(3, volumeWeight(r.assigned_flow_vph) - 1), dash: "6 6" })),
    ...bundle.primary_outbound.map((r) => ({ route: r, color: "#f97316", weight: volumeWeight(r.assigned_flow_vph) })),
    ...bundle.secondary_outbound.map((r) => ({ route: r, color: "#fdba74", weight: Math.max(3, volumeWeight(r.assigned_flow_vph) - 1), dash: "6 6" })),
    ...bundle.through_diversion.map((r) => ({ route: r, color: "#22c55e", weight: volumeWeight(r.assigned_flow_vph) })),
    ...bundle.emergency_access.map((r) => ({ route: r, color: "#a855f7", weight: 4, dash: "4 4" })),
    ...(showContingency
      ? bundle.contingency.map((r) => ({ route: r, color: "#9ca3af", weight: 2, dash: "2 6" }))
      : []),
  ];

  return routes
    .filter(({ route }) => showAllPhases || allowed.has(route.phase))
    .map(({ route, color, weight, dash }) => {
      const path = route.geometry.map(([lon, lat]) => [lat, lon] as [number, number]);
      return {
        id: route.id,
        path,
        color,
        weight,
        dashArray: dash,
        direction: route.direction,
        phase: route.phase,
        flow_vph: route.assigned_flow_vph,
        bearing: midBearing(path),
        eta_source: route.eta_source,
      };
    });
}

export function bottleneckPolylines(
  edges: EdgeUtilization[] | undefined,
  getGeometry: (edgeId: string) => number[][] | null
): MapTrafficRoute[] {
  if (!edges?.length) return [];
  return edges.slice(0, 5).map((e) => {
    const geom = getGeometry(e.edge_id) ?? [];
    const path = geom.map(([lon, lat]) => [lat, lon] as [number, number]);
    return {
      id: `bn_${e.edge_id}`,
      path,
      color: "#ef4444",
      weight: 6,
      direction: "diversion" as const,
      phase: "during" as const,
      flow_vph: e.assigned_flow_vph,
      bearing: midBearing(path),
    };
  });
}
