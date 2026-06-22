// AI Operations Brain — deterministic backbone + snapshot serializer.
//
// deterministicBrief() is a pure, rule-based situation report that ALWAYS works
// (no LLM, no network). It is the server-side fallback for /api/brain AND the
// instant client render before the LLM responds. When a key is present the LLM
// narrates/reprioritizes this same backbone rather than inventing facts. Both the
// client and the route operate on the same compact BrainSnapshot so the fallback
// is identical everywhere.

import { prettyCause } from "@/lib/ui";
import type { OpsState, OpsBrief, OpsRecommendation, OpsMetrics, Severity } from "./types";

const SEV_RANK: Record<string, number> = { low: 0, moderate: 1, high: 2, severe: 3 };
const ESC_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface BrainIncident {
  id: string;
  type: string;
  severity: string;
  status: string;
  corridor: string;
  escalation: string;
  etaClearMin?: number;
  assigned: number;
  ageMin: number;
  simEligible: boolean;
}

export interface BrainSnapshot {
  clock: string;
  metrics: OpsMetrics;
  incidents: BrainIncident[];
}

export function toBrainSnapshot(state: OpsState): BrainSnapshot {
  return {
    clock: new Date(state.clockMs).toISOString().slice(11, 16),
    metrics: state.metrics,
    incidents: state.incidents
      .filter((i) => i.status !== "closed")
      .map((i) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        status: i.status,
        corridor: i.corridor,
        escalation: i.escalation,
        etaClearMin: i.etaClearMin != null ? Math.round(i.etaClearMin) : undefined,
        assigned: i.assignedResourceIds.length,
        ageMin: Math.round((state.clockMs - i.detectedAt) / 60000),
        simEligible: i.edgeId != null,
      })),
  };
}

function criticality(i: BrainIncident): number {
  return (ESC_RANK[i.escalation] ?? 0) * 4 + (SEV_RANK[i.severity] ?? 0) + (i.assigned === 0 ? 1 : 0);
}

export function deterministicBrief(snap: BrainSnapshot): OpsBrief {
  const active = snap.incidents;
  const m = snap.metrics;
  const ranked = [...active].sort((a, b) => criticality(b) - criticality(a));
  const top = ranked[0];

  const headline = !active.length
    ? "All clear — no active incidents"
    : `${m.severeCount} high-impact ${m.severeCount === 1 ? "incident" : "incidents"} · primary concern ${top.corridor}`;

  const situation = active.length
    ? `${m.activeIncidents} active, ${m.activeDeployments} deployments running, ${m.resourcesAvailable} units free (${m.resourceUtilizationPct}% committed). Avg response ${m.avgResponseMin} min.`
    : "Network nominal. All units available.";

  const priorities = ranked.slice(0, 3).map((i) => {
    const eta = i.etaClearMin != null ? ` · clears ~${i.etaClearMin}m` : "";
    return `${prettyCause(i.type)} on ${i.corridor} (${i.escalation})${eta}`;
  });

  const recommendations: OpsRecommendation[] = [];
  for (const i of ranked) {
    if (
      i.assigned === 0 &&
      (i.status === "detected" || i.status === "verified") &&
      recommendations.length < 4
    ) {
      recommendations.push({
        id: `rec-${i.id}`,
        incidentId: i.id,
        action: `Dispatch response to ${prettyCause(i.type)} · ${i.corridor}`,
        rationale: i.simEligible
          ? "Unresourced, inside the CBD twin — run the Wind Tunnel and deploy the best plan."
          : "Unresourced active incident — assign units and verify on the ground.",
        priority: i.severity === "severe" || i.severity === "high" ? "high" : "med",
      });
    }
  }

  const escalations: string[] = [];
  for (const i of ranked) {
    if (i.escalation === "critical")
      escalations.push(
        `${prettyCause(i.type)} on ${i.corridor} is critical — consider additional units / barricade team.`
      );
  }
  if (m.resourceUtilizationPct >= 70)
    escalations.push(
      `Fleet ${m.resourceUtilizationPct}% committed — limited reserve for new incidents.`
    );

  return {
    headline,
    situation,
    priorities,
    recommendations,
    escalations,
    source: "rule",
    generatedAt: Date.now(),
  };
}

/** Build the LLM prompt body from a snapshot (used by /api/brain). */
export function snapshotToPrompt(snap: BrainSnapshot): string {
  const lines = snap.incidents.map(
    (i) =>
      `- ${i.id} ${prettyCause(i.type)} | ${i.severity} | ${i.status} | corridor ${i.corridor} | escalation ${i.escalation} | ${i.assigned} units assigned | age ${i.ageMin}m${i.etaClearMin != null ? ` | ~${i.etaClearMin}m to clear` : ""}${i.simEligible ? " | sim-eligible" : ""}`
  );
  const m = snap.metrics;
  return `Current time ${snap.clock}.
Metrics: ${m.activeIncidents} active incidents (${m.severeCount} high-impact), ${m.activeDeployments} active deployments, ${m.resourcesCommitted}/${m.resourcesCommitted + m.resourcesAvailable} resources committed (${m.resourceUtilizationPct}%), ${m.criticalCorridors} critical corridors, avg response ${m.avgResponseMin} min, ${m.vehicleHoursSavedToday} vehicle-hours saved today, ${m.openTasks} open tasks.
Active incidents:
${lines.join("\n") || "(none)"}`;
}

export type { Severity };
