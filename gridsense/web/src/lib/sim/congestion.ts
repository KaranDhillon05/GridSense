// Derives per-edge congestion (density, queue length, utilization, mean speed)
// from live vehicle positions. Spillback is emergent: a full queue makes
// upstream vehicles stop via car-following, which backs into the upstream edge.

import type { SimNetwork } from "./network";
import type { EdgeCongestion, Vehicle } from "./types";

const JAM_SPACING_M = 7.5; // metres per vehicle in a standstill queue

export function computeCongestion(
  net: SimNetwork,
  vehicles: Vehicle[],
  closed: Set<string>
): { list: EdgeCongestion[]; byEdge: Map<string, EdgeCongestion> } {
  const counts = new Map<string, Vehicle[]>();
  for (const v of vehicles) {
    if (v.onConnector || v.arrived) continue;
    if (!counts.has(v.edgeId)) counts.set(v.edgeId, []);
    counts.get(v.edgeId)!.push(v);
  }

  const byEdge = new Map<string, EdgeCongestion>();
  for (const [edgeId, vs] of counts) {
    const edge = net.edge(edgeId);
    if (!edge) continue;
    const lengthM = net.edgeLength(edgeId);
    const lanes = edge.lanes;
    const jam = Math.max(1, (lengthM / JAM_SPACING_M) * lanes);

    // queue length = stopped vehicles measured back from the downstream end
    const stopped = vs.filter((v) => v.speed < 0.6);
    let queueLength = 0;
    if (stopped.length) {
      const maxDist = Math.max(...stopped.map((v) => v.distOnEdge));
      const minDist = Math.min(...stopped.map((v) => v.distOnEdge));
      queueLength = Math.min(lengthM, maxDist - minDist + JAM_SPACING_M);
    }
    const meanSpeed = vs.reduce((s, v) => s + v.speed, 0) / vs.length;
    const utilization = Math.min(1.6, vs.length / jam);
    byEdge.set(edgeId, {
      edgeId,
      vehicleCount: vs.length,
      queueLength,
      utilization,
      meanSpeed,
      blocked: closed.has(edgeId),
    });
  }
  // include closed edges that have no vehicles so they still render as blocked
  for (const id of closed) {
    if (!byEdge.has(id) && net.edge(id)) {
      byEdge.set(id, {
        edgeId: id,
        vehicleCount: 0,
        queueLength: 0,
        utilization: 0,
        meanSpeed: 0,
        blocked: true,
      });
    }
  }
  return { list: [...byEdge.values()], byEdge };
}

export function queueMap(byEdge: Map<string, EdgeCongestion>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, c] of byEdge) m.set(id, c.queueLength);
  return m;
}

export function utilizationMap(byEdge: Map<string, EdgeCongestion>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, c] of byEdge) m.set(id, c.utilization);
  return m;
}
