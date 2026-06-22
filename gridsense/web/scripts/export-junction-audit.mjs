#!/usr/bin/env node
/**
 * Export sim_network_junctions.json from the TypeScript junction analyzer.
 * Run from web/: node scripts/export-junction-audit.mjs
 *
 * Uses a lightweight inline analysis (mirrors junctions.ts) so we don't need tsx.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const netPath = join(__dir, "../src/data/sim_network.json");
const outPath = join(__dir, "../src/data/sim_network_junctions.json");

const raw = JSON.parse(readFileSync(netPath, "utf8"));
const nodes = new Map(raw.nodes.map((n) => [n.id, n]));
const edges = raw.edges;
const incoming = new Map();
const outgoing = new Map();
const signalized = new Set(raw.nodes.filter((n) => n.signalized).map((n) => n.id));
const sources = new Set(raw.nodes.filter((n) => n.kind === "source").map((n) => n.id));
const jidMap = new Map(raw.nodes.filter((n) => n.jid != null).map((n) => [n.id, n.jid]));

for (const e of edges) {
  if (!outgoing.has(e.from)) outgoing.set(e.from, []);
  outgoing.get(e.from).push(e);
  if (!incoming.has(e.to)) incoming.set(e.to, []);
  incoming.get(e.to).push(e);
}

function bearingFromGeom(geom) {
  const a = geom[geom.length - 2];
  const b = geom[geom.length - 1];
  const h = Math.atan2((b[1] - a[1]) * 111320, (b[0] - a[0]) * 111320 * 0.85);
  return ((h * 180) / Math.PI + 360) % 360;
}

function turnType(fb, tb) {
  let delta = (tb - fb + 360) % 360;
  if (delta > 180) delta = 360 - delta;
  if (delta < 25) return "straight";
  if (delta > 155) return "u_turn";
  const cw = (tb - fb + 360) % 360;
  return cw <= 180 ? "right" : "left";
}

function classifyKind(ud, inD, outD) {
  if (inD === 0 || outD === 0) return "dead_end";
  if (ud <= 2) return "pass_through";
  if (ud === 3) return "t_junction";
  if (ud === 4) return "cross";
  return "complex";
}

const junctions = [];
for (const [nodeId, node] of nodes) {
  const inc = incoming.get(nodeId) ?? [];
  const out = outgoing.get(nodeId) ?? [];
  const nbrs = new Set();
  for (const e of inc) nbrs.add(e.from);
  for (const e of out) nbrs.add(e.to);

  const turns = [];
  for (const ie of inc) {
    for (const oe of out) {
      if (oe.to === ie.from) continue;
      turns.push({
        fromEdgeId: ie.id,
        toEdgeId: oe.id,
        fromRoad: ie.name,
        toRoad: oe.name,
        turnType: turnType(bearingFromGeom(ie.geometry), bearingFromGeom(oe.geometry)),
      });
    }
  }

  const conflicts = [];
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      const a = turns[i];
      const b = turns[j];
      if (a.fromEdgeId === b.fromEdgeId) continue;
      const keyA = `${a.fromEdgeId}>${a.toEdgeId}`;
      const keyB = `${b.fromEdgeId}>${b.toEdgeId}`;
      if (a.fromEdgeId !== b.fromEdgeId && a.toEdgeId !== b.toEdgeId) {
        conflicts.push({ movementA: keyA, movementB: keyB, reason: "crossing" });
      } else if (a.toEdgeId === b.toEdgeId) {
        conflicts.push({ movementA: keyA, movementB: keyB, reason: "merge" });
      }
    }
  }

  const kind = classifyKind(nbrs.size, inc.length, out.length);
  junctions.push({
    nodeId,
    jid: jidMap.get(nodeId) ?? null,
    lat: node.lat,
    lon: node.lon,
    name: node.name,
    isSource: sources.has(nodeId),
    signalized: signalized.has(nodeId),
    inDegree: inc.length,
    outDegree: out.length,
    undirectedDegree: nbrs.size,
    feeders: inc.map((e) => ({ edgeId: e.id, name: e.name, lanes: e.lanes, roadClass: e.road_class })),
    fedRoads: out.map((e) => ({ edgeId: e.id, name: e.name, lanes: e.lanes, roadClass: e.road_class })),
    turnMovements: turns,
    conflictPairs: conflicts,
    junctionKind: kind,
  });
}

junctions.sort((a, b) => (a.jid ?? 9999) - (b.jid ?? 9999));
const byKind = {};
for (const j of junctions) byKind[j.junctionKind] = (byKind[j.junctionKind] ?? 0) + 1;

const audit = {
  generatedAt: new Date().toISOString(),
  nodeCount: junctions.length,
  signalizedCount: junctions.filter((j) => j.signalized).length,
  byKind,
  junctions,
};

writeFileSync(outPath, JSON.stringify(audit));
console.log(`wrote ${outPath} (${junctions.length} junctions, ${audit.signalizedCount} signalized)`);
