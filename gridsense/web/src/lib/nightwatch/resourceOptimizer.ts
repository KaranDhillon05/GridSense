// Recommends resource pre-positioning based on corridors with highest demand
// for each resource type. Compares to current depot locations.

import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import type { ResourceType } from "@/lib/sim/types";
import type { NWRunResult, ResourceRecommendation, CorridorVulnerability } from "./types";

const RESOURCE_LABELS: Partial<Record<ResourceType, string>> = {
  tow_truck: "Tow Truck",
  officer: "Traffic Officer",
  ambulance: "Ambulance",
  fire_engine: "Fire Engine",
  recovery_van: "Heavy Recovery Vehicle",
  barricade: "Barricade Set",
  maintenance_crew: "Maintenance Crew",
};

// Default staging areas from existing depot definitions.
const DEPOT_NAMES: Partial<Record<ResourceType, string>> = {
  tow_truck: "Tow Yard (Shivajinagar)",
  officer: "Traffic HQ (Cubbon Road)",
  ambulance: "Bowring Hospital",
  fire_engine: "Fire Station (MG Road)",
  recovery_van: "Heavy Recovery Depot",
  barricade: "Traffic Store (Cunningham Road)",
  maintenance_crew: "BBMP Ward Office",
};

export function optimizeResources(
  results: NWRunResult[],
  topCorridors: CorridorVulnerability[]
): ResourceRecommendation[] {
  if (!results.length || !topCorridors.length) return [];

  // For each resource type, find the corridor where it was most demanded.
  const demandByTypeAndEdge = new Map<ResourceType, Map<string, number>>();

  for (const r of results) {
    const spec = INCIDENT_CATALOG[r.scenario.incidentType];
    for (const [rType, count] of Object.entries(spec.response.resources)) {
      const rt = rType as ResourceType;
      if (!demandByTypeAndEdge.has(rt)) demandByTypeAndEdge.set(rt, new Map());
      const edgeMap = demandByTypeAndEdge.get(rt)!;
      const cur = edgeMap.get(r.scenario.edgeId) ?? 0;
      edgeMap.set(r.scenario.edgeId, cur + (count as number));
    }
  }

  const recommendations: ResourceRecommendation[] = [];
  const topTypes: ResourceType[] = ["tow_truck", "officer", "ambulance", "fire_engine", "recovery_van"];

  for (const rType of topTypes) {
    const edgeMap = demandByTypeAndEdge.get(rType);
    if (!edgeMap || !edgeMap.size) continue;

    // Find the edge with highest demand for this resource.
    let bestEdge = "";
    let bestDemand = 0;
    for (const [eid, demand] of edgeMap) {
      if (demand > bestDemand) {
        bestDemand = demand;
        bestEdge = eid;
      }
    }
    if (!bestEdge) continue;

    // Find corridor info.
    const corridor = topCorridors.find(c => c.edgeId === bestEdge)
      ?? topCorridors[0];

    // Estimate improvement: how much of the avg improvement comes from resource response.
    const runsOnCorridor = results.filter(r => r.scenario.edgeId === corridor.edgeId);
    const avgImprov = runsOnCorridor.length
      ? runsOnCorridor.reduce((s, r) => s + r.improvementPct, 0) / runsOnCorridor.length
      : 15;

    recommendations.push({
      resourceType: rType,
      label: RESOURCE_LABELS[rType] ?? rType,
      currentLocation: DEPOT_NAMES[rType] ?? "Current Depot",
      recommendedLocation: corridor.name,
      targetEdgeId: corridor.edgeId,
      reason: `${bestDemand} demand units recorded in ${runsOnCorridor.length} simulations on ${corridor.name}`,
      expectedImprovementPct: Math.round(avgImprov * 0.4), // pre-positioning gives ~40% of full response benefit
    });
  }

  // Sort by expected improvement.
  recommendations.sort((a, b) => b.expectedImprovementPct - a.expectedImprovementPct);
  return recommendations;
}
