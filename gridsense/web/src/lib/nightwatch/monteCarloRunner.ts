// Headless Monte Carlo batch runner for Night Watch. Creates two Engine
// instances per scenario (baseline no-intervention vs. full response), steps
// them synchronously (no rAF, no React), and returns aggregated metrics.
// Yields to the event loop every 10 iterations so the browser stays responsive.

import { Engine } from "@/lib/sim/engine";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { getNetwork } from "@/lib/sim/network";
import { buildResponsePlan } from "@/lib/sim/decisionEngine";
import { generateScenario } from "./scenarioGenerator";
import type { NWRunResult, NWScenario } from "./types";

// Coarse timestep for batch sims — 8× faster than the 0.2s live dt.
const BATCH_DT = 1.0;
// Base seed for the demand RNG. Each run offsets this so demand realisations vary
// across the Monte Carlo (within a run, baseline + response stay paired on the
// same seed so the comparison is apples-to-apples).
const BATCH_DEMAND_SEED = 42;
// Spawn rate for batch sims — same as live sim.
const BATCH_SPAWN = 75;
// Max vehicle cap for batch — lower than live to reduce per-step cost.
const BATCH_MAX_VEHICLES = 200;
// Warm-up steps before injecting incident.
const WARMUP_STEPS = 60;

function countCongestedNeighbors(engine: Engine, edgeId: string): number {
  const cong = engine.congestionByEdge();
  const net = engine.net;
  const edge = net.edge(edgeId);
  if (!edge) return 0;
  // BFS up to 3 hops from incident edge — count congested edges.
  const visited = new Set<string>([edgeId]);
  const queue: string[] = [edgeId];
  let count = 0;
  let depth = 0;
  let nextBatch: string[] = [];
  while (queue.length && depth < 3) {
    for (const eid of queue) {
      const e = net.edge(eid);
      if (!e) continue;
      for (const out of net.outgoing.get(e.to) ?? []) {
        if (visited.has(out.id)) continue;
        visited.add(out.id);
        const c = cong.get(out.id);
        if (c && (c.utilization > 0.7 || c.blocked)) {
          count++;
          nextBatch.push(out.id);
        }
      }
      for (const inc of net.incoming.get(e.from) ?? []) {
        if (visited.has(inc.id)) continue;
        visited.add(inc.id);
        const c = cong.get(inc.id);
        if (c && (c.utilization > 0.7 || c.blocked)) {
          count++;
          nextBatch.push(inc.id);
        }
      }
    }
    queue.length = 0;
    queue.push(...nextBatch);
    nextBatch = [];
    depth++;
  }
  return count;
}

function applyFullResponse(engine: Engine, incidentId: string, scenario: NWScenario) {
  const spec = INCIDENT_CATALOG[scenario.incidentType];
  // Apply the decision engine's ranked diversion corridor so the simulated
  // response matches what GridSense recommends — previously the ranked corridors
  // were computed for display but never influenced the sim.
  const inc = engine.activeIncidents().find((i) => i.id === incidentId);
  const corridorEdges = inc
    ? buildResponsePlan(engine.net, inc, engine.congestionByEdge()).diversions[0]?.edgeIds
    : undefined;
  engine.applyDiversion(incidentId, spec.response.diversion, corridorEdges);
  engine.applySignalPlan(incidentId);
  for (const [rType, count] of Object.entries(spec.response.resources)) {
    for (let i = 0; i < (count as number); i++) {
      engine.dispatchResource(rType as Parameters<Engine["dispatchResource"]>[0], incidentId);
    }
  }
}

async function runScenario(scenario: NWScenario, demandSeed: number): Promise<NWRunResult> {
  const net = getNetwork();
  const edgeLen = net.edgeLength(scenario.edgeId);
  const distOnEdge = edgeLen / 2;
  const simSteps = Math.ceil((scenario.durationMin * 60 * 2) / BATCH_DT);
  const cappedSteps = Math.min(simSteps, 3600); // cap at 1h sim-time

  // Baseline: no interventions. Paired with the response on the same demand seed.
  const baseline = new Engine({
    seed: demandSeed,
    spawnPerMin: BATCH_SPAWN,
    applyInterventions: false,
    maxVehicles: BATCH_MAX_VEHICLES,
  });
  // Response: with full interventions, same demand realisation as the baseline.
  const response = new Engine({
    seed: demandSeed,
    spawnPerMin: BATCH_SPAWN,
    applyInterventions: true,
    maxVehicles: BATCH_MAX_VEHICLES,
  });

  // Warm up both engines with the same demand.
  for (let i = 0; i < WARMUP_STEPS; i++) {
    baseline.step(BATCH_DT);
    response.step(BATCH_DT);
  }

  // Inject the same incident on both (baseline gets no response).
  const spec = INCIDENT_CATALOG[scenario.incidentType];
  baseline.addIncident({
    type: scenario.incidentType,
    edgeId: scenario.edgeId,
    distOnEdge,
    severity: scenario.severity,
    lanesAffected: scenario.lanesAffected,
    durationSec: scenario.durationMin * 60,
  });
  const respInc = response.addIncident({
    type: scenario.incidentType,
    edgeId: scenario.edgeId,
    distOnEdge,
    severity: scenario.severity,
    lanesAffected: scenario.lanesAffected,
    durationSec: scenario.durationMin * 60,
  });

  // Apply response immediately.
  applyFullResponse(response, respInc.id, scenario);

  // Track when incident clears in response sim.
  let clearanceTimeSec = scenario.durationMin * 60;
  let responseCleared = false;

  // Count resources dispatched.
  const totalResourcesRequested = Object.values(spec.response.resources)
    .reduce((s: number, v) => s + (v as number), 0);
  const resourcesSnapshot = response.fleetUsage();
  const resourcesSatisfied = resourcesSnapshot.reduce((s, r) => {
    const requested = (spec.response.resources as Record<string, number>)[r.type] ?? 0;
    return s + Math.min(r.inUse, requested);
  }, 0);

  // Step both engines.
  for (let i = 0; i < cappedSteps; i++) {
    baseline.step(BATCH_DT);
    response.step(BATCH_DT);

    if (!responseCleared) {
      const active = response.activeIncidents().find(inc => inc.id === respInc.id);
      if (!active) {
        clearanceTimeSec = (WARMUP_STEPS + i) * BATCH_DT;
        responseCleared = true;
      }
    }
  }

  const baseMetrics = baseline.snapshot().metrics;
  const respMetrics = response.snapshot().metrics;
  const baseDelay = baseMetrics.totalDelayVehMin;
  const respDelay = respMetrics.totalDelayVehMin;
  const improvementPct = baseDelay > 0
    ? Math.min(100, Math.max(0, ((baseDelay - respDelay) / baseDelay) * 100))
    : 0;

  const baseQueue = baseMetrics.maxQueueM;
  const respQueue = respMetrics.maxQueueM;
  const queueGrowthM = Math.max(0, baseQueue - respQueue);
  const spilloverEdgeCount = countCongestedNeighbors(baseline, scenario.edgeId);

  return {
    scenario,
    baselineMetrics: baseMetrics,
    responseMetrics: respMetrics,
    improvementPct,
    queueGrowthM,
    spilloverEdgeCount,
    clearanceTimeSec,
    resourcesRequested: totalResourcesRequested,
    resourcesSatisfied,
  };
}

export async function runBatch(
  count: 100 | 500 | 1000,
  onProgress: (pct: number) => void
): Promise<NWRunResult[]> {
  const results: NWRunResult[] = [];
  const BATCH = 10; // yield every 10 iterations

  for (let i = 0; i < count; i++) {
    // Offset seeds so every run draws a distinct incident AND a distinct demand
    // realisation — a true Monte Carlo over both, not just the incident.
    const seed = 1000 + i * 7;
    const scenario = generateScenario(seed);
    const result = await runScenario(scenario, BATCH_DEMAND_SEED + i);
    results.push(result);

    if ((i + 1) % BATCH === 0) {
      onProgress(Math.round(((i + 1) / count) * 100));
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  onProgress(100);
  return results;
}
