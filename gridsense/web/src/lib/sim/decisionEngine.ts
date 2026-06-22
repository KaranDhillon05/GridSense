// Decision engine: given an active incident + live congestion, produces a
// ranked response plan — diversion corridors with traffic-split shares, a signal
// plan, a manpower/equipment plan, a barricade plan, field actions and a
// projected delay reduction. It only *recommends*; the UI applies it via Engine
// methods. The rule output can optionally be narrated by lib/ai.ts.

import { diversionRoutes } from "./routing";
import type { SimNetwork } from "./network";
import { INCIDENT_CATALOG, SEVERITY_DURATION_MULT, type DiversionStrategy } from "./incidents";
import { RESOURCE_META } from "./resources";
import type { EdgeCongestion, Incident, ResourceType } from "./types";

export interface DiversionOption {
  rank: number;
  share: number; // 0..1 traffic share
  edgeIds: string[];
  roadNames: string[];
  lengthKm: number;
  label: string;
}

export interface ResponsePlan {
  incidentId: string;
  headline: string;
  severity: string;
  diversionStrategy: DiversionStrategy;
  diversions: DiversionOption[];
  signalPlan: { action: string; junctions: string[] };
  manpower: { type: ResourceType; label: string; count: number }[];
  barricades: number;
  actions: string[];
  projectedDelayReductionPct: number;
  expectedClearanceMin: number;
}

const SPLIT_TEMPLATES: Record<number, number[]> = {
  1: [1],
  2: [0.6, 0.4],
  3: [0.45, 0.35, 0.2],
};

export function buildResponsePlan(
  net: SimNetwork,
  inc: Incident,
  congestion: Map<string, EdgeCongestion>
): ResponsePlan {
  const spec = INCIDENT_CATALOG[inc.type];
  const edge = net.edge(inc.edgeId);
  const fromNode = edge?.from ?? "";
  const toNode = edge?.to ?? "";

  // candidate diversion corridors that avoid the incident edge (and its reverse).
  // Widen the OD to an upstream/downstream node so the plan diverts *before* the
  // blockage and rejoins *after* it (realistic corridors), with fallbacks.
  const avoid = new Set<string>([inc.edgeId]);
  const rev = net.reverseId(inc.edgeId);
  if (rev) avoid.add(rev);
  let raw: ReturnType<typeof diversionRoutes> = [];
  if (edge && fromNode && toNode) {
    const upstream = (net.incoming.get(fromNode) ?? []).filter((e) => !avoid.has(e.id))[0]?.from ?? fromNode;
    const downstream =
      (net.outgoing.get(toNode) ?? []).filter((e) => !avoid.has(e.id) && e.id !== edge.id)[0]?.to ?? toNode;
    const utilMap = new Map([...congestion.entries()].map(([id, c]) => [id, c.utilization]));
    raw = diversionRoutes(net, upstream, downstream, avoid, 3, utilMap);
    if (!raw.length) raw = diversionRoutes(net, fromNode, downstream, avoid, 3, utilMap);
    if (!raw.length) raw = diversionRoutes(net, fromNode, toNode, avoid, 3, utilMap);
  }

  // prefer corridors with spare capacity (lower live utilization)
  const scored = raw
    .map((r) => {
      const util =
        r.edge_ids.reduce((s, id) => s + (congestion.get(id)?.utilization ?? 0), 0) /
        Math.max(1, r.edge_ids.length);
      const lengthKm = r.edge_ids.reduce((s, id) => s + (net.edge(id)?.length_m ?? 0), 0) / 1000;
      return { r, util, lengthKm };
    })
    .sort((a, b) => a.util * 0.7 + a.lengthKm * 0.3 - (b.util * 0.7 + b.lengthKm * 0.3));

  const n = Math.min(scored.length, 3);
  const split = SPLIT_TEMPLATES[n] ?? [1];
  const diversions: DiversionOption[] = scored.slice(0, n).map((s, i) => {
    const roadNames = uniqueNames(s.r.edge_ids.map((id) => net.edge(id)?.name ?? id));
    return {
      rank: i + 1,
      share: split[i],
      edgeIds: s.r.edge_ids,
      roadNames,
      lengthKm: Math.round(s.lengthKm * 10) / 10,
      label: roadNames.slice(0, 3).join(" → "),
    };
  });

  // manpower / equipment from the response template, scaled by severity
  const sevMult = SEVERITY_DURATION_MULT[inc.severity];
  const manpower = (Object.entries(spec.response.resources) as [ResourceType, number][])
    .filter(([t]) => RESOURCE_META[t].mobile)
    .map(([type, count]) => ({
      type,
      label: RESOURCE_META[type].label,
      count: Math.max(1, Math.round(count * (sevMult > 1.4 ? 1.3 : 1))),
    }));
  const barricades =
    (spec.response.resources.barricade ?? 0) + (spec.response.resources.cones ?? 0);

  // projected delay reduction: bigger when the incident closes the road, scaled
  // by how much spare capacity the diversion corridors offer.
  const spare = diversions.length
    ? 1 - diversions.reduce((s, d) => s + (congestion.get(d.edgeIds[0])?.utilization ?? 0.3), 0) / diversions.length
    : 0.2;
  const base = inc.fullBlockage ? 55 : 32;
  const projectedDelayReductionPct = Math.round(Math.max(8, Math.min(70, base * (0.5 + spare))));

  const onSceneBoost = manpower.reduce((s, m) => s + RESOURCE_META[m.type].clearanceBoost * m.count, 0);
  const expectedClearanceMin = Math.round((inc.durationSec / 60) / (1 + onSceneBoost));

  return {
    incidentId: inc.id,
    headline: `${spec.label} · ${edge?.name ?? "road"}`,
    severity: inc.severity,
    diversionStrategy: spec.response.diversion,
    diversions,
    signalPlan: { action: spec.response.signalAction, junctions: [toNode, fromNode].filter(Boolean) },
    manpower,
    barricades,
    actions: spec.response.actions,
    projectedDelayReductionPct,
    expectedClearanceMin,
  };
}

function uniqueNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) if (!out.length || out[out.length - 1] !== n) out.push(n);
  return out;
}
