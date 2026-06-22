// Intelligent Driver Model (IDM) longitudinal car-following. Produces an
// acceleration from the gap to (and speed of) the leader, so vehicles slow,
// queue and stop smoothly without ever overlapping. A red light, an incident
// block, or the end of a route are modelled as a stationary "virtual leader".

export interface IdmParams {
  v0: number; // desired speed (m/s)
  aMax: number; // max acceleration (m/s^2)
  b: number; // comfortable deceleration (m/s^2)
  T: number; // safe time headway (s)
  s0: number; // minimum bumper gap (m)
  delta: number;
}

export const DEFAULT_IDM: Omit<IdmParams, "v0"> = {
  aMax: 1.6,
  b: 2.2,
  T: 1.3,
  s0: 2.2,
  delta: 4,
};

/**
 * @param v        current speed (m/s)
 * @param gap      bumper-to-bumper distance to the leader/obstacle (m); Infinity if none
 * @param leaderV  leader speed (m/s); 0 for a stationary obstacle
 */
export function idmAccel(v: number, gap: number, leaderV: number, p: IdmParams): number {
  const free = 1 - Math.pow(Math.max(0, v) / p.v0, p.delta);
  if (!isFinite(gap)) {
    return p.aMax * free;
  }
  const dv = v - leaderV;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const interaction = Math.pow(sStar / Math.max(gap, 0.1), 2);
  let a = p.aMax * (free - interaction);
  // clamp deceleration to avoid numeric blow-ups when gap collapses
  if (a < -8) a = -8;
  return a;
}
