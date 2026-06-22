// Resource Intelligence — fleet status, utilization, and "where should units go
// NOW" reposition recommendations. (Night Watch answers "where tomorrow"; this
// answers the live question.) Reads the ops store + incident demand.

import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { RESOURCE_META } from "@/lib/sim/resources";
import { prettyCause } from "@/lib/ui";
import type { OpsState, OpsResource, ResourceType, OpsResourceStatus } from "./types";

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface FleetGroup {
  type: ResourceType;
  label: string;
  total: number;
  available: number;
  committed: number;
  statuses: Record<OpsResourceStatus, number>;
}

export interface RepositionRec {
  id: string;
  resourceId: string;
  resourceLabel: string;
  incidentId: string;
  incidentTitle: string;
  distanceKm: number;
  reason: string;
  priority: "high" | "med";
}

export interface ResourceIntel {
  fleet: FleetGroup[];
  utilizationPct: number;
  committed: number;
  available: number;
  total: number;
  recommendations: RepositionRec[];
}

export function buildResourceIntel(state: OpsState): ResourceIntel {
  const byType = new Map<ResourceType, OpsResource[]>();
  for (const r of state.resources) {
    const list = byType.get(r.type) ?? [];
    list.push(r);
    byType.set(r.type, list);
  }

  const fleet: FleetGroup[] = [...byType.entries()]
    .map(([type, list]) => {
      const statuses: Record<OpsResourceStatus, number> = {
        available: 0,
        enroute: 0,
        onscene: 0,
        returning: 0,
      };
      for (const r of list) statuses[r.status] += 1;
      return {
        type,
        label: RESOURCE_META[type].label,
        total: list.length,
        available: statuses.available,
        committed: list.length - statuses.available,
        statuses,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const total = state.resources.length;
  const committed = state.resources.filter((r) => r.status !== "available").length;

  // Reposition recommendations: unresourced active incidents → nearest free unit
  // of a type the response template calls for.
  const recommendations: RepositionRec[] = [];
  const needy = state.incidents
    .filter(
      (i) =>
        i.status !== "closed" &&
        i.assignedResourceIds.length === 0 &&
        (i.status === "detected" || i.status === "verified" || i.status === "responding")
    )
    .sort((a, b) => ({ severe: 0, high: 1, moderate: 2, low: 3 }[a.severity] - { severe: 0, high: 1, moderate: 2, low: 3 }[b.severity]));

  for (const inc of needy) {
    const wantTypes = (Object.keys(INCIDENT_CATALOG[inc.type].response.resources) as ResourceType[]).filter(
      (t) => RESOURCE_META[t]?.mobile
    );
    for (const wt of wantTypes.slice(0, 1)) {
      const pool = state.resources.filter((r) => r.type === wt && r.status === "available");
      if (!pool.length) continue;
      const nearest = pool
        .map((r) => ({ r, km: haversineKm(r.lat, r.lon, inc.lat, inc.lon) }))
        .sort((a, b) => a.km - b.km)[0];
      recommendations.push({
        id: `rep-${inc.id}-${wt}`,
        resourceId: nearest.r.id,
        resourceLabel: `${nearest.r.label} ${nearest.r.id}`,
        incidentId: inc.id,
        incidentTitle: `${prettyCause(inc.type)} · ${inc.corridor}`,
        distanceKm: Math.round(nearest.km * 10) / 10,
        reason: `Nearest free ${RESOURCE_META[wt].label.toLowerCase()} — ${Math.round(nearest.km * 10) / 10} km away`,
        priority: inc.severity === "severe" || inc.severity === "high" ? "high" : "med",
      });
    }
    if (recommendations.length >= 6) break;
  }

  return {
    fleet,
    utilizationPct: total ? Math.round((committed / total) * 100) : 0,
    committed,
    available: total - committed,
    total,
    recommendations,
  };
}
