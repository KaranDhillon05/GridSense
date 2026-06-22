// Deterministic seed for the live operating picture.
//
// Builds a believable "current operations" snapshot from the real ASTraM corpus
// (events_slim.json), biased toward the simulated CBD twin so several incidents
// are Wind-Tunnel-eligible. Deterministic (fixed RNG, no Date.now / no random)
// so SSR and client hydration agree and the demo is reproducible.

import eventsSlim from "@/data/events_slim.json";
import { getNetwork } from "@/lib/sim/network";
import {
  pickIncidentType,
  mapEventToScenario,
  checkServiceArea,
} from "@/lib/sim/planScenario";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { RESOURCE_META, DEPOTS } from "@/lib/sim/resources";
import type { EventInput } from "@/lib/gridsense";
import type { Severity, IncidentType, ResourceType } from "@/lib/sim/types";
import type {
  OpsState,
  OpsIncident,
  OpsResource,
  Deployment,
  Task,
  IncidentStatus,
  TimelineEntry,
} from "./types";
import { rederive, escalationFor } from "./derive";

// Notional shift clock (ms-of-day). The ticker advances this after mount.
export const BASE_CLOCK_MS = (10 * 60 + 32) * 60 * 1000; // 10:32

type RawEvent = {
  id: string;
  event_cause: string;
  latitude: number;
  longitude: number;
  corridor?: string;
  zone?: string | null;
  priority?: string;
  requires_road_closure?: number | boolean;
  status?: string;
  impact_score?: number;
  tier?: string;
  predicted_duration_min?: number;
};

const EVENTS = eventsSlim as RawEvent[];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tierToSeverity(tier?: string): Severity {
  switch (tier) {
    case "Severe":
      return "severe";
    case "High":
      return "high";
    case "Moderate":
      return "moderate";
    default:
      return "low";
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function toEventInput(e: RawEvent): EventInput {
  return {
    cause: e.event_cause,
    corridor: e.corridor ?? "Non-corridor",
    requires_road_closure: !!e.requires_road_closure,
    priority: e.priority,
    lat: e.latitude,
    lon: e.longitude,
  };
}

/** A short, plausible "active diversion" polyline near an incident edge. */
function simpleDiversionGeometry(edgeId: string): { geometry: number[][]; edgeIds: string[] } | null {
  const net = getNetwork();
  const e0 = net.edge(edgeId);
  if (!e0) return null;
  const rev = net.reverseId(edgeId);
  const avoid = new Set([edgeId, rev].filter(Boolean) as string[]);
  const edgeIds: string[] = [];
  const geometry: number[][] = [];
  let node = e0.from;
  for (let hop = 0; hop < 3; hop++) {
    const outs = (net.outgoing.get(node) ?? []).filter((x) => !avoid.has(x.id));
    if (!outs.length) break;
    const next = outs[0];
    avoid.add(next.id);
    edgeIds.push(next.id);
    for (const [lon, lat] of next.geometry) geometry.push([lon, lat]);
    node = next.to;
  }
  return geometry.length >= 2 ? { geometry, edgeIds } : null;
}

function nodeLatLon(nodeId: string): { lat: number; lon: number } | null {
  const n = getNetwork().nodes.get(nodeId);
  return n ? { lat: n.lat, lon: n.lon } : null;
}

// Status timeline spread so the board looks mid-shift, not freshly seeded.
const SEED_STATUSES: IncidentStatus[] = [
  "responding",
  "detected",
  "managed",
  "verified",
  "responding",
  "clearing",
  "detected",
];

export function seedOpsState(): OpsState {
  const rng = mulberry32(0x6c1d50c);
  const net = getNetwork();

  // Rank candidate events by impact, prefer those inside the CBD service area.
  const ranked = EVENTS.filter(
    (e) => e.latitude && e.longitude && (e.impact_score ?? 0) > 35
  )
    .map((e) => {
      const sa = checkServiceArea(toEventInput(e));
      return { e, inArea: sa.inServiceArea, snap: sa.snapDistanceM ?? 99999 };
    })
    .sort((a, b) => {
      // in-area first, then by impact
      if (a.inArea !== b.inArea) return a.inArea ? -1 : 1;
      return (b.e.impact_score ?? 0) - (a.e.impact_score ?? 0);
    });

  const cbd = ranked.filter((r) => r.inArea).slice(0, 6);
  const outside = ranked.filter((r) => !r.inArea).slice(0, 2);
  const chosen = [...cbd, ...outside];

  const incidents: OpsIncident[] = [];
  const resources: OpsResource[] = [];
  const deployments: Deployment[] = [];
  const tasks: Task[] = [];
  let seq = 1;

  chosen.forEach((cand, idx) => {
    const e = cand.e;
    const ei = toEventInput(e);
    const severity = tierToSeverity(e.tier);
    const type = pickIncidentType(ei, severity) as IncidentType;
    const status = SEED_STATUSES[idx % SEED_STATUSES.length];
    const scenarioDurMin = clamp(e.predicted_duration_min ?? 30, 12, 50);
    const scenario = cand.inArea
      ? mapEventToScenario(ei, { tier: e.tier ?? "Moderate", expected_duration_min: scenarioDurMin })
      : null;
    const lat = scenario?.snappedLat ?? e.latitude;
    const lon = scenario?.snappedLon ?? e.longitude;
    const detectedAt = BASE_CLOCK_MS - Math.round((6 + rng() * 40) * 60000);
    const corridor = e.corridor ?? "Non-corridor";
    const requiresClosure = !!e.requires_road_closure;

    const timeline: TimelineEntry[] = [
      { t: detectedAt, label: "Detected via ASTraM feed" },
    ];
    if (status !== "detected") timeline.push({ t: detectedAt + 120000, label: "Verified by control room" });
    if (status === "responding" || status === "managed" || status === "clearing")
      timeline.push({ t: detectedAt + 300000, label: "Units dispatched" });
    if (status === "clearing") timeline.push({ t: BASE_CLOCK_MS - 180000, label: "Clearance underway" });

    const etaClear =
      status === "clearing"
        ? clamp(Math.round(rng() * 6) + 3, 3, 10)
        : status === "closed"
          ? 0
          : Math.round(clamp(scenarioDurMin * (0.4 + rng() * 0.5), 5, 55));

    const inc: OpsIncident = {
      id: `INC-${String(100 + idx)}`,
      type,
      severity,
      status,
      title: `${INCIDENT_CATALOG[type].label} · ${corridor}`,
      corridor,
      lat,
      lon,
      edgeId: scenario?.edgeId,
      scenario: scenario ?? undefined,
      detectedAt,
      etaClearMin: etaClear,
      predictedDurationMin: Math.round(e.predicted_duration_min ?? scenarioDurMin),
      requiresClosure,
      assignedResourceIds: [],
      taskIds: [],
      deploymentIds: [],
      timeline,
      escalation: "low",
      source: "seed",
    };
    inc.escalation = escalationFor(inc);
    incidents.push(inc);
  });

  // --- Resource roster (deterministic placement at depot nodes) ------------
  const roster: Array<{ type: ResourceType; depotKey: keyof typeof DEPOTS; n: number }> = [
    { type: "officer", depotKey: "police", n: 15 },
    { type: "supervisor", depotKey: "police", n: 3 },
    { type: "rapid_response", depotKey: "police", n: 3 },
    { type: "tow_truck", depotKey: "tow", n: 5 },
    { type: "recovery_van", depotKey: "tow", n: 2 },
    { type: "ambulance", depotKey: "hospital", n: 3 },
    { type: "fire_engine", depotKey: "fire", n: 2 },
  ];

  let rcount = 1;
  for (const { type, depotKey, n } of roster) {
    const nodes = DEPOTS[depotKey] ?? [];
    for (let i = 0; i < n; i++) {
      const nodeId = nodes[i % Math.max(1, nodes.length)] ?? "";
      const pos = nodeLatLon(nodeId) ?? { lat: net.nodes.values().next().value!.lat, lon: net.nodes.values().next().value!.lon };
      resources.push({
        id: `${type === "officer" ? "OFF" : type === "tow_truck" ? "TOW" : type.slice(0, 3).toUpperCase()}-${rcount++}`,
        type,
        label: RESOURCE_META[type].label,
        status: "available",
        lat: pos.lat,
        lon: pos.lon,
        homeName: nodeId || "Depot",
        homeNode: nodeId,
      });
    }
  }

  // --- Assign a few resources + deployments + tasks to in-progress incidents
  const respondingIncidents = incidents.filter(
    (i) => i.status === "responding" || i.status === "managed" || i.status === "clearing"
  );
  let ti = 1;
  for (const inc of respondingIncidents) {
    const spec = INCIDENT_CATALOG[inc.type];
    const wantTypes = (Object.keys(spec.response.resources) as ResourceType[]).filter(
      (t) => RESOURCE_META[t].mobile
    );
    for (const wt of wantTypes.slice(0, 2)) {
      const r = resources.find((x) => x.type === wt && x.status === "available");
      if (!r) continue;
      r.status = inc.status === "clearing" ? "onscene" : "onscene";
      r.assignedIncidentId = inc.id;
      r.lat = inc.lat;
      r.lon = inc.lon;
      inc.assignedResourceIds.push(r.id);
    }
    // active diversion deployment (only inside the twin where we have an edge)
    if (inc.edgeId) {
      const div = simpleDiversionGeometry(inc.edgeId);
      if (div) {
        const dep: Deployment = {
          id: `DEP-${seq++}`,
          incidentId: inc.id,
          kind: "diversion",
          label: `Diversion · ${inc.corridor}`,
          edgeIds: div.edgeIds,
          geometry: div.geometry,
          status: "active",
          createdAt: inc.detectedAt + 300000,
        };
        deployments.push(dep);
        inc.deploymentIds.push(dep.id);
      }
    }
    // a couple of tasks from the response template
    for (const action of spec.response.actions.slice(0, 2)) {
      const task: Task = {
        id: `TSK-${ti++}`,
        incidentId: inc.id,
        title: action,
        status: inc.status === "clearing" ? "done" : "in_progress",
        createdAt: inc.detectedAt + 300000,
        completedAt: inc.status === "clearing" ? BASE_CLOCK_MS - 120000 : undefined,
      };
      tasks.push(task);
      inc.taskIds.push(task.id);
    }
  }

  // a few open tasks for freshly detected incidents
  for (const inc of incidents.filter((i) => i.status === "detected" || i.status === "verified")) {
    const task: Task = {
      id: `TSK-${ti++}`,
      incidentId: inc.id,
      title: `Verify & assess: ${INCIDENT_CATALOG[inc.type].label}`,
      status: "todo",
      createdAt: inc.detectedAt,
    };
    tasks.push(task);
    inc.taskIds.push(task.id);
  }

  const state: OpsState = {
    version: 1,
    clockMs: BASE_CLOCK_MS,
    running: false,
    incidents,
    resources,
    deployments,
    tasks,
    metrics: {
      activeIncidents: 0,
      severeCount: 0,
      resourcesCommitted: 0,
      resourcesAvailable: 0,
      resourceUtilizationPct: 0,
      criticalCorridors: 0,
      vehicleHoursSavedToday: 0,
      avgResponseMin: 0,
      activeDeployments: 0,
      openTasks: 0,
    },
    seq,
  };
  return rederive(state);
}
