// Shared CBD crop: load sim_network_real.json (the network /map-sim actually
// runs) and return the subgraph inside the CBD bbox. Used by the calibration
// harness AND mirrored by the SUMO net builder so engine and SUMO see an
// identical node/edge set. Keep the bbox in sync with gridsense/ml/build_sim_network.py.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// CBD bbox (same window as build_sim_network.py's CBD extract).
export const CBD_BBOX = { minLat: 12.965, maxLat: 12.985, minLon: 77.595, maxLon: 77.615 };

export function inBbox(lat, lon, b = CBD_BBOX) {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/** Load and crop. Returns { meta, nodes, edges } with only nodes inside the bbox
 *  and edges whose BOTH endpoints survive (a clean induced subgraph). */
export function loadCbdCrop(b = CBD_BBOX) {
  const path = resolve(here, "..", "public", "sim_network_real.json");
  const data = JSON.parse(readFileSync(path, "utf8"));

  const keep = new Set();
  const nodes = [];
  for (const n of data.nodes) {
    if (inBbox(n.lat, n.lon, b)) {
      keep.add(n.id);
      nodes.push(n);
    }
  }
  const edges = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to));

  // Guarantee at least a few sources for demand generation: promote boundary
  // nodes (have outgoing but their geographic neighbours were cropped away).
  const hasSource = nodes.some((n) => n.kind === "source");
  if (!hasSource) {
    const outDeg = new Map();
    for (const e of edges) outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    const cands = nodes.filter((n) => (outDeg.get(n.id) ?? 0) >= 1).slice(0, 40);
    for (const n of cands) n.kind = "source";
  }

  return {
    meta: {
      ...data.meta,
      bbox: b,
      node_count: nodes.length,
      edge_count: edges.length,
      cropped_from: "sim_network_real.json",
    },
    nodes,
    edges,
  };
}
