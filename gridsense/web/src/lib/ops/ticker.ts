// Client-only ops clock. Advances the operating picture so the twin feels live:
// resources travel and arrive, incidents progress through their lifecycle and
// clear, and a fresh incident is injected every so often. Deterministic seed +
// post-mount ticking keeps SSR/hydration stable (nothing here runs on the server).

import { getOpsState, mutate } from "./store";
import { getNetwork } from "@/lib/sim/network";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import type { OpsState, OpsIncident, Severity, IncidentType } from "./types";
import type { PlanScenario } from "@/lib/sim/planScenario";

const WALL_INTERVAL_MS = 1000;
const OPS_SECONDS_PER_TICK = 20; // 1 wall second = 20 ops seconds
const INJECT_EVERY_OPS_SEC = 110;

let timer: ReturnType<typeof setInterval> | null = null;
let injectAccum = 0;

const INJECT_TYPES: IncidentType[] = [
  "vehicle_breakdown",
  "minor_accident",
  "bus_breakdown",
  "waterlogging",
  "signal_failure",
  "truck_breakdown",
];
const SEVERITIES: Severity[] = ["low", "moderate", "high", "severe"];

function buildScenarioForEdge(edgeId: string, distOnEdge: number, type: IncidentType, severity: Severity): PlanScenario {
  const net = getNetwork();
  const edge = net.edge(edgeId);
  const p = net.centreAt(edgeId, distOnEdge);
  const spec = INCIDENT_CATALOG[type];
  const lanes = net.laneCount(edgeId);
  const fullBlockage = spec.closesRoad && (severity === "high" || severity === "severe");
  const durMin = spec.durationMin[0] + (spec.durationMin[1] - spec.durationMin[0]) * 0.4;
  return {
    edgeId,
    distOnEdge,
    incidentType: type,
    severity,
    lanesAffected: fullBlockage ? lanes : Math.min(spec.defaultLanes || 1, Math.max(1, lanes - 1)),
    fullBlockage,
    durationSec: durMin * 60,
    snappedLat: p.lat,
    snappedLon: p.lon,
    snapDistanceM: 0,
    edgeName: edge?.name ?? "road",
  };
}

function injectRandomIncident(s: OpsState): void {
  const net = getNetwork();
  const edges = net.edges;
  if (!edges.length) return;
  const edge = edges[Math.floor(Math.random() * edges.length)];
  const dist = net.edgeLength(edge.id) * (0.3 + Math.random() * 0.4);
  const type = INJECT_TYPES[Math.floor(Math.random() * INJECT_TYPES.length)];
  const severity = SEVERITIES[Math.floor(Math.random() * (type === "signal_failure" ? 3 : SEVERITIES.length))];
  const scenario = buildScenarioForEdge(edge.id, dist, type, severity);
  const id = `INC-${s.seq}`;
  s.seq += 1;
  const inc: OpsIncident = {
    id,
    type,
    severity,
    status: "detected",
    title: `${INCIDENT_CATALOG[type].label} · ${edge.name}`,
    corridor: edge.name,
    lat: scenario.snappedLat,
    lon: scenario.snappedLon,
    edgeId: edge.id,
    scenario,
    detectedAt: s.clockMs,
    etaClearMin: Math.round(scenario.durationSec / 60),
    predictedDurationMin: Math.round(scenario.durationSec / 60),
    requiresClosure: scenario.fullBlockage,
    assignedResourceIds: [],
    taskIds: [],
    deploymentIds: [],
    timeline: [{ t: s.clockMs, label: "Detected via ASTraM feed" }],
    escalation: "low",
    source: "manual",
  };
  s.incidents.unshift(inc);
}

function advance(s: OpsState, dtSec: number): void {
  s.clockMs += dtSec * 1000;
  const dtMin = dtSec / 60;

  // Resources in transit close on their target.
  for (const r of s.resources) {
    if (r.status === "enroute" && r.etaMin != null) {
      r.etaMin = Math.max(0, r.etaMin - dtMin);
      if (r.etaMin <= 0) {
        r.status = "onscene";
        const inc = s.incidents.find((i) => i.id === r.assignedIncidentId);
        if (inc) {
          r.lat = inc.lat;
          r.lon = inc.lon;
          inc.timeline.push({ t: s.clockMs, label: `${r.label} on scene` });
        }
      }
    } else if (r.status === "returning" && r.etaMin != null) {
      r.etaMin = Math.max(0, r.etaMin - dtMin);
      if (r.etaMin <= 0) {
        r.status = "available";
        r.assignedIncidentId = undefined;
        r.etaMin = undefined;
      }
    }
  }

  // Incident lifecycle.
  for (const inc of s.incidents) {
    if (inc.status === "closed") continue;
    const ageMin = (s.clockMs - inc.detectedAt) / 60000;

    if (inc.status === "detected" && ageMin > 1.5) {
      inc.status = "verified";
      inc.timeline.push({ t: s.clockMs, label: "Verified by control room" });
    }

    const onScene = inc.assignedResourceIds.some(
      (rid) => s.resources.find((r) => r.id === rid)?.status === "onscene"
    );
    if (inc.status === "responding" && onScene) {
      inc.status = "managed";
      inc.timeline.push({ t: s.clockMs, label: "On-scene management underway" });
    }

    if (inc.status === "responding" || inc.status === "managed" || inc.status === "clearing") {
      inc.etaClearMin = Math.max(0, (inc.etaClearMin ?? 0) - dtMin);
      if (inc.status !== "clearing" && (inc.etaClearMin ?? 0) < 5) {
        inc.status = "clearing";
        inc.timeline.push({ t: s.clockMs, label: "Clearance underway" });
      }
      if (inc.status === "clearing" && (inc.etaClearMin ?? 0) <= 0) {
        inc.status = "closed";
        inc.timeline.push({ t: s.clockMs, label: "Incident cleared" });
        // free resources + stand down deployments
        for (const rid of inc.assignedResourceIds) {
          const r = s.resources.find((x) => x.id === rid);
          if (r) {
            r.status = "returning";
            r.etaMin = 3;
          }
        }
        for (const did of inc.deploymentIds) {
          const d = s.deployments.find((x) => x.id === did);
          if (d) d.status = "stood_down";
        }
      }
    }
  }

  // Occasionally inject a new incident.
  injectAccum += dtSec;
  if (injectAccum >= INJECT_EVERY_OPS_SEC) {
    injectAccum = 0;
    if (s.incidents.filter((i) => i.status !== "closed").length < 12) {
      injectRandomIncident(s);
    }
  }
}

export function startTicker(): void {
  if (timer || typeof window === "undefined") return;
  mutate((s) => {
    s.running = true;
  });
  timer = setInterval(() => {
    if (document.hidden) return; // pause when tab not visible
    mutate((s) => advance(s, OPS_SECONDS_PER_TICK));
  }, WALL_INTERVAL_MS);
}

export function stopTicker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (getOpsState().running) {
    mutate((s) => {
      s.running = false;
    });
  }
}
