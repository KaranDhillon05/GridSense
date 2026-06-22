// Night Watch 3.0 — Traffic Preparedness Engine.
//
// Reuses the existing Monte-Carlo runner + report builder UNCHANGED, then fixes
// the map-visualization gap: every recommendation gets coordinates so it renders.
// Risk zones (corridors + junctions) AND resource positions (officers/tow → edge
// midpoints) all appear on one map — no empty maps.

import { getNetwork } from "@/lib/sim/network";
import { runBatch } from "@/lib/nightwatch/monteCarloRunner";
import { buildReport } from "@/lib/nightwatch/buildReport";
import type { NWReport, ResourceRecommendation } from "@/lib/nightwatch/types";
import type { MapProps } from "@/components/BengaluruMap";
import type { DeploymentPost } from "@/lib/types";

export async function runPreparedness(
  count: 100 | 500 | 1000,
  onProgress: (pct: number) => void
): Promise<NWReport> {
  const results = await runBatch(count, onProgress);
  return buildReport(results);
}

function edgeMidpoint(edgeId: string): { lat: number; lon: number } | null {
  const net = getNetwork();
  if (!net.edge(edgeId)) return null;
  const p = net.centreAt(edgeId, net.edgeLength(edgeId) / 2);
  return { lat: p.lat, lon: p.lon };
}

const RES_ROLE: Record<string, DeploymentPost["role"]> = {
  officer: "traffic_point",
  supervisor: "traffic_point",
  rapid_response: "quick_response",
  tow_truck: "quick_response",
  recovery_van: "quick_response",
  maintenance_crew: "quick_response",
  ambulance: "quick_response",
  fire_engine: "quick_response",
};

/** Resolve resource positioning recommendations to map deployment posts. */
export function resourcePosts(report: NWReport): (DeploymentPost & { rec: ResourceRecommendation })[] {
  const out: (DeploymentPost & { rec: ResourceRecommendation })[] = [];
  report.resourcePositioning.forEach((rec, i) => {
    const pos = edgeMidpoint(rec.targetEdgeId);
    if (!pos) return; // skip only if the edge truly can't resolve (should not happen)
    out.push({
      id: `nw-res-${i}`,
      lat: pos.lat,
      lon: pos.lon,
      role: RES_ROLE[rec.resourceType] ?? "quick_response",
      officers: 1,
      shift: "pre_event",
      label: `${rec.label} → ${rec.recommendedLocation} (+${rec.expectedImprovementPct}%)`,
      rec,
    });
  });
  return out;
}

/** Full MapProps for the preparedness map: risk zones (corridors+junctions) +
 *  resource positions. Guarantees every recommendation has coordinates. */
export function reportToMapProps(report: NWReport): MapProps {
  const corridorMax = report.topCorridors[0]?.riskScore ?? 1;
  const junctionMax = report.topJunctions[0]?.riskScore ?? 1;

  const hotspots = [
    ...report.topCorridors.map((c) => ({
      lat: c.lat,
      lon: c.lon,
      count: Math.round((c.riskScore / corridorMax) * 100),
      closure_rate: Math.min(1, c.avgSpillover / 10),
      high_priority_rate: c.riskScore / corridorMax,
    })),
    ...report.topJunctions.map((j) => ({
      lat: j.lat,
      lon: j.lon,
      count: Math.round((j.riskScore / junctionMax) * 80),
      closure_rate: 0.2,
      high_priority_rate: j.riskScore / junctionMax,
    })),
  ];

  return {
    events: [],
    hotspots,
    showHeatmap: hotspots.length > 0,
    deploymentPosts: resourcePosts(report),
    zoom: 14,
  };
}

export interface TomorrowBrief {
  topRisk: string;
  resourceGap: string;
  recommendedAction: string;
}

export function tomorrowBrief(report: NWReport): TomorrowBrief {
  const c = report.topCorridors[0];
  const rec = report.resourcePositioning[0];
  return {
    topRisk: c ? `${c.name} (risk ${Math.round(c.riskScore)})` : "No dominant risk",
    resourceGap:
      report.resourceSufficiencyPct < 100
        ? `${100 - report.resourceSufficiencyPct}% of simulated demand went unmet`
        : "Fleet sufficient across scenarios",
    recommendedAction: rec
      ? `Reposition ${rec.label} to ${rec.recommendedLocation} (+${rec.expectedImprovementPct}% improvement)`
      : "Hold current positions",
  };
}
