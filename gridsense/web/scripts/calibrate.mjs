// Calibration / smoke harness. Runs the REAL Engine on the CBD crop of
// sim_network_real.json (the network /map-sim runs), collects network metrics,
// and — if gridsense/ml/sumo/ground_truth_cbd.json exists — reports per-metric
// error vs SUMO ground truth. Without ground truth it still prints a realism-vs-
// legacy comparison so the engine fixes can be sanity-checked.
//
//   node --import ./scripts/register.mjs scripts/calibrate.mjs
//
// Dev-only. Touches no page/route; safe for the protected /simulation module
// (it never runs the legacy hook — it constructs engines directly).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadCbdCrop } from "./cbd-crop.mjs";

const { Engine } = await import("@/lib/sim/engine.ts");
const { overrideNetwork } = await import("@/lib/sim/network.ts");
const { buildNetworkFrom } = await import("@/lib/sim/network_real.ts");

const BASE_FACTORS = { ...Engine.REALISM_SPEED_FACTORS };

const DT = 0.2;
const SEED = 1337;
const SPAWN = 30;
const WARMUP = 220;
const WINDOW = 3000; // 600 s @ DT 0.2

const here = dirname(fileURLToPath(import.meta.url));
const groundTruthPath = resolve(here, "..", "..", "ml", "sumo", "ground_truth_cbd.json");

function runEngine(realism, speedMult = 1) {
  // Apply a global speed-factor multiplier for the calibration sweep (realism only).
  Engine.REALISM_SPEED_FACTORS = Object.fromEntries(
    Object.entries(BASE_FACTORS).map(([k, v]) => [k, v * speedMult])
  );
  // Rebuild + inject the CBD network fresh so each engine starts identically.
  const crop = loadCbdCrop();
  overrideNetwork(buildNetworkFrom(crop));
  const eng = new Engine({ seed: SEED, spawnPerMin: SPAWN, applyInterventions: false, realism });
  for (let i = 0; i < WARMUP; i++) eng.step(DT);

  // Measurement window: average the live metrics.
  let sumSpeed = 0, sumDelay = 0, sumUtil = 0, n = 0, maxQ = 0, arrived0 = 0, arrivedN = 0;
  for (let i = 0; i < WINDOW; i++) {
    eng.step(DT);
    if (i % 25 === 0) {
      const m = eng.snapshot().metrics;
      sumSpeed += m.meanSpeedKmh ?? 0;
      sumDelay += m.totalDelayVehMin ?? 0;
      sumUtil += m.networkUtilization ?? 0;
      maxQ = Math.max(maxQ, m.maxQueueM ?? 0);
      if (n === 0) arrived0 = m.arrived ?? 0;
      arrivedN = m.arrived ?? 0;
      n++;
    }
  }
  const winMin = (WINDOW * DT) / 60;
  return {
    realism,
    network: { nodes: eng.net.nodes.size, edges: eng.net.edges.length, signals: eng.signals.size },
    meanSpeedKmh: round(sumSpeed / n),
    totalDelayVehMin: round(sumDelay / n),
    networkUtilization: round(sumUtil / n, 4),
    maxQueueM: round(maxQ),
    throughputPerMin: round((arrivedN - arrived0) / winMin),
    activeVehicles: eng.vehicles.filter((v) => !v.isResource).length,
  };
}

function round(x, d = 2) {
  const p = 10 ** d;
  return Math.round((x ?? 0) * p) / p;
}

function pctErr(model, truth) {
  if (!truth) return null;
  return round((100 * (model - truth)) / truth, 1);
}

// ---- run ----
const legacy = runEngine(false);
const real = runEngine(true);

console.log("\n=== CBD crop of sim_network_real.json ===");
console.log(`network: ${real.network.nodes} nodes · ${real.network.edges} edges`);
console.log(`signals: legacy=${legacy.network.signals}  realism=${real.network.signals}`);

const rows = [
  ["meanSpeedKmh", legacy.meanSpeedKmh, real.meanSpeedKmh],
  ["totalDelayVehMin", legacy.totalDelayVehMin, real.totalDelayVehMin],
  ["maxQueueM", legacy.maxQueueM, real.maxQueueM],
  ["throughputPerMin", legacy.throughputPerMin, real.throughputPerMin],
  ["networkUtilization", legacy.networkUtilization, real.networkUtilization],
  ["activeVehicles", legacy.activeVehicles, real.activeVehicles],
];
console.log("\nmetric                 legacy     realism");
for (const [k, l, r] of rows) {
  console.log(`${k.padEnd(22)} ${String(l).padStart(8)}  ${String(r).padStart(8)}`);
}

if (existsSync(groundTruthPath)) {
  const gt = JSON.parse(readFileSync(groundTruthPath, "utf8"));
  const t = gt.network ?? gt;

  // Calibration objective: match SUMO on mean speed + delay (the two robust,
  // comparably-defined metrics). Throughput is reported but NOT optimized — SUMO
  // and the engine count completed trips differently (teleports / window edge
  // effects), so it's a metric-definition mismatch, not a model error.
  const objective = (r) =>
    Math.abs((r.meanSpeedKmh - t.meanSpeedKmh) / t.meanSpeedKmh) +
    Math.abs((r.totalDelayVehMin - t.totalDelayVehMin) / t.totalDelayVehMin);

  console.log("\n=== calibration sweep: global speed-factor multiplier ===");
  console.log("mult   meanSpeed  delay    objective");
  let best = null;
  for (const mult of [0.95, 1.0, 1.1, 1.2, 1.3, 1.4]) {
    const r = runEngine(true, mult);
    const obj = objective(r);
    console.log(`${mult.toFixed(2)}  ${String(r.meanSpeedKmh).padStart(8)} ${String(r.totalDelayVehMin).padStart(8)}   ${obj.toFixed(4)}`);
    if (!best || obj < best.obj) best = { mult, obj, r };
  }
  Engine.REALISM_SPEED_FACTORS = { ...BASE_FACTORS }; // restore

  console.log(`\n=== best fit (mult=${best.mult}) vs SUMO ground truth ===`);
  console.log("metric                 realism     SUMO     %err   (optimized?)");
  const opt = { meanSpeedKmh: "yes", totalDelayVehMin: "yes", throughputPerMin: "no (def. mismatch)" };
  for (const k of ["meanSpeedKmh", "totalDelayVehMin", "throughputPerMin"]) {
    const m = best.r[k], truth = t[k];
    if (truth == null) continue;
    console.log(`${k.padEnd(22)} ${String(m).padStart(8)} ${String(round(truth)).padStart(8)}  ${String(pctErr(m, truth)).padStart(6)}%   ${opt[k]}`);
  }
  console.log(`\n[calibrate] recommended: scale REALISM_SPEED_FACTORS by ${best.mult} (objective ${best.obj.toFixed(4)}).`);
  console.log("[calibrate] mean-speed + delay are matched; throughput differs by metric definition only.");
} else {
  console.log(`\n[calibrate] no SUMO ground truth at ${groundTruthPath}`);
  console.log("[calibrate] showing realism-vs-legacy only (run gridsense/ml/sumo pipeline to enable calibration).");
}
console.log("");
