// Trip generation: spawns vehicles at boundary source nodes toward a random
// other boundary, with a realistic CBD vehicle-type mix. Deterministic via a
// seeded RNG so the live and baseline ("ghost") sims stay comparable.

import type { SimNetwork } from "./network";
import { routeBetween } from "./routing";
import {
  VEHICLE_DESIRED_MS,
  VEHICLE_LENGTH_M,
  VEHICLE_PRIORITY,
  type Vehicle,
  type VehicleType,
} from "./types";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bengaluru CBD mix: lots of cars + autos + two-wheeler-like, some buses/trucks.
const MIX: { type: VehicleType; w: number }[] = [
  { type: "car", w: 0.56 },
  { type: "auto", w: 0.26 },
  { type: "bus", w: 0.1 },
  { type: "truck", w: 0.08 },
];

export function pickType(rng: () => number): VehicleType {
  const r = rng();
  let acc = 0;
  for (const m of MIX) {
    acc += m.w;
    if (r <= acc) return m.type;
  }
  return "car";
}

export function makeVehicle(
  id: number,
  type: VehicleType,
  route: string[],
  originNode: string,
  destNode: string,
  time: number,
  net: SimNetwork,
  lane = 0
): Vehicle {
  const edgeId = route[0];
  const laneIndex = Math.min(lane, net.laneCount(edgeId) - 1);
  const p = net.laneAt(edgeId, laneIndex, 0);
  return {
    id,
    type,
    priority: VEHICLE_PRIORITY[type],
    lengthM: VEHICLE_LENGTH_M[type],
    route,
    routeIdx: 0,
    originNode,
    destNode,
    edgeId,
    laneIndex,
    distOnEdge: 0,
    speed: VEHICLE_DESIRED_MS[type] * 0.5,
    accel: 0,
    lat: p.lat,
    lon: p.lon,
    heading: p.heading,
    spawnTime: time,
    distanceTravelled: 0,
    stoppedTime: 0,
    arrived: false,
    onConnector: false,
    connectorT: 0,
    emergency: type === "ambulance" || type === "fire" || type === "police",
    isResource: false,
  };
}

/** Try to generate one trip between two distinct boundary nodes. */
export function generateTrip(
  net: SimNetwork,
  rng: () => number,
  closed: Set<string>,
  id: number,
  time: number
): Vehicle | null {
  const sources = net.sources;
  if (sources.length < 2) return null;
  const origin = sources[Math.floor(rng() * sources.length)];
  let dest = origin;
  let guard = 0;
  while (dest === origin && guard++ < 8) dest = sources[Math.floor(rng() * sources.length)];
  if (dest === origin) return null;

  const route = routeBetween(net, origin, dest, closed);
  if (!route || !route.length) return null;
  return makeVehicle(id, pickType(rng), route, origin, dest, time, net, Math.floor(rng() * 2));
}
