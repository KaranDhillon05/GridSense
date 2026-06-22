#!/usr/bin/env node
/** Quick validation for junction/signal/routing improvements. */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dir, "..");

// Dynamic import of compiled modules won't work easily; inline checks on JSON + simple path test
const net = JSON.parse(readFileSync(join(webRoot, "src/data/sim_network.json"), "utf8"));
const audit = JSON.parse(readFileSync(join(webRoot, "src/data/sim_network_junctions.json"), "utf8"));

const meta = net.meta;
console.log("=== sim_network.json ===");
console.log(`nodes=${meta.node_count} edges=${meta.edge_count} signals=${meta.signal_count} sources=${meta.source_count}`);
console.log(`SCC=${meta.largest_scc_pct}% routing=${meta.routing_success_pct}% dead_ends=${meta.dead_ends}`);
console.log(`synthetic_edges=${meta.synthetic_edges}`);

const signalizedInNodes = net.nodes.filter((n) => n.signalized).length;
console.log(`signalized nodes in array: ${signalizedInNodes} (meta says ${meta.signal_count})`);
if (signalizedInNodes !== meta.signal_count) {
  console.error("FAIL: signal_count mismatch");
  process.exit(1);
}

console.log("\n=== junction audit ===");
console.log(`junctions=${audit.nodeCount} signalized=${audit.signalizedCount}`);
console.log("byKind:", audit.byKind);

// Cross + T junction signal coverage
const cross = audit.junctions.filter((j) => j.junctionKind === "cross");
const crossSig = cross.filter((j) => j.signalized).length;
const tJ = audit.junctions.filter((j) => j.junctionKind === "t_junction");
const tSig = tJ.filter((j) => j.signalized).length;
console.log(`cross: ${crossSig}/${cross.length} signalized, T-junction: ${tSig}/${tJ.length} signalized`);

if (meta.largest_scc_pct !== 100 || meta.routing_success_pct !== 100 || meta.dead_ends !== 0) {
  console.error("FAIL: network connectivity check");
  process.exit(1);
}

if (meta.signal_count < 50) {
  console.error("FAIL: expected broadened signalization (>=50)");
  process.exit(1);
}

console.log("\nOK: all validation checks passed");
