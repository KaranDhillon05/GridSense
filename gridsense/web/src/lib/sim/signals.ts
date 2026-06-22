// Traffic-signal controller. Each signalized junction gets phases derived from
// its incoming approaches (opposing approaches share green). Supports fixed
// timing, adaptive green extension, manual control, emergency override, failed
// state, all-red clearance between phases, and protected left-turn sub-phases.

import type { SimNetwork } from "./network";
import type { JunctionSignal, SignalPhase, SignalState } from "./types";

const ALL_RED_SEC = 2;
const LEFT_TURN_SEC = 8;

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

export function buildSignals(net: SimNetwork): Map<string, JunctionSignal> {
  const signals = new Map<string, JunctionSignal>();
  for (const nodeId of net.signalized) {
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
      return {
        greenEdges: g.edges,
        greenSec: Math.min(22, 10 + lanes * 2),
        yellowSec: 3,
        leftTurnEdges: [...new Set(leftTurnFrom)],
        leftTurnSec: LEFT_TURN_SEC,
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
      mode: "fixed",
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
      sig.phaseIdx = (sig.phaseIdx + 1) % sig.phases.length;
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
