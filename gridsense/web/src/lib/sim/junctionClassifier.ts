// Realistic junction classifier (Tasks 1 & 2). Maps every network node to a
// taxonomy entry and decides whether it genuinely warrants a traffic signal.
//
// The goal is realism: a real city signalizes arterial×arterial crossings and
// busy multi-lane junctions, but lets minor roads, slip lanes, service-road
// merges and simple T-junctions merge by gap acceptance. The old pipeline
// signalized almost every junction touching an arterial; this re-derives a
// realistic placement from data already in the network (degree, road_class,
// lane count, roundabout geometry) with no Python rerun or data regen.
//
// Pure & cheap: runs once at engine construction (O(nodes + edges)), no per-tick
// cost. Consumed by buildSignals() (placement gate) and the engine merge model.

import type { SimNetwork } from "./network";
import type { GraphEdge } from "@/lib/roadGraph";
import type { JunctionClass, JunctionKindClass } from "./types";

/** Road classes that carry through traffic and hold priority at junctions. */
const MAJOR_CLASSES = new Set<GraphEdge["road_class"]>(["arterial", "sub_arterial", "motorway"]);
/** Minor classes that yield / merge rather than receive a dedicated signal. */
const MINOR_CLASSES = new Set<GraphEdge["road_class"]>(["collector", "local"]);

function isMajor(rc: GraphEdge["road_class"] | undefined): boolean {
  return rc != null && MAJOR_CLASSES.has(rc);
}

/** Undirected neighbours of a node (both inbound sources and outbound targets). */
function neighbours(net: SimNetwork, nodeId: string): Set<string> {
  const nbrs = new Set<string>();
  for (const e of net.incoming.get(nodeId) ?? []) nbrs.add(e.from);
  for (const e of net.outgoing.get(nodeId) ?? []) nbrs.add(e.to);
  return nbrs;
}

/** Is any leg of this node part of a roundabout ring? */
function touchesRoundabout(net: SimNetwork, nodeId: string): boolean {
  for (const e of net.incoming.get(nodeId) ?? []) {
    if (net.edgeKind.get(e.id) === "roundabout") return true;
  }
  for (const e of net.outgoing.get(nodeId) ?? []) {
    if (net.edgeKind.get(e.id) === "roundabout") return true;
  }
  return false;
}

/** Classify a single node into the realistic taxonomy. */
export function classifyJunction(net: SimNetwork, nodeId: string): JunctionClass {
  const incoming = net.incoming.get(nodeId) ?? [];
  const outgoing = net.outgoing.get(nodeId) ?? [];
  const nbrs = neighbours(net, nodeId);
  const degree = nbrs.size;

  // Count distinct undirected major-road legs (a leg = one physical neighbour
  // reachable by a major-class edge in either direction).
  const majorNbrs = new Set<string>();
  const majorIncoming: string[] = [];
  for (const e of incoming) {
    if (isMajor(e.road_class)) {
      majorNbrs.add(e.from);
      majorIncoming.push(e.id);
    }
  }
  for (const e of outgoing) {
    if (isMajor(e.road_class)) majorNbrs.add(e.to);
  }
  const majorLegs = majorNbrs.size;

  // Multi-lane majors → heavier junction (used to keep a single-major cross signalized).
  const majorLaneSum = majorIncoming.reduce((s, id) => s + net.laneCount(id), 0);

  let kind: JunctionKindClass;
  let shouldSignalize = false;

  if (degree <= 2) {
    kind = "pass_through";
  } else if (touchesRoundabout(net, nodeId)) {
    kind = "roundabout"; // yield-on-entry, never signalized here
  } else if (degree >= 4 && majorLegs >= 2) {
    kind = "major_signalized";
    shouldSignalize = true;
  } else if (degree >= 4 && majorLegs === 1 && majorLaneSum >= 2) {
    // A multi-lane arterial crossed by minor roads still warrants control.
    kind = "minor_signalized";
    shouldSignalize = true;
  } else if (degree === 3) {
    // T-junction. Minor road meeting a major → merge by gap acceptance.
    const hasMinorLeg = incoming.some((e) => MINOR_CLASSES.has(e.road_class)) ||
      outgoing.some((e) => MINOR_CLASSES.has(e.road_class));
    if (majorLegs >= 1 && hasMinorLeg) kind = "unsignalized_merge";
    else kind = "unsignalized_t";
  } else {
    // degree >= 4 with no major leg, or other minor crossings: treat as merges.
    kind = "unsignalized_merge";
  }

  return {
    nodeId,
    kind,
    shouldSignalize,
    undirectedDegree: degree,
    majorLegs,
    majorIncoming,
  };
}

/** Classify every node in the network. Runs once; O(nodes + edges). */
export function classifyJunctions(net: SimNetwork): Map<string, JunctionClass> {
  const out = new Map<string, JunctionClass>();
  for (const nodeId of net.nodes.keys()) {
    out.set(nodeId, classifyJunction(net, nodeId));
  }
  return out;
}

/** The set of nodes that should actually be signalized under realism rules.
 *  Intersected with net.signalized by buildSignals so we never *add* signals
 *  the data didn't already flag — we only demote over-signalized junctions. */
export function signalizedNodes(net: SimNetwork, classes: Map<string, JunctionClass>): Set<string> {
  const out = new Set<string>();
  for (const id of net.signalized) {
    if (classes.get(id)?.shouldSignalize) out.add(id);
  }
  return out;
}

export interface JunctionAudit {
  total: number;
  byKind: Record<JunctionKindClass, number>;
  flaggedSignalized: number; // nodes the data marked signalized
  realisticSignalized: number; // nodes kept after realism gating
  demoted: number; // flagged but demoted to unsignalized
}

/** Summary counts for an audit panel / console — quantifies the signal reduction. */
export function auditJunctions(net: SimNetwork, classes?: Map<string, JunctionClass>): JunctionAudit {
  const cls = classes ?? classifyJunctions(net);
  const byKind = {
    major_signalized: 0,
    minor_signalized: 0,
    unsignalized_t: 0,
    unsignalized_merge: 0,
    slip_service_merge: 0,
    roundabout: 0,
    pass_through: 0,
  } as Record<JunctionKindClass, number>;
  for (const c of cls.values()) byKind[c.kind]++;

  const flaggedSignalized = net.signalized.size;
  let realisticSignalized = 0;
  for (const id of net.signalized) if (cls.get(id)?.shouldSignalize) realisticSignalized++;

  return {
    total: cls.size,
    byKind,
    flaggedSignalized,
    realisticSignalized,
    demoted: flaggedSignalized - realisticSignalized,
  };
}
