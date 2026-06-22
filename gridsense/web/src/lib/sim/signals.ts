// Traffic-signal controller. Each signalized junction gets phases derived from
// its incoming approaches (opposing approaches share green). Supports fixed
// timing, adaptive green extension, manual control, emergency override, failed
// state, all-red clearance between phases, and protected left-turn sub-phases.

import type { SimNetwork } from "./network";
import type { JunctionSignal, SignalPhase, SignalState } from "./types";

const ALL_RED_SEC = 2;
const LEFT_TURN_SEC = 8;
// Level-2 actuated controller bounds & thresholds.
const MIN_GREEN_SEC = 5;
const MAX_GREEN_SEC = 45;
/** Queue (m) on a served approach above which we keep extending green. */
const GAP_OUT_QUEUE_M = 5;

function bearingDeg(net: SimNetwork, edgeId: string): number {
  const h = net.centreAt(edgeId, net.edgeLength(edgeId)).heading;
  return ((h * 180) / Math.PI + 360) % 360;
}

function turnKind(fromBearing: number, toBearing: number): "straight" | "left" | "right" | "u_turn" {
  let delta = (toBearing - fromBearing + 360) % 360;
  if (delta > 180) delta = 360 - delta;
  if (delta < 25) return "straight";
  if (delta > 155) return "u_turn";
  const cw = (toBearing - fromBearing + 360) % 360;
  return cw <= 180 ? "right" : "left";
}

export interface BuildSignalsOpts {
  /** Realistic-placement gate: only nodes whose JunctionClass.shouldSignalize is
   *  true keep a signal. When omitted (legacy/protected path), every flagged
   *  node is built exactly as before. */
  signalizedNodes?: Set<string>;
  /** Build controllers in actuated (Level-2) mode instead of fixed (Level-1). */
  actuated?: boolean;
}

export function buildSignals(net: SimNetwork, opts: BuildSignalsOpts = {}): Map<string, JunctionSignal> {
  const signals = new Map<string, JunctionSignal>();
  const nodes = opts.signalizedNodes ?? net.signalized;
  for (const nodeId of nodes) {
    if (!net.signalized.has(nodeId)) continue; // never add signals beyond the data flags
    const incoming = net.incoming.get(nodeId) ?? [];
    if (incoming.length < 2) continue;

    const groups: { axis: number; edges: string[] }[] = [];
    for (const e of incoming) {
      const axis = bearingDeg(net, e.id) % 180;
      let g = groups.find((gr) => angleClose(gr.axis, axis, 40));
      if (!g) {
        g = { axis, edges: [] };
        groups.push(g);
      }
      g.edges.push(e.id);
    }

    // Only use protected left-turn sub-phases at complex junctions (3+ distinct
    // approach axes). At simpler T/cross junctions the sub-phase timer misfires
    // on OSM geometry and leaves left-turners waiting forever.
    const nbrs = new Set<string>();
    for (const e of incoming) nbrs.add(e.from);
    for (const e of net.outgoing.get(nodeId) ?? []) nbrs.add(e.to);
    const useProtectedLeft = groups.length >= 3 && nbrs.size >= 4;

    const phases: SignalPhase[] = groups.map((g) => {
      const lanes = g.edges.reduce((s, id) => s + net.laneCount(id), 0);
      const leftTurnFrom: string[] = [];
      if (useProtectedLeft) {
        const outs = net.outgoing.get(nodeId) ?? [];
        for (const ieId of g.edges) {
          const fb = bearingDeg(net, ieId);
          for (const oe of outs) {
            if (oe.to === net.edge(ieId)?.from) continue;
            const tb = bearingDeg(net, oe.id);
            if (turnKind(fb, tb) === "left") leftTurnFrom.push(ieId);
          }
        }
      }
      const greenSec = Math.min(22, 10 + lanes * 2);
      return {
        greenEdges: g.edges,
        greenSec,
        yellowSec: 3,
        leftTurnEdges: [...new Set(leftTurnFrom)],
        leftTurnSec: LEFT_TURN_SEC,
        // Actuated bounds: guarantee a minimum service, cap demand extension.
        minGreen: Math.max(MIN_GREEN_SEC, Math.min(greenSec, 8)),
        maxGreen: Math.min(MAX_GREEN_SEC, greenSec + 18),
      };
    });
    // A signal is only meaningful where movements conflict (>=2 phases). A single
    // approach group means everyone can run together, so signalising it would only
    // add a pointless all-stop each cycle — leave such junctions uncontrolled.
    if (phases.length < 2) continue;

    signals.set(nodeId, {
      nodeId,
      phases,
      phaseIdx: 0,
      timer: 0,
      inYellow: false,
      inAllRed: false,
      inLeftTurn: false,
      mode: opts.actuated ? "actuated" : "fixed",
      edgeState: new Map(),
      baseGreen: phases.map((p) => p.greenSec),
    });
  }
  for (const sig of signals.values()) recomputeStates(sig, net);
  return signals;
}

function angleClose(a: number, b: number, tol: number): boolean {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d <= tol;
}

function recomputeStates(sig: JunctionSignal, net?: SimNetwork) {
  sig.edgeState = new Map();
  const setAll = (s: SignalState) => {
    for (const p of sig.phases) for (const e of p.greenEdges) sig.edgeState.set(e, s);
  };

  if (sig.mode === "failed") {
    setAll("red");
    return;
  }
  if ((sig.mode === "emergency" || sig.mode === "manual") && sig.overrideEdge) {
    setAll("red");
    sig.edgeState.set(sig.overrideEdge, "green");
    return;
  }
  if (sig.inAllRed) {
    setAll("red");
    return;
  }

  setAll("red");
  const phase = sig.phases[sig.phaseIdx];
  const state: SignalState = sig.inYellow ? "yellow" : "green";

  if (sig.inLeftTurn && phase.leftTurnEdges?.length) {
    for (const e of phase.leftTurnEdges) sig.edgeState.set(e, "green");
    return;
  }

  for (const e of phase.greenEdges) sig.edgeState.set(e, state);

  // Permissive right: during green/yellow, right-turn connectors from green
  // approaches are implicitly allowed (engine checks turn type + signal state).
  void net;
}

/** Whether an incoming edge may proceed for a given turn type at a signal. */
export function mayProceed(
  sig: JunctionSignal | undefined,
  incomingEdgeId: string,
  turn: "straight" | "left" | "right" | "u_turn"
): boolean {
  if (!sig) return true;
  if (sig.mode === "failed") return turn === "straight"; // cautious creep
  const st = sig.edgeState.get(incomingEdgeId) ?? "red";
  if (st === "green") {
    if (turn === "u_turn") return false;
    if (turn === "left") {
      const phase = sig.phases[sig.phaseIdx];
      // Only block left turns if this phase actually has a protected left sub-phase.
      // Without one, permit left (permissive yield — vehicles judge their own gap).
      if (phase?.leftTurnEdges?.length && !sig.inLeftTurn) return false;
    }
    return true;
  }
  if (st === "yellow") return turn === "straight" || turn === "right";
  return false;
}

export interface SignalStepOpts {
  queueByEdge?: Map<string, number>;
}

/** Max queue (m) across the edges a phase serves — its current demand. */
function phaseDemand(phase: SignalPhase, queueByEdge?: Map<string, number>): number {
  if (!queueByEdge) return 0;
  let q = 0;
  for (const e of phase.greenEdges) q = Math.max(q, queueByEdge.get(e) ?? 0);
  return q;
}

/** Level-2 gap-out / max-out: the effective green the timer is compared against.
 *  Below minGreen we always hold; past minGreen we keep green only while the
 *  served approach still has a queue, never beyond maxGreen. */
function actuatedGreen(sig: JunctionSignal, phase: SignalPhase, queueByEdge: Map<string, number>): number {
  const minG = phase.minGreen ?? MIN_GREEN_SEC;
  const maxG = phase.maxGreen ?? MAX_GREEN_SEC;
  if (sig.timer < minG) return minG; // honour the floor
  const demand = phaseDemand(phase, queueByEdge);
  if (demand <= GAP_OUT_QUEUE_M) return sig.timer; // gap-out: end this step
  return maxG; // keep serving until the queue clears or max-green caps it
}

/** Pick the next phase index to serve, skipping zero-demand phases (Level-2).
 *  Always advances at least one phase; falls back to the plain next phase if
 *  nothing has demand (keeps a baseline cycle running). */
function nextServedPhase(sig: JunctionSignal, queueByEdge?: Map<string, number>): number {
  const n = sig.phases.length;
  const start = (sig.phaseIdx + 1) % n;
  if (!queueByEdge) return start;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (phaseDemand(sig.phases[idx], queueByEdge) > 0) return idx;
  }
  return start;
}

export function stepSignal(sig: JunctionSignal, dt: number, opts: SignalStepOpts = {}, net?: SimNetwork) {
  if (sig.mode === "failed") {
    recomputeStates(sig, net);
    return;
  }
  if (sig.mode === "emergency" || sig.mode === "manual") {
    recomputeStates(sig, net);
    return;
  }

  if (sig.inAllRed) {
    sig.timer += dt;
    if (sig.timer >= ALL_RED_SEC) {
      sig.inAllRed = false;
      sig.timer = 0;
      // Level-2: skip ahead to the next phase that actually has waiting demand,
      // so an empty approach doesn't cost the whole network a pointless all-stop.
      sig.phaseIdx = nextServedPhase(sig, opts.queueByEdge);
    }
    recomputeStates(sig, net);
    return;
  }

  const phase = sig.phases[sig.phaseIdx];
  let green = phase.greenSec;

  if (sig.mode === "adaptive" && opts.queueByEdge) {
    const q = Math.max(0, ...phase.greenEdges.map((e) => opts.queueByEdge!.get(e) ?? 0));
    if (q > 25) green = Math.min(sig.baseGreen[sig.phaseIdx] * 1.5, phase.greenSec + 0.5);
    else if (q < 4) green = Math.max(8, sig.baseGreen[sig.phaseIdx] * 0.7);
  } else if (sig.mode === "actuated" && opts.queueByEdge) {
    // Level-2 actuated: after min-green, gap-out when the served approach clears;
    // otherwise keep serving up to max-green. Computed as an effective green
    // threshold the timer is compared against below.
    green = actuatedGreen(sig, phase, opts.queueByEdge);
  }

  sig.timer += dt;

  if (sig.inLeftTurn) {
    const leftDur = phase.leftTurnSec ?? LEFT_TURN_SEC;
    if (sig.timer >= leftDur) {
      sig.inLeftTurn = false;
      sig.inAllRed = true;
      sig.timer = 0;
    }
    recomputeStates(sig, net);
    return;
  }

  if (!sig.inYellow) {
    if (sig.timer >= green) {
      sig.inYellow = true;
      sig.timer = 0;
    }
  } else {
    if (sig.timer >= phase.yellowSec) {
      sig.inYellow = false;
      sig.timer = 0;
      // Protected left-turn sub-phase if this axis has left turns
      if (phase.leftTurnEdges?.length) {
        sig.inLeftTurn = true;
      } else {
        sig.inAllRed = true;
      }
    }
  }
  recomputeStates(sig, net);
}

export function signalForEdge(sig: JunctionSignal | undefined, edgeId: string): SignalState {
  if (!sig) return "green";
  return sig.edgeState.get(edgeId) ?? "red";
}

export function setEmergencyOverride(sig: JunctionSignal, edgeId: string) {
  if (sig.mode === "failed") return;
  sig.mode = "emergency";
  sig.overrideEdge = edgeId;
  sig.inAllRed = false;
  sig.inLeftTurn = false;
  recomputeStates(sig);
}

export function clearOverride(sig: JunctionSignal) {
  if (sig.mode === "emergency" || sig.mode === "manual") {
    sig.mode = "fixed";
    sig.overrideEdge = undefined;
    sig.inYellow = false;
    sig.inAllRed = false;
    sig.inLeftTurn = false;
    sig.timer = 0;
    recomputeStates(sig);
  }
}
