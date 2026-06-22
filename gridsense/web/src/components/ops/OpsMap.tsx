"use client";

import { useMemo } from "react";
import { MapView } from "@/components/MapView";
import { CBD_CENTER } from "@/lib/sim/network";
import { getEdge } from "@/lib/roadGraph";
import { flattenTrafficRoutes, bottleneckPolylines } from "@/lib/trafficMapLayers";
import type { MapProps } from "@/components/BengaluruMap";
import type { MapTrafficRoute } from "@/lib/trafficMapLayers";
import type { ScoredEvent } from "@/lib/ui";
import type { OpsState, OpsIncident, OpsResource, Severity } from "@/lib/ops/types";
import type { DeploymentPost, TrafficPlanOutput, MapplsContext } from "@/lib/types";

const SEV_TIER: Record<Severity, string> = {
  severe: "Severe",
  high: "High",
  moderate: "Moderate",
  low: "Low",
};
const SEV_SCORE: Record<Severity, number> = { severe: 85, high: 64, moderate: 44, low: 24 };

function incidentToEvent(i: OpsIncident): ScoredEvent {
  return {
    id: i.id,
    event_cause: i.type,
    latitude: i.lat,
    longitude: i.lon,
    corridor: i.corridor,
    requires_road_closure: i.requiresClosure ? 1 : 0,
    status: i.status === "closed" ? "resolved" : "active",
    impact_score: SEV_SCORE[i.severity],
    tier: SEV_TIER[i.severity],
    predicted_duration_min: i.etaClearMin ?? i.predictedDurationMin,
  };
}

const RESOURCE_ROLE: Record<string, DeploymentPost["role"]> = {
  officer: "traffic_point",
  supervisor: "traffic_point",
  rapid_response: "quick_response",
  tow_truck: "quick_response",
  recovery_van: "quick_response",
  ambulance: "quick_response",
  fire_engine: "quick_response",
};

function resourceToPost(r: OpsResource): DeploymentPost {
  return {
    id: `res-${r.id}`,
    lat: r.lat,
    lon: r.lon,
    role: RESOURCE_ROLE[r.type] ?? "quick_response",
    officers: 1,
    shift: "during",
    label: `${r.label} ${r.id} · ${r.status}`,
  };
}

export interface OpsLayers {
  incidents?: boolean;
  resources?: boolean;
  deployments?: boolean;
}

/** Project the live ops state onto the existing rich MapProps surface. */
export function opsStateToMapProps(
  state: OpsState,
  selectedId?: string | null,
  layers: OpsLayers = {}
): MapProps {
  const showIncidents = layers.incidents ?? true;
  const showResources = layers.resources ?? true;
  const showDeployments = layers.deployments ?? true;

  const active = state.incidents.filter((i) => i.status !== "closed");
  const events = showIncidents ? active.map(incidentToEvent) : [];

  const sel = selectedId ? state.incidents.find((i) => i.id === selectedId) : null;
  const focus = sel
    ? { lat: sel.lat, lon: sel.lon, radius_m: 320, tier: SEV_TIER[sel.severity], label: sel.title }
    : null;

  const trafficRoutes: MapTrafficRoute[] = showDeployments
    ? state.deployments
        .filter((d) => d.kind === "diversion" && d.status === "active" && d.geometry && d.geometry.length >= 2)
        .map((d) => ({
          id: d.id,
          path: d.geometry!.map(([lon, lat]) => [lat, lon] as [number, number]),
          color: "#22c55e",
          weight: 5,
          dashArray: "8 6",
          direction: "diversion" as const,
          phase: "during" as const,
          flow_vph: 0,
        }))
    : [];

  const deploymentPosts = showResources
    ? state.resources.filter((r) => r.status !== "available").map(resourceToPost)
    : [];

  return {
    events,
    focus,
    trafficRoutes,
    deploymentPosts,
    center: CBD_CENTER,
    zoom: 14,
    selectedId: selectedId ?? null,
  };
}

/**
 * Overlay a full-Bangalore traffic plan (same engine as /plan) onto the ops map
 * props, reusing the exact converters the plan page uses so the incident map
 * matches /plan in quality: real diversions/reroutes, edge-cut barricades,
 * deployment posts, emergency corridor, bottleneck edges, and isochrones.
 */
function withTrafficPlan(
  base: MapProps,
  plan: TrafficPlanOutput,
  context?: MapplsContext
): MapProps {
  const routes = flattenTrafficRoutes(plan.routes, "during", true, true);
  const bottlenecks = bottleneckPolylines(
    plan.bottleneck_edges,
    (id) => getEdge(id)?.geometry ?? null
  );
  return {
    ...base,
    // The plan's deployment posts (pre-positioning) supersede the tactical
    // resource markers; keep both so committed units still show.
    deploymentPosts: [...plan.deployment_posts, ...(base.deploymentPosts ?? [])],
    barricadePoints: [...(base.barricadePoints ?? []), ...plan.barricade_points],
    trafficRoutes: [...routes, ...bottlenecks, ...(base.trafficRoutes ?? [])],
    isochrones: context?.isochrones ?? base.isochrones,
    facilities: context?.facilities ?? base.facilities,
  };
}

export function OpsMap({
  state,
  selectedId,
  center,
  zoom,
  layers,
  trafficPlan,
  mapplsContext,
}: {
  state: OpsState;
  selectedId?: string | null;
  center?: [number, number];
  zoom?: number;
  layers?: OpsLayers;
  trafficPlan?: TrafficPlanOutput | null;
  mapplsContext?: MapplsContext;
}) {
  const layerKey = `${layers?.incidents ?? true}-${layers?.resources ?? true}-${layers?.deployments ?? true}`;
  const props = useMemo(() => {
    let base = opsStateToMapProps(state, selectedId, layers);
    if (trafficPlan) base = withTrafficPlan(base, trafficPlan, mapplsContext);
    return {
      ...base,
      center: center ?? base.center,
      zoom: zoom ?? base.zoom,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedId, center, zoom, layerKey, trafficPlan, mapplsContext]);
  return <MapView {...props} />;
}
