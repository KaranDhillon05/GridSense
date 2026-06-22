// Deterministic regression oracle for the PROTECTED /simulation module.
//
// /simulation runs `new Engine({ seed:1337, spawnPerMin:30, applyInterventions:true })`
// with NO realism flag (see src/hooks/useSimulation.ts). The engine is fully
// deterministic (fixed seed, fixed DT), so its state after N steps is exact and
// reproducible. This script runs that exact configuration and prints a compact
// digest of vehicle positions + signal phases + metrics. Capture a baseline
// BEFORE touching engine.ts, then re-run after every change: the digest MUST be
// byte-identical. Any diff means a realism gate leaked into the legacy path.
//
//   node --import ./scripts/register.mjs scripts/snapshot-parity.mjs            # print digest
//   node --import ./scripts/register.mjs scripts/snapshot-parity.mjs --save     # write baseline
//   node --import ./scripts/register.mjs scripts/snapshot-parity.mjs --check    # compare to baseline

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

// Imported dynamically so the alias/TS loader hook is active first.
const { Engine } = await import("@/lib/sim/engine.ts");

const DT = 0.2;
const SEED = 1337;
const WARMUP = 220;
const EXTRA = 1200; // run well past warm-up so junction/connector/yield logic exercises

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = resolve(here, "simulation-baseline.json");

function round(n, d = 3) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function run() {
  // EXACT /simulation config: no realism flag, applyInterventions:true, no incidents.
  const eng = new Engine({ seed: SEED, spawnPerMin: 30, applyInterventions: true });
  for (let i = 0; i < WARMUP + EXTRA; i++) eng.step(DT);

  // Stable, fully-ordered serialization of the dynamic state.
  const vehicles = eng.vehicles
    .map((v) => ({
      id: v.id,
      edgeId: v.edgeId,
      lane: v.laneIndex,
      dist: round(v.distOnEdge, 2),
      speed: round(v.speed, 3),
      onConn: !!v.onConnector,
      connT: round(v.connectorT ?? 0, 2),
      routeIdx: v.routeIdx,
      lat: round(v.lat, 6),
      lon: round(v.lon, 6),
    }))
    .sort((a, b) => a.id - b.id);

  const snap = eng.snapshot();
  const signals = snap.signals
    .map((s) => ({ nodeId: s.nodeId, state: s.state, phase: s.phase }))
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));

  const m = snap.metrics;
  const metrics = {
    vehicleCount: snap.vehicleCount,
    avgSpeed: round(m.avgSpeedKmh ?? m.avgSpeed ?? 0),
    // include whatever scalar metrics exist, rounded, in key order
    ...Object.fromEntries(
      Object.entries(m)
        .filter(([, val]) => typeof val === "number")
        .map(([k, val]) => [k, round(val)])
        .sort(([a], [b]) => (a < b ? -1 : 1))
    ),
  };

  return { steps: WARMUP + EXTRA, vehicles, signals, metrics };
}

function digest(state) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

const mode = process.argv.includes("--save")
  ? "save"
  : process.argv.includes("--check")
    ? "check"
    : "print";

const state = run();
const hash = digest(state);

if (mode === "save") {
  writeFileSync(baselinePath, JSON.stringify({ hash, state }, null, 0));
  console.log(`[parity] baseline saved → ${baselinePath}`);
  console.log(`[parity] hash ${hash}`);
  console.log(`[parity] vehicles=${state.vehicles.length} signals=${state.signals.length}`);
} else if (mode === "check") {
  if (!existsSync(baselinePath)) {
    console.error("[parity] no baseline; run with --save first");
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (base.hash === hash) {
    console.log(`[parity] ✓ /simulation IDENTICAL to baseline (hash ${hash.slice(0, 12)}…)`);
    process.exit(0);
  }
  console.error(`[parity] ✗ /simulation DIVERGED from baseline`);
  console.error(`         baseline ${base.hash.slice(0, 16)}…  now ${hash.slice(0, 16)}…`);
  // surface a first concrete diff to localize the leak
  const a = base.state, b = state;
  if (a.vehicles.length !== b.vehicles.length) {
    console.error(`         vehicle count ${a.vehicles.length} → ${b.vehicles.length}`);
  } else {
    for (let i = 0; i < a.vehicles.length; i++) {
      if (JSON.stringify(a.vehicles[i]) !== JSON.stringify(b.vehicles[i])) {
        console.error(`         first vehicle diff @id ${a.vehicles[i].id}:`);
        console.error(`           base ${JSON.stringify(a.vehicles[i])}`);
        console.error(`           now  ${JSON.stringify(b.vehicles[i])}`);
        break;
      }
    }
  }
  process.exit(1);
} else {
  console.log(`[parity] hash ${hash}`);
  console.log(`[parity] steps=${state.steps} vehicles=${state.vehicles.length} signals=${state.signals.length}`);
  console.log(`[parity] metrics ${JSON.stringify(state.metrics)}`);
}
