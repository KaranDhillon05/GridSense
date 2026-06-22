// Pure derivations over ops state: metrics rollup + escalation level.
// Shared by seed.ts, store.ts and ticker.ts (kept dependency-free to avoid cycles).

import type {
  OpsIncident,
  OpsResource,
  Deployment,
  Task,
  OpsMetrics,
  OpsState,
} from "./types";
import type { Severity } from "@/lib/sim/types";

export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  severe: 3,
};

export function isActive(i: OpsIncident): boolean {
  return i.status !== "closed";
}

/** Heuristic escalation: severity, plus a bump when an active incident is still
 *  unresourced (queue keeps growing). */
export function escalationFor(
  i: OpsIncident
): "low" | "medium" | "high" | "critical" {
  let rank = SEVERITY_RANK[i.severity];
  const unresourced =
    i.assignedResourceIds.length === 0 &&
    (i.status === "detected" || i.status === "verified");
  if (unresourced) rank += 1;
  if (i.requiresClosure && i.status !== "closed") rank += 0.5;
  if (rank >= 3) return "critical";
  if (rank >= 2) return "high";
  if (rank >= 1) return "medium";
  return "low";
}

export function computeMetrics(
  incidents: OpsIncident[],
  resources: OpsResource[],
  deployments: Deployment[],
  tasks: Task[]
): OpsMetrics {
  const active = incidents.filter(isActive);
  const severe = active.filter(
    (i) => i.severity === "severe" || i.severity === "high"
  );
  const committed = resources.filter((r) => r.status !== "available").length;
  const available = resources.filter((r) => r.status === "available").length;
  const total = Math.max(1, resources.length);

  const corridors = new Set(severe.map((i) => i.corridor).filter(Boolean));

  // Vehicle-hours saved = sum of accepted wind-tunnel results (incidents that
  // have a simulated result AND at least one active deployment off the back of it).
  let saved = 0;
  for (const i of incidents) {
    if (i.windTunnel && i.deploymentIds.length > 0) {
      saved += i.windTunnel.vehicleHoursSaved;
    }
  }

  const enroute = resources.filter((r) => r.status === "enroute" && r.etaMin != null);
  const avgResponse = enroute.length
    ? enroute.reduce((s, r) => s + (r.etaMin ?? 0), 0) / enroute.length
    : 6;

  return {
    activeIncidents: active.length,
    severeCount: severe.length,
    resourcesCommitted: committed,
    resourcesAvailable: available,
    resourceUtilizationPct: Math.round((committed / total) * 100),
    criticalCorridors: corridors.size,
    vehicleHoursSavedToday: Math.round(saved * 10) / 10,
    avgResponseMin: Math.round(avgResponse * 10) / 10,
    activeDeployments: deployments.filter((d) => d.status === "active").length,
    openTasks: tasks.filter((t) => t.status !== "done").length,
  };
}

/** Recompute the derived fields (escalation + metrics) on a state object in place
 *  and return it. Mutates incidents' `escalation`. */
export function rederive(state: OpsState): OpsState {
  for (const i of state.incidents) i.escalation = escalationFor(i);
  state.metrics = computeMetrics(
    state.incidents,
    state.resources,
    state.deployments,
    state.tasks
  );
  return state;
}
