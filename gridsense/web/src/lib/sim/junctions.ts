// Junction topology analysis for the simulation network. Computes per-node
// feeders (incoming roads), fed roads (outgoing), legal turn movements,
// conflict pairs, and signal status. Used by the debug overlay and audit export.

import type { GraphEdge } from "@/lib/roadGraph";
import type { SimNetwork } from "./network";

export type TurnMovement = {
  fromEdgeId: string;
  toEdgeId: string;
  fromRoad: string;
  toRoad: string;
  turnType: "straight" | "left" | "right" | "u_turn";
};

export type ConflictPair = {
  movementA: string; // "fromEdgeId>toEdgeId"
  movementB: string;
  reason: "crossing" | "merge";
};

export type JunctionAnalysis = {
  nodeId: string;
  jid: number | null;
  lat: number;
  lon: number;
  name?: string;
  isSource: boolean;
  signalized: boolean;
  inDegree: number;
  outDegree: number;
  undirectedDegree: number;
  feeders: { edgeId: string; name: string; lanes: number; roadClass: string }[];
  fedRoads: { edgeId: string; name: string; lanes: number; roadClass: string }[];
  turnMovements: TurnMovement[];
  conflictPairs: ConflictPair[];
  junctionKind: "dead_end" | "pass_through" | "t_junction" | "cross" | "complex";
};

function bearingDeg(net: SimNetwork, edgeId: string): number {
  const h = net.centreAt(edgeId, net.edgeLength(edgeId)).heading;
  return ((h * 180) / Math.PI + 360) % 360;
}

function turnType(fromBearing: number, toBearing: number): TurnMovement["turnType"] {
  let delta = (toBearing - fromBearing + 360) % 360;
  if (delta > 180) delta = 360 - delta;
  if (delta < 25) return "straight";
  if (delta > 155) return "u_turn";
  // Left-hand traffic: a right turn crosses less (smaller clockwise delta from approach)
  const cw = (toBearing - fromBearing + 360) % 360;
  return cw <= 180 ? "right" : "left";
}

function edgeSummary(e: GraphEdge) {
  return {
    edgeId: e.id,
    name: e.name,
    lanes: e.lanes,
    roadClass: e.road_class,
  };
}

function classifyKind(undirected: number, inDeg: number, outDeg: number): JunctionAnalysis["junctionKind"] {
  if (inDeg === 0 || outDeg === 0) return "dead_end";
  if (undirected <= 2) return "pass_through";
  if (undirected === 3) return "t_junction";
  if (undirected === 4) return "cross";
  return "complex";
}

/** Build turn movements and conflict pairs for a junction node. */
function buildMovements(
  net: SimNetwork,
  nodeId: string,
  incoming: GraphEdge[],
  outgoing: GraphEdge[]
): { turns: TurnMovement[]; conflicts: ConflictPair[] } {
  const turns: TurnMovement[] = [];
  for (const ie of incoming) {
    for (const oe of outgoing) {
      if (oe.to === ie.from) continue; // U-turn excluded
      const fb = bearingDeg(net, ie.id);
      const tb = bearingDeg(net, oe.id);
      turns.push({
        fromEdgeId: ie.id,
        toEdgeId: oe.id,
        fromRoad: ie.name,
        toRoad: oe.name,
        turnType: turnType(fb, tb),
      });
    }
  }

  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      const a = turns[i];
      const b = turns[j];
      if (a.fromEdgeId === b.fromEdgeId) continue; // same approach
      const keyA = `${a.fromEdgeId}>${a.toEdgeId}`;
      const keyB = `${b.fromEdgeId}>${b.toEdgeId}`;
      // Crossing: different incoming, different outgoing (standard intersection conflict)
      if (a.fromEdgeId !== b.fromEdgeId && a.toEdgeId !== b.toEdgeId) {
        conflicts.push({ movementA: keyA, movementB: keyB, reason: "crossing" });
      } else if (a.toEdgeId === b.toEdgeId && a.fromEdgeId !== b.fromEdgeId) {
        conflicts.push({ movementA: keyA, movementB: keyB, reason: "merge" });
      }
    }
  }
  return { turns, conflicts };
}

export function analyzeJunction(net: SimNetwork, nodeId: string): JunctionAnalysis | null {
  const node = net.nodes.get(nodeId);
  if (!node) return null;

  const incoming = net.incoming.get(nodeId) ?? [];
  const outgoing = net.outgoing.get(nodeId) ?? [];
  const nbrs = new Set<string>();
  for (const e of incoming) nbrs.add(e.from);
  for (const e of outgoing) nbrs.add(e.to);

  const { turns, conflicts } = buildMovements(net, nodeId, incoming, outgoing);

  return {
    nodeId,
    jid: net.junctionId.get(nodeId) ?? null,
    lat: node.lat,
    lon: node.lon,
    name: node.name,
    isSource: net.sources.includes(nodeId),
    signalized: net.signalized.has(nodeId),
    inDegree: incoming.length,
    outDegree: outgoing.length,
    undirectedDegree: nbrs.size,
    feeders: incoming.map(edgeSummary),
    fedRoads: outgoing.map(edgeSummary),
    turnMovements: turns,
    conflictPairs: conflicts,
    junctionKind: classifyKind(nbrs.size, incoming.length, outgoing.length),
  };
}

export function analyzeAllJunctions(net: SimNetwork): JunctionAnalysis[] {
  const out: JunctionAnalysis[] = [];
  for (const nodeId of net.nodes.keys()) {
    const j = analyzeJunction(net, nodeId);
    if (j) out.push(j);
  }
  out.sort((a, b) => (a.jid ?? 9999) - (b.jid ?? 9999));
  return out;
}

export type JunctionAuditSummary = {
  generatedAt: string;
  nodeCount: number;
  signalizedCount: number;
  byKind: Record<string, number>;
  junctions: JunctionAnalysis[];
};

export function buildJunctionAudit(net: SimNetwork): JunctionAuditSummary {
  const junctions = analyzeAllJunctions(net);
  const byKind: Record<string, number> = {};
  for (const j of junctions) {
    byKind[j.junctionKind] = (byKind[j.junctionKind] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    nodeCount: junctions.length,
    signalizedCount: junctions.filter((j) => j.signalized).length,
    byKind,
    junctions,
  };
}
