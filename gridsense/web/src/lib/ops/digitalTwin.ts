// Digital Twin 2.0 analytics — operational-state intelligence (NOT vehicle-level;
// that's the protected /simulation). Watches the live ops picture for emerging
// bottlenecks, incident clustering, and resource shortfall.

import { prettyCause } from "@/lib/ui";
import type { OpsState } from "./types";

export interface EmergingRisk {
  id: string;
  level: "watch" | "warning" | "critical";
  title: string;
  detail: string;
  incidentId?: string;
}

export function detectEmergingRisks(state: OpsState): EmergingRisk[] {
  const risks: EmergingRisk[] = [];
  const active = state.incidents.filter((i) => i.status !== "closed");

  // 1. Escalating, unresourced incidents.
  for (const i of active) {
    const ageMin = (state.clockMs - i.detectedAt) / 60000;
    if (
      (i.escalation === "critical" || i.escalation === "high") &&
      i.assignedResourceIds.length === 0 &&
      ageMin > 3
    ) {
      risks.push({
        id: `risk-unres-${i.id}`,
        level: i.escalation === "critical" ? "critical" : "warning",
        title: `${prettyCause(i.type)} on ${i.corridor} unresourced ${Math.round(ageMin)}m`,
        detail: "Queue is growing with no units assigned — dispatch now to prevent spillover.",
        incidentId: i.id,
      });
    }
  }

  // 2. Corridor clustering (multiple active incidents on one corridor).
  const byCorridor = new Map<string, number>();
  for (const i of active) byCorridor.set(i.corridor, (byCorridor.get(i.corridor) ?? 0) + 1);
  for (const [corridor, n] of byCorridor) {
    if (n >= 2)
      risks.push({
        id: `risk-cluster-${corridor}`,
        level: "warning",
        title: `${n} concurrent incidents on ${corridor}`,
        detail: "Compounding load on a single corridor — consider a corridor-wide diversion.",
      });
  }

  // 3. Resource shortfall projection.
  if (state.metrics.resourceUtilizationPct >= 75) {
    risks.push({
      id: "risk-fleet",
      level: state.metrics.resourceUtilizationPct >= 90 ? "critical" : "warning",
      title: `Fleet ${state.metrics.resourceUtilizationPct}% committed`,
      detail: `${state.metrics.resourcesAvailable} units free — a new severe incident may outrun available response.`,
    });
  }

  const order = { critical: 0, warning: 1, watch: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]).slice(0, 8);
}
