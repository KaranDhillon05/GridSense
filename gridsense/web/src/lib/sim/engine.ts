// Deterministic fixed-timestep micro-simulation engine. Advances vehicles
// (IDM car-following + signal/incident gating + turn connectors), signals,
// incidents and dispatched resources, then derives congestion and metrics.
// The same class runs both the live sim and the headless "ghost" baseline
// (applyInterventions=false) so the UI can show with/without comparisons.

import { getNetwork, SimNetwork } from "./network";
import { buildSignals, clearOverride, mayProceed, setEmergencyOverride, stepSignal } from "./signals";
import { classifyJunctions, signalizedNodes } from "./junctionClassifier";
import type { JunctionClass } from "./types";
import { DEFAULT_IDM, idmAccel, type IdmParams } from "./carFollowing";
import { computeCongestion, queueMap, utilizationMap } from "./congestion";
import { MetricsTracker } from "./metrics";
import { generateTrip, makeVehicle, mulberry32 } from "./demand";
import { bumpClosedVersion, reroute } from "./routing";
import {
  INCIDENT_CATALOG,
  SEVERITY_DURATION_MULT,
  type DiversionStrategy,
} from "./incidents";
import { RESOURCE_META, FLEET_CAPACITY } from "./resources";
import { VEHICLE_DESIRED_MS } from "./types";
import type {
  EdgeCongestion,
  Incident,
  IncidentType,
  JunctionSignal,
  Resource,
  ResourceType,
  Severity,
  SimSnapshot,
  Vehicle,
} from "./types";

export interface EngineConfig {
  seed: number;
  spawnPerMin: number;
  applyInterventions: boolean;
  maxVehicles?: number;
  /** Opt-in realistic-traffic variant: hierarchy-aware signal placement,
   *  stop-line setback, junction-blocking, gap-acceptance merges, actuated
   *  signals. Defaults OFF so the protected /simulation engine is unchanged. */
  realism?: boolean;
}

export interface IncidentInput {
  type: IncidentType;
  edgeId: string;
  distOnEdge: number;
  severity?: Severity;
  lanesAffected?: number;
  laneSide?: "left" | "right" | "both";
  fullBlockage?: boolean;
  durationSec?: number;
}

// Map a blocked-lane count + side onto explicit lane indices. Lane 0 is nearest
// the centreline (centre/right side in left-hand traffic); lane n-1 is the
// kerb/left side. A full blockage covers all lanes.
function blockedLaneSet(
  edgeLanes: number,
  count: number,
  side: "left" | "right" | "both",
  full: boolean
): number[] {
  if (full || count >= edgeLanes) return Array.from({ length: edgeLanes }, (_, i) => i);
  const n = Math.max(1, Math.min(count, edgeLanes - 1));
  if (side === "left") {
    return Array.from({ length: n }, (_, i) => edgeLanes - 1 - i); // kerb side
  }
  return Array.from({ length: n }, (_, i) => i); // right / both → from centre
}

const SAFE_GAP = 1.5;
const REROUTE_BATCH = 40;
/** Legacy stop line: 1 m before the node (used when realism is off). */
const LEGACY_STOP_SETBACK_M = 1;

/** Realism turn-speed targets (m/s) by turn type — vehicles slow into the curve
 *  by geometry instead of a flat crawl. Sharper turn ⇒ slower. Calibration target. */
const TURN_SPEED_MS: Record<"straight" | "left" | "right" | "u_turn", number> = {
  straight: 9,
  right: 7, // wide turn in left-hand traffic
  left: 4.5, // tight kerb-side turn in left-hand traffic
  u_turn: 3,
};
/** Lateral acceleration cap (m/s²) → longer/sweeping connectors allow more speed. */
const TURN_LAT_ACCEL = 2.0;
/** Crawl floor through a turn so a vehicle never fully stalls mid-junction. */
const TURN_MIN_MS = 1.5;

/** Lane-changing (realism). Distance before the junction within which a vehicle
 *  must be in its turn lane; longitudinal clearance needed in the target lane;
 *  min gain + cooldown for discretionary (speed-seeking) changes. */
const TURN_LANE_LOOKAHEAD_M = 80;
const LC_GAP_M = 4; // extra clearance beyond vehicle length for a safe change
const LC_DISCRETIONARY_GAIN_M = 15; // adjacent lane must be this much freer
const LC_COOLDOWN_SEC = 6; // anti-oscillation between discretionary changes

const ROAD_PRIORITY: Record<string, number> = {
  motorway: 5,
  arterial: 4,
  sub_arterial: 3,
  collector: 2,
  local: 1,
};

function movementKey(fromEdge: string, toEdge: string): string {
  return `${fromEdge}>${toEdge}`;
}

function turnKind(net: SimNetwork, fromEdge: string, toEdge: string): "straight" | "left" | "right" | "u_turn" {
  const fb = net.centreAt(fromEdge, net.edgeLength(fromEdge)).heading;
  const tb = net.centreAt(toEdge, 0).heading;
  const fDeg = ((fb * 180) / Math.PI + 360) % 360;
  const tDeg = ((tb * 180) / Math.PI + 360) % 360;
  let delta = (tDeg - fDeg + 360) % 360;
  if (delta > 180) delta = 360 - delta;
  if (delta < 25) return "straight";
  if (delta > 155) return "u_turn";
  const cw = (tDeg - fDeg + 360) % 360;
  return cw <= 180 ? "right" : "left";
}

/** Legacy conflict rule (realism OFF): every different-approach movement
 *  conflicts. Over-serializes junctions but preserved exactly for /simulation. */
function movementsConflictLegacy(aFrom: string, bFrom: string): boolean {
  if (aFrom === bFrom) return false;
  return true;
}

/** 2D segment intersection (proper crossing, endpoints excluded). Coordinates in
 *  a local metre frame; movement chords that genuinely cross => conflict. */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function roadPri(net: SimNetwork, edgeId: string): number {
  const e = net.edge(edgeId);
  return ROAD_PRIORITY[e?.road_class ?? "local"] ?? 1;
}

export class Engine {
  net: SimNetwork;
  cfg: EngineConfig;
  time = 0;
  vehicles: Vehicle[] = [];
  incidents: Incident[] = [];
  resources: Resource[] = [];
  signals: Map<string, JunctionSignal>;
  closedEdges = new Set<string>();
  /** partial-blockage slow zones: edgeId -> remaining blocked lanes count */
  private rng: () => number;
  private nextVehId = 1;
  private nextIncId = 1;
  private nextResId = 1;
  private spawnAcc = 0;
  private metrics = new MetricsTracker();
  private lastCong = new Map<string, EdgeCongestion>();
  private fleetInUse = new Map<ResourceType, number>();
  /** Active turn movements occupying a junction (nodeId -> movement keys). */
  private junctionActive = new Map<string, Set<string>>();
  /** Realism mode: hierarchy-aware junction taxonomy (empty when realism off). */
  private junctionClass = new Map<string, JunctionClass>();
  /** Vehicles waiting to reroute, processed in batches per frame. */
  private rerouteQueue: number[] = [];

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.net = getNetwork();
    if (cfg.realism) this.junctionClass = classifyJunctions(this.net);
    this.signals = this.buildSignalsForCfg();
    this.rng = mulberry32(cfg.seed);
  }

  /** Build signals honouring the realism placement gate + controller level. */
  private buildSignalsForCfg(): Map<string, JunctionSignal> {
    if (!this.cfg.realism) return buildSignals(this.net);
    return buildSignals(this.net, {
      signalizedNodes: signalizedNodes(this.net, this.junctionClass),
      actuated: true,
    });
  }

  /** Default running mode a signal returns to (after a failure clears, etc.). */
  private get defaultSignalMode(): "fixed" | "actuated" {
    return this.cfg.realism ? "actuated" : "fixed";
  }

  reset(cfg?: Partial<EngineConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    this.time = 0;
    this.vehicles = [];
    this.incidents = [];
    this.resources = [];
    this.closedEdges.clear();
    this.junctionClass = this.cfg.realism ? classifyJunctions(this.net) : new Map();
    this.signals = this.buildSignalsForCfg();
    this.rng = mulberry32(this.cfg.seed);
    this.nextVehId = this.nextIncId = this.nextResId = 1;
    this.spawnAcc = 0;
    this.metrics = new MetricsTracker();
    this.lastCong.clear();
    this.fleetInUse.clear();
    this.junctionActive.clear();
    this.rerouteQueue = [];
    this.depotCounter.clear();
  }

  setSpawnRate(perMin: number) {
    this.cfg.spawnPerMin = perMin;
  }

  // ---- main loop -----------------------------------------------------------

  step(dt: number) {
    this.time += dt;
    this.spawnDemand(dt);
    this.updateSignals(dt);
    this.updateIncidents(dt);
    this.moveVehicles(dt);
    this.updateResources();
    this.processRerouteQueue();
    const { byEdge } = computeCongestion(this.net, this.vehicles, this.closedEdges);
    this.lastCong = byEdge;
    this.metrics.accumulate(this.vehicles, dt);
  }

  // ---- demand --------------------------------------------------------------

  private spawnDemand(dt: number) {
    const max = this.cfg.maxVehicles ?? 550;
    const demandCount = this.vehicles.filter((v) => !v.isResource).length;
    this.spawnAcc += (this.cfg.spawnPerMin / 60) * dt;
    while (this.spawnAcc >= 1 && demandCount + 1 < max) {
      this.spawnAcc -= 1;
      const v = generateTrip(this.net, this.rng, this.closedEdges, this.nextVehId, this.time);
      if (v) {
        // don't spawn directly on top of another vehicle at the entry
        if (this.startClear(v.edgeId, v.laneIndex)) {
          this.nextVehId++;
          this.vehicles.push(v);
        }
      } else {
        break;
      }
    }
  }

  private startClear(edgeId: string, lane: number): boolean {
    for (const v of this.vehicles) {
      if (v.edgeId === edgeId && v.laneIndex === lane && !v.onConnector && v.distOnEdge < 8) {
        return false;
      }
    }
    return true;
  }

  // ---- signals -------------------------------------------------------------

  private updateSignals(dt: number) {
    const q = queueMap(this.lastCong);
    // emergency override: any emergency vehicle within range of a junction gets a green wave
    const overridden = new Set<string>();
    if (this.cfg.applyInterventions) {
      for (const v of this.vehicles) {
        if (!(v.emergency || v.isResource) || v.onConnector) continue;
        const edge = this.net.edge(v.edgeId);
        if (!edge) continue;
        const distToEnd = this.net.edgeLength(v.edgeId) - v.distOnEdge;
        if (distToEnd < 90) {
          const sig = this.signals.get(edge.to);
          if (sig && sig.mode !== "failed" && sig.mode !== "manual") {
            setEmergencyOverride(sig, v.edgeId);
            overridden.add(edge.to);
          }
        }
      }
    }
    for (const sig of this.signals.values()) {
      if (sig.mode === "emergency" && !overridden.has(sig.nodeId)) clearOverride(sig);
      stepSignal(sig, dt, { queueByEdge: q }, this.net);
    }
  }

  // ---- incidents -----------------------------------------------------------

  addIncident(input: IncidentInput): Incident {
    const spec = INCIDENT_CATALOG[input.type];
    const sevMult = SEVERITY_DURATION_MULT[input.severity ?? spec.defaultSeverity];
    const dur =
      input.durationSec ??
      ((spec.durationMin[0] + spec.durationMin[1]) / 2) * 60 * sevMult;
    const pos = this.net.centreAt(input.edgeId, input.distOnEdge);
    const edgeLanes = this.net.laneCount(input.edgeId);
    const full = input.fullBlockage ?? spec.closesRoad;
    const side = input.laneSide ?? "both";
    const reqLanes = input.lanesAffected ?? spec.defaultLanes;
    const blockedLanes = blockedLaneSet(edgeLanes, reqLanes, side, full);
    const inc: Incident = {
      id: `inc${this.nextIncId++}`,
      type: input.type,
      edgeId: input.edgeId,
      distOnEdge: input.distOnEdge,
      lat: pos.lat,
      lon: pos.lon,
      severity: input.severity ?? spec.defaultSeverity,
      lanesAffected: blockedLanes.length,
      blockedLanes,
      laneSide: side,
      fullBlockage: full,
      startTime: this.time,
      durationSec: dur,
      baseDurationSec: dur,
      resourcesOnScene: [],
      responseApplied: false,
    };
    this.incidents.push(inc);

    if (spec.signalFailure) {
      const edge = this.net.edge(input.edgeId);
      const sig = edge && this.signals.get(edge.to);
      if (sig) sig.mode = "failed";
    }
    // NOTE: a full blockage physically stops vehicles (handled in computeAccel),
    // but the road is only *closed for routing* — i.e. traffic is actively
    // diverted away — when the authority applies a response. Without a response
    // (the ghost baseline) drivers keep heading into the blockage and pile up.
    return inc;
  }

  private closeEdge(edgeId: string, reroute = true) {
    this.closedEdges.add(edgeId);
    const opp = this.net.reverseId(edgeId);
    if (opp) this.closedEdges.add(opp);
    bumpClosedVersion();
    if (reroute) this.queueRerouteAffected();
  }

  private openEdge(edgeId: string) {
    this.closedEdges.delete(edgeId);
    const opp = this.net.reverseId(edgeId);
    if (opp) this.closedEdges.delete(opp);
  }

  private updateIncidents(dt: number) {
    for (const inc of this.incidents) {
      if (inc.clearedTime != null) continue;
      // clearance rate accelerated by on-scene resources
      let rate = 1;
      for (const rid of inc.resourcesOnScene) {
        const r = this.resources.find((x) => x.id === rid);
        if (r && r.status === "onscene") rate += RESOURCE_META[r.type].clearanceBoost;
      }
      inc.durationSec -= dt * rate;
      if (inc.durationSec <= 0) this.clearIncident(inc);
    }
  }

  private clearIncident(inc: Incident) {
    inc.clearedTime = this.time;
    inc.durationSec = 0;
    if (inc.fullBlockage) this.openEdge(inc.edgeId);
    const spec = INCIDENT_CATALOG[inc.type];
    if (spec.signalFailure) {
      const e = this.net.edge(inc.edgeId);
      const sig = e && this.signals.get(e.to);
      if (sig && sig.mode === "failed") {
        sig.mode = this.defaultSignalMode;
      }
    }
    // release resources
    for (const r of this.resources) {
      if (r.targetIncidentId === inc.id) r.status = "returning";
    }
  }

  activeIncidents(): Incident[] {
    return this.incidents.filter((i) => i.clearedTime == null);
  }

  private incidentsOnEdge(edgeId: string): Incident[] {
    return this.incidents.filter((i) => i.clearedTime == null && i.edgeId === edgeId);
  }

  // ---- vehicle movement ----------------------------------------------------

  private buildLaneIndex(): Map<string, Map<number, Vehicle[]>> {
    const idx = new Map<string, Map<number, Vehicle[]>>();
    for (const v of this.vehicles) {
      if (v.onConnector || v.arrived) continue;
      let lanes = idx.get(v.edgeId);
      if (!lanes) {
        lanes = new Map();
        idx.set(v.edgeId, lanes);
      }
      let arr = lanes.get(v.laneIndex);
      if (!arr) {
        arr = [];
        lanes.set(v.laneIndex, arr);
      }
      arr.push(v);
    }
    for (const lanes of idx.values()) {
      for (const arr of lanes.values()) arr.sort((a, b) => a.distOnEdge - b.distOnEdge);
    }
    return idx;
  }

  private applyMerges(idx: Map<string, Map<number, Vehicle[]>>) {
    for (const v of this.vehicles) {
      if (v.arrived || v.onConnector) continue;
      const lanes = this.net.laneCount(v.edgeId);
      if (lanes < 2) continue;
      for (const inc of this.incidentsOnEdge(v.edgeId)) {
        const ahead = inc.distOnEdge - v.distOnEdge;
        if (ahead < 0 || ahead > 60) continue;
        if (!inc.blockedLanes.includes(v.laneIndex)) continue;
        const target = this.pickMergeLane(v, inc, lanes, idx);
        if (target != null) {
          v.laneIndex = target;
          this.updateRenderPos(v);
        }
        break;
      }
    }
  }

  private pickMergeLane(
    v: Vehicle,
    inc: Incident,
    lanes: number,
    idx: Map<string, Map<number, Vehicle[]>>
  ): number | null {
    const cands = [v.laneIndex - 1, v.laneIndex + 1].filter(
      (l) => l >= 0 && l < lanes && !inc.blockedLanes.includes(l)
    );
    for (const c of cands) {
      const arr = idx.get(v.edgeId)?.get(c);
      let clear = true;
      if (arr) {
        for (const o of arr) {
          if (Math.abs(o.distOnEdge - v.distOnEdge) < v.lengthM + 4) {
            clear = false;
            break;
          }
        }
      }
      if (clear) return c;
    }
    return null;
  }

  /** Is a shift to `lane` longitudinally safe for v (no vehicle within the
   *  body+gap window in that lane)? O(lane occupancy near v). */
  private laneChangeSafe(
    v: Vehicle,
    lane: number,
    idx: Map<string, Map<number, Vehicle[]>>
  ): boolean {
    const arr = idx.get(v.edgeId)?.get(lane);
    if (!arr) return true;
    const need = v.lengthM + LC_GAP_M;
    for (const o of arr) {
      if (Math.abs(o.distOnEdge - v.distOnEdge) < need) return false;
    }
    return true;
  }

  /** Forward gap (m) to the next vehicle ahead in a given lane (∞ if none). */
  private laneForwardGap(
    v: Vehicle,
    lane: number,
    idx: Map<string, Map<number, Vehicle[]>>
  ): number {
    const arr = idx.get(v.edgeId)?.get(lane);
    if (!arr) return Infinity;
    for (const o of arr) {
      if (o.distOnEdge > v.distOnEdge) return o.distOnEdge - v.distOnEdge - o.lengthM;
    }
    return Infinity;
  }

  /** Realism lane-changing (Bug 5): (a) mandatory turn-lane positioning near a
   *  junction, (b) discretionary speed-seeking change. One lane per tick, gap-
   *  checked, with a cooldown so vehicles don't oscillate. O(n) via the index. */
  private applyLaneChanges(idx: Map<string, Map<number, Vehicle[]>>) {
    for (const v of this.vehicles) {
      if (v.arrived || v.onConnector) continue;
      const lanes = this.net.laneCount(v.edgeId);
      if (lanes < 2) continue;
      const edge = this.net.edge(v.edgeId);
      if (!edge) continue;

      // (a) Mandatory turn-lane positioning: approaching the junction, move toward
      // the lane the next movement needs. Left turn → kerb lane (lanes-1),
      // right turn → centreline lane (0), straight → keep. (Left-hand traffic.)
      const isLast = v.routeIdx >= v.route.length - 1;
      const distToEnd = this.net.edgeLength(v.edgeId) - v.distOnEdge;
      if (!isLast && distToEnd < TURN_LANE_LOOKAHEAD_M) {
        const nextEdge = v.route[v.routeIdx + 1];
        const turn = turnKind(this.net, v.edgeId, nextEdge);
        const want = turn === "left" ? lanes - 1 : turn === "right" || turn === "u_turn" ? 0 : v.laneIndex;
        if (want !== v.laneIndex) {
          const dir = want > v.laneIndex ? 1 : -1;
          const tgt = v.laneIndex + dir;
          if (tgt >= 0 && tgt < lanes && this.laneChangeSafe(v, tgt, idx)) {
            v.laneIndex = tgt;
            this.updateRenderPos(v);
          }
          continue; // mandatory takes precedence over discretionary this tick
        }
      }

      // (b) Discretionary: if a neighbouring lane is markedly freer ahead and the
      // change is safe, shift over. Cooldown prevents oscillation.
      if (v.lastLaneChangeT != null && this.time - v.lastLaneChangeT < LC_COOLDOWN_SEC) continue;
      const myGap = this.laneForwardGap(v, v.laneIndex, idx);
      if (myGap > 40) continue; // already free-flowing; no incentive
      let best = v.laneIndex;
      let bestGap = myGap;
      for (const cand of [v.laneIndex - 1, v.laneIndex + 1]) {
        if (cand < 0 || cand >= lanes) continue;
        const g = this.laneForwardGap(v, cand, idx);
        if (g > bestGap + LC_DISCRETIONARY_GAIN_M && this.laneChangeSafe(v, cand, idx)) {
          best = cand;
          bestGap = g;
        }
      }
      if (best !== v.laneIndex) {
        v.laneIndex = best;
        v.lastLaneChangeT = this.time;
        this.updateRenderPos(v);
      }
    }
  }

  private moveVehicles(dt: number) {
    let idx = this.buildLaneIndex();

    // mandatory merge: vehicles in a lane blocked by an incident ahead move into
    // an adjacent open lane when a gap exists, so the open lane carries the flow
    // (a real bottleneck) instead of the blocked lane stalling permanently.
    this.applyMerges(idx);
    idx = this.buildLaneIndex();

    // realism: discretionary + mandatory turn-lane changes, then re-index.
    if (this.cfg.realism) {
      this.applyLaneChanges(idx);
      idx = this.buildLaneIndex();
    }

    // pass 1: compute acceleration
    for (const v of this.vehicles) {
      if (v.arrived || v.onConnector) continue;
      v.accel = this.computeAccel(v, idx);
    }

    // pass 2: integrate + transitions
    const survivors: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      if (v.onConnector) {
        this.advanceConnector(v, dt);
      } else {
        v.speed = Math.max(0, v.speed + v.accel * dt);
        const desired = this.desiredSpeed(v);
        if (v.speed > desired) v.speed = desired;
        v.distOnEdge += v.speed * dt;
        v.distanceTravelled += v.speed * dt;
        if (v.speed < 0.5) v.stoppedTime += dt;
        this.handleEdgeEnd(v, idx);
      }
      if (!v.arrived) {
        this.updateRenderPos(v);
        survivors.push(v);
      } else if (!v.isResource) {
        this.metrics.recordArrival(v, this.time);
      }
    }
    this.vehicles = survivors;
  }

  /** Realism road-class speed factors. Calibration-tunable (set via Engine
   *  static before construction) but defaults match the SUMO-calibrated values.
   *  Legacy /simulation keeps the inline literals below, untouched. */
  static REALISM_SPEED_FACTORS: Record<string, number> = {
    arterial: 1.15,
    sub_arterial: 1.0,
    collector: 0.82,
    local: 0.65,
    motorway: 1.25,
  };

  private desiredSpeed(v: Vehicle): number {
    const edge = this.net.edge(v.edgeId);
    let v0 = VEHICLE_DESIRED_MS[v.type];
    if (edge) {
      let f: number;
      if (this.cfg.realism) {
        f = Engine.REALISM_SPEED_FACTORS[edge.road_class] ?? 0.65;
      } else {
        f =
          edge.road_class === "arterial" ? 1 :
          edge.road_class === "sub_arterial" ? 0.85 :
          edge.road_class === "collector" ? 0.7 : 0.55;
      }
      v0 *= f;
    }
    return v0;
  }

  private computeAccel(v: Vehicle, idx: Map<string, Map<number, Vehicle[]>>): number {
    const edgeLen = this.net.edgeLength(v.edgeId);
    const edge = this.net.edge(v.edgeId)!;
    const priority = v.emergency || v.isResource;
    const params: IdmParams = { v0: this.desiredSpeed(v), ...DEFAULT_IDM };
    if (priority) {
      params.v0 *= 1.3;
      params.T *= 0.5;
      params.s0 = 1.2;
    }
    let gap = Infinity;
    let leaderV = 0;

    // 1) leader in same lane
    const arr = idx.get(v.edgeId)?.get(v.laneIndex);
    if (arr) {
      for (const o of arr) {
        if (o.distOnEdge > v.distOnEdge) {
          gap = o.distOnEdge - v.distOnEdge - o.lengthM;
          leaderV = o.speed;
          break;
        }
      }
    }
    // priority vehicles filter through queues: ignore leaders unless very close
    if (priority && gap >= 6) {
      gap = Infinity;
      leaderV = 0;
    }

    // 2) incident ahead on this edge
    for (const inc of this.incidentsOnEdge(v.edgeId)) {
      if (inc.distOnEdge < v.distOnEdge) continue;
      const blocked = inc.blockedLanes.includes(v.laneIndex);
      if (blocked && priority) {
        // priority vehicles squeeze past / merge rather than hard-stop
        const d = inc.distOnEdge - v.distOnEdge;
        if (d < 30) params.v0 = Math.min(params.v0, 3);
      } else if (blocked) {
        const g = inc.distOnEdge - v.distOnEdge - 2;
        if (g < gap) {
          gap = g;
          leaderV = 0;
        }
      } else {
        // unblocked lane: slow down past the scene
        const d = inc.distOnEdge - v.distOnEdge;
        if (d < 45) params.v0 = Math.min(params.v0, 5);
      }
    }

    // 3) junction gate at the downstream end
    const isLast = v.routeIdx >= v.route.length - 1;
    if (!isLast) {
      const sig = this.signals.get(edge.to);
      const nextEdge = v.route[v.routeIdx + 1];
      const turn = turnKind(this.net, v.edgeId, nextEdge);
      let mustStop = false;
      if (sig) {
        if (sig.mode === "failed") {
          mustStop = false;
          params.v0 = Math.min(params.v0, 4);
        } else if (!mayProceed(sig, v.edgeId, turn)) {
          mustStop = true;
        }
      } else if (!priority) {
        // Unsignalized: minor road yields to major cross-traffic at junction
        mustStop = this.mustYieldUnsignalized(v, edge.to, nextEdge, idx);
      }
      // downstream space / closure gate (spillback)
      if (!mustStop) {
        if (this.closedEdges.has(nextEdge)) {
          mustStop = true;
        } else if (!priority) {
          const toLane = Math.min(v.laneIndex, this.net.laneCount(nextEdge) - 1);
          const blocked = this.cfg.realism
            ? !this.exitRoom(idx, nextEdge, toLane, v.lengthM)
            : this.headroom(idx, nextEdge, toLane) < v.lengthM + SAFE_GAP;
          if (blocked) mustStop = true;
        }
      }
      if (mustStop) {
        // Stop a realistic setback BEFORE the junction box, never on the node.
        const stopGap = edgeLen - v.distOnEdge - this.stopLineSetback(edge.to);
        if (stopGap < gap) {
          gap = Math.max(0, stopGap);
          leaderV = 0;
        }
      }
    }

    return idmAccel(v.speed, gap, leaderV, params);
  }

  /** Unsignalized junction: gap-acceptance yield (Task 4).
   *  Yields if (a) a conflicting movement already occupies the junction, or
   *  (b) a higher-priority approach has approaching traffic whose time-gap to the
   *  conflict point is below the critical headway. Uses the lane index for O(1)
   *  leader lookup per approach lane instead of scanning every vehicle (Task 8). */
  private mustYieldUnsignalized(
    v: Vehicle,
    nodeId: string,
    nextEdge: string,
    idx: Map<string, Map<number, Vehicle[]>>
  ): boolean {
    const active = this.junctionActive.get(nodeId);
    if (active?.size) {
      for (const other of active) {
        const [oFrom, oTo] = other.split(">");
        if (this.movementsConflict(v.edgeId, nextEdge, oFrom, oTo)) return true;
      }
    }
    const myPri = roadPri(this.net, v.edgeId);
    // Critical headway (s): the minimum acceptable time-gap on the major road.
    const CRITICAL_GAP_SEC = this.cfg.realism ? 4.5 : 3.5;
    for (const inc of this.net.incoming.get(nodeId) ?? []) {
      if (inc.id === v.edgeId) continue;
      const otherPri = roadPri(this.net, inc.id);
      if (otherPri < myPri) continue; // never yield to a strictly lower-priority road
      if (otherPri === myPri) {
        // Equal priority: legacy never yields here (collision/overlap). In realism,
        // apply the give-way-to-the-right rule (left-hand traffic) so exactly one
        // of the two conflicting approaches yields — no deadlock.
        if (!this.cfg.realism) continue;
        if (!this.approachOnRight(v.edgeId, inc.id)) continue;
      }
      const lanes = this.net.laneCount(inc.id);
      const incLen = this.net.edgeLength(inc.id);
      const lanesByEdge = idx.get(inc.id);
      for (let lane = 0; lane < lanes; lane++) {
        // The closest-to-junction vehicle in this approach lane = last entry
        // (lanes are sorted ascending by distOnEdge).
        const arr = lanesByEdge?.get(lane);
        if (!arr || !arr.length) continue;
        const o = arr[arr.length - 1];
        if (o.onConnector || o.arrived) continue;
        const distToEnd = incLen - o.distOnEdge;
        if (distToEnd > 60) continue; // too far to matter
        // Time-gap to the conflict point. A near-stopped vehicle at the line
        // still blocks (it has/road right-of-way), so treat low speed as ~now.
        const tGap = o.speed > 0.5 ? distToEnd / o.speed : 0;
        if (tGap < CRITICAL_GAP_SEC) return true;
      }
    }
    return false;
  }

  /** Local-metre chord of a movement: from the approach edge's end point to the
   *  exit edge's start point. Cached per (from,to). Used for geometric conflict
   *  detection (realism). The frame is an arbitrary flat projection — only
   *  relative geometry matters for the crossing test. */
  private chordCache = new Map<string, { ax: number; ay: number; bx: number; by: number }>();
  private movementChord(fromEdge: string, toEdge: string) {
    const key = `${fromEdge}>${toEdge}`;
    const cached = this.chordCache.get(key);
    if (cached) return cached;
    const a = this.net.centreAt(fromEdge, this.net.edgeLength(fromEdge));
    const b = this.net.centreAt(toEdge, 0);
    // flat-earth metres relative to point a
    const mPerLon = 111320 * Math.cos((a.lat * Math.PI) / 180);
    const chord = {
      ax: 0,
      ay: 0,
      bx: (b.lon - a.lon) * mPerLon,
      by: (b.lat - a.lat) * 111320,
    };
    this.chordCache.set(key, chord);
    return chord;
  }

  /** Whether two junction movements conflict. Realism: they conflict iff they
   *  share the same exit edge (merge into one stream) OR their chords actually
   *  cross. Non-crossing movements from different approaches (e.g. diverging
   *  right turns) may run concurrently. Legacy: any different-approach pair
   *  conflicts (preserved for /simulation). */
  private movementsConflict(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
    if (aFrom === bFrom) return false; // same approach → queue, not conflict
    if (!this.cfg.realism) return movementsConflictLegacy(aFrom, bFrom);
    if (aTo === bTo) return true; // converge onto the same exit → merge conflict
    const c1 = this.movementChord(aFrom, aTo);
    const c2 = this.movementChord(bFrom, bTo);
    return segmentsCross(c1.ax, c1.ay, c1.bx, c1.by, c2.ax, c2.ay, c2.bx, c2.by);
  }

  /** Give-way-to-the-right test (left-hand traffic). True if the `other` approach
   *  arrives from my right, meaning I must yield to it. Uses each approach edge's
   *  travel heading at the node; the right side is the clockwise quarter ahead. */
  private approachOnRight(myEdge: string, otherEdge: string): boolean {
    const myH = this.net.centreAt(myEdge, this.net.edgeLength(myEdge)).heading;
    const otherH = this.net.centreAt(otherEdge, this.net.edgeLength(otherEdge)).heading;
    // Relative bearing of the other approach's *origin* direction vs my heading.
    // The other vehicle travels along otherH toward the node, so it comes FROM
    // bearing (otherH + π). Right-of-me ⇒ that source is in my right hemisphere.
    let rel = (otherH + Math.PI) - myH;
    rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // [0, 2π)
    // In a standard heading frame (atan2(north, east)), turning right (clockwise)
    // decreases angle; "from the right" lands in (π, 2π).
    return rel > Math.PI;
  }

  private acquireJunction(nodeId: string, fromEdge: string, toEdge: string): boolean {
    const key = movementKey(fromEdge, toEdge);
    let set = this.junctionActive.get(nodeId);
    if (!set) {
      set = new Set();
      this.junctionActive.set(nodeId, set);
    }
    for (const other of set) {
      const [oFrom, oTo] = other.split(">");
      if (this.movementsConflict(fromEdge, toEdge, oFrom, oTo)) return false;
    }
    set.add(key);
    return true;
  }

  private releaseJunction(nodeId: string, fromEdge: string, toEdge: string) {
    const key = movementKey(fromEdge, toEdge);
    const set = this.junctionActive.get(nodeId);
    if (set) {
      set.delete(key);
      if (!set.size) this.junctionActive.delete(nodeId);
    }
  }

  /** Stop-line setback (m) before a junction node: vehicles hold this far back so
   *  they never stop on/inside the intersection box. Approximated once per node
   *  from the widest approach (more lanes / bigger junction → larger box) and
   *  cached. In legacy (non-realism) mode this is the original 1 m. */
  private setbackCache = new Map<string, number>();
  private stopLineSetback(nodeId: string): number {
    if (!this.cfg.realism) return LEGACY_STOP_SETBACK_M;
    const cached = this.setbackCache.get(nodeId);
    if (cached != null) return cached;
    // Junction half-width ≈ widest crossing leg. Lane width ~3.4 m; add a small
    // clearance. Bounded so huge multi-lane arterials don't push the stop line
    // unrealistically far back.
    let maxLanes = 1;
    for (const e of this.net.incoming.get(nodeId) ?? []) maxLanes = Math.max(maxLanes, this.net.laneCount(e.id));
    for (const e of this.net.outgoing.get(nodeId) ?? []) maxLanes = Math.max(maxLanes, this.net.laneCount(e.id));
    const setback = Math.min(14, Math.max(3, maxLanes * 3.4 + 1.5));
    this.setbackCache.set(nodeId, setback);
    return setback;
  }

  /** distance from the start of an edge/lane to the nearest vehicle (O(1) via index). */
  private headroom(idx: Map<string, Map<number, Vehicle[]>>, edgeId: string, lane: number): number {
    const arr = idx.get(edgeId)?.get(lane);
    if (!arr || !arr.length) return this.net.edgeLength(edgeId);
    return arr[0].distOnEdge; // sorted ascending by distOnEdge
  }

  /** Realism junction-blocking gate (Bug 3): is there room for the WHOLE vehicle
   *  to clear the junction box onto the target lane? The plain `headroom` returns
   *  only the nearest vehicle's nose, so a car could nose into a junction whose
   *  exit is actually jammed. Here we require a contiguous free span at the lane
   *  mouth ≥ vehLen + SAFE_GAP AND that the first downstream vehicle isn't sitting
   *  jammed right at the entrance. O(1) — reads the sorted lane head only. */
  private exitRoom(
    idx: Map<string, Map<number, Vehicle[]>>,
    edgeId: string,
    lane: number,
    vehLen: number
  ): boolean {
    const need = vehLen + SAFE_GAP;
    const arr = idx.get(edgeId)?.get(lane);
    if (!arr || !arr.length) return this.net.edgeLength(edgeId) >= need;
    const lead = arr[0];
    // Free span from the lane mouth to the lead vehicle's tail.
    const span = lead.distOnEdge - lead.lengthM;
    if (span < need) return false;
    // Lead vehicle queued at/near the mouth (slow & close) ⇒ spillback risk even
    // if its tail nominally leaves room; hold back to keep the box clear.
    if (lead.speed < 1 && lead.distOnEdge < need + lead.lengthM + 2) return false;
    return true;
  }

  private handleEdgeEnd(v: Vehicle, idx: Map<string, Map<number, Vehicle[]>>) {
    const edgeLen = this.net.edgeLength(v.edgeId);
    if (v.distOnEdge < edgeLen) return;
    const isLast = v.routeIdx >= v.route.length - 1;
    if (isLast) {
      v.arrived = true;
      return;
    }
    const jNode = this.net.edge(v.edgeId)!.to;
    // Where a blocked vehicle is held: at the stop line (clear of the junction
    // box) in realism mode, at the node in legacy mode.
    const holdDist = edgeLen - (this.cfg.realism ? this.stopLineSetback(jNode) : 0);
    const hold = () => {
      v.distOnEdge = Math.min(v.distOnEdge, holdDist);
      v.speed = 0;
    };
    const nextEdge = v.route[v.routeIdx + 1];
    // closed → try reroute from current node
    if (this.closedEdges.has(nextEdge)) {
      const rr = reroute(this.net, this.net.edge(v.edgeId)!.to, v.destNode, this.closedEdges, utilizationMap(this.lastCong));
      if (rr && rr.length) {
        v.route = [v.edgeId, ...rr];
        v.routeIdx = 0;
      } else {
        hold();
        return;
      }
    }
    const target = v.route[v.routeIdx + 1];
    const toLane = Math.min(v.laneIndex, this.net.laneCount(target) - 1);
    const priority = v.emergency || v.isResource;
    // Junction-blocking rule: don't enter unless the whole vehicle fits downstream.
    const noRoom = this.cfg.realism
      ? !this.exitRoom(idx, target, toLane, v.lengthM)
      : this.headroom(idx, target, toLane) < v.lengthM + SAFE_GAP;
    if (!priority && noRoom) {
      hold();
      return;
    }
    if (!priority && !this.acquireJunction(jNode, v.edgeId, target)) {
      hold();
      return;
    }
    // enter turn connector
    const overshoot = v.distOnEdge - edgeLen;
    v.onConnector = true;
    v.connectorFrom = v.edgeId;
    v.connectorTo = target;
    v.connectorFromLane = v.laneIndex;
    v.connectorToLane = toLane;
    v.connectorT = Math.max(0, overshoot);
    v.connectorJunction = jNode;
  }

  /** Target speed through a turn connector from its turn type + length (realism).
   *  A longer/sweeping connector lets a vehicle hold more speed (lat-accel bound);
   *  priority vehicles take turns a bit faster. */
  private turnTargetSpeed(v: Vehicle, conn: { lengthM: number }): number {
    const turn = turnKind(this.net, v.connectorFrom!, v.connectorTo!);
    let target = TURN_SPEED_MS[turn];
    // Geometric bound: a sharper (shorter) connector implies a tighter radius;
    // approximate radius ~ lengthM/2 and cap by v = sqrt(a_lat * r).
    const r = Math.max(2, conn.lengthM / 2);
    const geomCap = Math.sqrt(TURN_LAT_ACCEL * r);
    target = Math.min(target, Math.max(geomCap, TURN_MIN_MS));
    if (v.emergency || v.isResource) target *= 1.3;
    return Math.max(TURN_MIN_MS, target);
  }

  private advanceConnector(v: Vehicle, dt: number) {
    const conn = this.net.connector(v.connectorFrom!, v.connectorFromLane ?? 0, v.connectorTo!, v.connectorToLane ?? 0);
    if (this.cfg.realism) {
      // Accelerate/decelerate smoothly toward the geometric turn speed instead of
      // snapping to a flat crawl. Bounded by IDM accel/decel so entry & exit are smooth.
      const target = this.turnTargetSpeed(v, conn);
      const a = target > v.speed ? DEFAULT_IDM.aMax : DEFAULT_IDM.b;
      const step = a * dt;
      v.speed = target > v.speed
        ? Math.min(target, v.speed + step)
        : Math.max(target, v.speed - step);
      v.speed = Math.max(TURN_MIN_MS, v.speed);
    } else {
      v.speed = Math.max(1.5, v.speed); // crawl through the turn
    }
    v.connectorT += v.speed * dt;
    v.distanceTravelled += v.speed * dt;
    if (v.connectorT >= conn.lengthM) {
      if (v.connectorJunction && v.connectorFrom && v.connectorTo) {
        this.releaseJunction(v.connectorJunction, v.connectorFrom, v.connectorTo);
      }
      v.edgeId = v.connectorTo!;
      v.laneIndex = v.connectorToLane ?? 0;
      v.routeIdx += 1;
      v.distOnEdge = Math.max(0, v.connectorT - conn.lengthM);
      v.onConnector = false;
      v.connectorJunction = undefined;
      this.updateRenderPos(v);
    } else {
      const p = this.net.connectorAt(conn, v.connectorT);
      v.lat = p.lat;
      v.lon = p.lon;
      v.heading = p.heading;
    }
  }

  private updateRenderPos(v: Vehicle) {
    const p = this.net.laneAt(v.edgeId, v.laneIndex, v.distOnEdge);
    v.lat = p.lat;
    v.lon = p.lon;
    v.heading = p.heading;
  }

  private rerouteAffected() {
    const util = utilizationMap(this.lastCong);
    for (const v of this.vehicles) {
      if (v.isResource || v.onConnector) continue;
      const remaining = v.route.slice(v.routeIdx + 1);
      if (!remaining.some((e) => this.closedEdges.has(e))) continue;
      const fromNode = this.net.edge(v.edgeId)!.to;
      const rr = reroute(this.net, fromNode, v.destNode, this.closedEdges, util);
      if (rr && rr.length) {
        v.route = [v.edgeId, ...rr];
        v.routeIdx = 0;
      }
    }
  }

  private queueRerouteAffected() {
    this.rerouteQueue = [];
    for (const v of this.vehicles) {
      if (v.isResource || v.onConnector) continue;
      const remaining = v.route.slice(v.routeIdx + 1);
      if (remaining.some((e) => this.closedEdges.has(e))) {
        this.rerouteQueue.push(v.id);
      }
    }
  }

  private processRerouteQueue() {
    if (!this.rerouteQueue.length) return;
    const util = utilizationMap(this.lastCong);
    const batch = this.rerouteQueue.splice(0, REROUTE_BATCH);
    for (const vid of batch) {
      const v = this.vehicles.find((x) => x.id === vid);
      if (!v || v.isResource || v.onConnector) continue;
      const remaining = v.route.slice(v.routeIdx + 1);
      if (!remaining.some((e) => this.closedEdges.has(e))) continue;
      const fromNode = this.net.edge(v.edgeId)!.to;
      const rr = reroute(this.net, fromNode, v.destNode, this.closedEdges, util);
      if (rr && rr.length) {
        v.route = [v.edgeId, ...rr];
        v.routeIdx = 0;
      }
    }
  }

  // ---- resources -----------------------------------------------------------

  /** Dispatch a resource of the given type to an incident. Returns null on shortage. */
  private depotCounter = new Map<ResourceType, number>();

  /** Pick a valid depot node: one of the boundary sources nearest the incident,
   *  rotated per type so repeated dispatches enter from different directions. */
  private pickDepot(type: ResourceType, nearNode: string): string {
    const pool = (this.net.sources.length ? this.net.sources : [...this.net.nodes.keys()])
      .filter((id) => id !== nearNode);
    if (!pool.length) return nearNode;
    const t = this.net.nodes.get(nearNode)!;
    const sorted = pool.slice().sort((a, b) => {
      const na = this.net.nodes.get(a)!;
      const nb = this.net.nodes.get(b)!;
      const da = (na.lat - t.lat) ** 2 + (na.lon - t.lon) ** 2;
      const db = (nb.lat - t.lat) ** 2 + (nb.lon - t.lon) ** 2;
      return da - db;
    });
    const near = sorted.slice(0, Math.min(5, sorted.length));
    const k = this.depotCounter.get(type) ?? 0;
    this.depotCounter.set(type, k + 1);
    return near[k % near.length];
  }

  dispatchResource(type: ResourceType, incidentId: string): Resource | null {
    const inUse = this.fleetInUse.get(type) ?? 0;
    if (inUse >= FLEET_CAPACITY[type]) return null; // resource shortage edge case
    this.fleetInUse.set(type, inUse + 1);
    const meta = RESOURCE_META[type];
    const inc = this.incidents.find((i) => i.id === incidentId);
    const incNode = inc ? this.net.edge(inc.edgeId)!.from : undefined;
    const res: Resource = {
      id: `res${this.nextResId++}`,
      type,
      status: meta.mobile ? "enroute" : "onscene",
      homeNode: meta.mobile && incNode ? this.pickDepot(type, incNode) : "",
      targetIncidentId: incidentId,
    };

    if (!meta.mobile) {
      // static equipment placed immediately
      inc?.resourcesOnScene.push(res.id);
      this.resources.push(res);
      return res;
    }

    // mobile: create a routed resource vehicle from depot to incident node,
    // approaching from an open side (avoid the blocked edge itself).
    const goalNode = incNode ?? res.homeNode;
    const avoid = new Set<string>(this.closedEdges);
    if (inc) {
      avoid.add(inc.edgeId);
      const rev = this.net.reverseId(inc.edgeId);
      if (rev) avoid.add(rev);
    }
    const route = reroute(this.net, res.homeNode, goalNode, avoid, utilizationMap(this.lastCong));
    if (route && route.length) {
      const veh = makeVehicle(this.nextVehId++, meta.vehicleType!, route, res.homeNode, goalNode, this.time, this.net);
      veh.isResource = true;
      // all dispatched mobile resources get priority movement + signal preemption
      veh.emergency = true;
      this.vehicles.push(veh);
      res.vehicleId = veh.id;
      res.etaSec = route.reduce((s, id) => s + this.net.edgeLength(id), 0) / meta.speedMs;
    } else {
      // can't route — still mark on scene after a delay-free fallback
      res.status = "onscene";
      inc?.resourcesOnScene.push(res.id);
    }
    this.resources.push(res);
    return res;
  }

  private updateResources() {
    for (const r of this.resources) {
      if (r.status === "enroute" && r.vehicleId != null) {
        const veh = this.vehicles.find((v) => v.id === r.vehicleId);
        if (!veh || veh.arrived) {
          r.status = "onscene";
          const inc = this.incidents.find((i) => i.id === r.targetIncidentId);
          if (inc && !inc.resourcesOnScene.includes(r.id)) inc.resourcesOnScene.push(r.id);
          // officer on a failed signal → manual control
          if ((r.type === "officer" || r.type === "portable_signal") && inc) {
            const e = this.net.edge(inc.edgeId);
            const sig = e && this.signals.get(e.to);
            if (sig && sig.mode === "failed") {
              sig.mode = "manual";
              sig.overrideEdge = e!.id;
            }
          }
        }
      } else if (r.status === "returning") {
        // free up the fleet slot
        const inUse = this.fleetInUse.get(r.type) ?? 1;
        this.fleetInUse.set(r.type, Math.max(0, inUse - 1));
        r.status = "idle";
      }
    }
    this.resources = this.resources.filter((r) => r.status !== "idle");
  }

  // ---- diversions / interventions -----------------------------------------

  /** Apply a diversion strategy around an incident: split traffic across k routes.
   *  When the ranked diversion corridor edges are supplied (computed by the
   *  decision engine), give that corridor signal priority so the diverted flow
   *  actually moves. Previously the ranked corridors were computed for display
   *  but never influenced the simulation — so the applied "response" was cruder
   *  than the recommended plan. */
  applyDiversion(incidentId: string, strategy: DiversionStrategy, corridorEdges?: string[]) {
    if (!this.cfg.applyInterventions) return;
    const inc = this.incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    inc.responseApplied = true;
    if (strategy === "full" || strategy === "perimeter" || strategy === "corridor") {
      if (!this.closedEdges.has(inc.edgeId)) this.closeEdge(inc.edgeId, true);
    } else {
      // local/split/oneway: soft-discourage by rerouting a share of vehicles
      this.rerouteShare(inc.edgeId, strategy === "split" ? 0.7 : 0.4);
    }
    if (corridorEdges && corridorEdges.length) this.prioritizeCorridor(corridorEdges);
  }

  /** Give a diversion corridor signal priority: switch its junctions to adaptive
   *  control so they extend green for the (now heavier) diverted movement. */
  prioritizeCorridor(edgeIds: string[]) {
    for (const eid of edgeIds) {
      const e = this.net.edge(eid);
      if (!e) continue;
      for (const nodeId of [e.to, e.from]) {
        const sig = this.signals.get(nodeId);
        if (sig && sig.mode === "fixed") sig.mode = "adaptive";
      }
    }
  }

  private rerouteShare(edgeId: string, share: number) {
    const util = utilizationMap(this.lastCong);
    for (const v of this.vehicles) {
      if (v.isResource || v.onConnector) continue;
      const remaining = v.route.slice(v.routeIdx + 1);
      if (!remaining.includes(edgeId)) continue;
      if (this.rng() > share) continue;
      const fromNode = this.net.edge(v.edgeId)!.to;
      const avoid = new Set([...this.closedEdges, edgeId]);
      const rr = reroute(this.net, fromNode, v.destNode, avoid, util);
      if (rr && rr.length) {
        v.route = [v.edgeId, ...rr];
        v.routeIdx = 0;
      }
    }
  }

  /** Adjust signals near an incident: switch them to adaptive control. */
  applySignalPlan(incidentId: string) {
    if (!this.cfg.applyInterventions) return;
    const inc = this.incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    const e = this.net.edge(inc.edgeId);
    if (!e) return;
    // make the incident junction + its upstream neighbours adaptive
    const target = new Set<string>([e.to, e.from]);
    for (const sig of this.signals.values()) {
      if (target.has(sig.nodeId) && sig.mode === "fixed") sig.mode = "adaptive";
    }
  }

  // ---- snapshot ------------------------------------------------------------

  fleetUsage(): { type: ResourceType; inUse: number; capacity: number }[] {
    return (Object.keys(FLEET_CAPACITY) as ResourceType[]).map((t) => ({
      type: t,
      inUse: this.fleetInUse.get(t) ?? 0,
      capacity: FLEET_CAPACITY[t],
    }));
  }

  congestionList(): EdgeCongestion[] {
    return [...this.lastCong.values()];
  }

  congestionByEdge(): Map<string, EdgeCongestion> {
    return this.lastCong;
  }

  snapshot(): SimSnapshot {
    const cong = this.congestionList();
    return {
      metrics: this.metrics.snapshot(this.time, this.vehicles, cong),
      incidents: this.activeIncidents(),
      resources: this.resources.filter((r) => r.status !== "idle"),
      congestion: cong,
      signals: [...this.signals.values()].map((s) => ({
        nodeId: s.nodeId,
        state: s.inAllRed
          ? ("red" as const)
          : s.inYellow
            ? ("yellow" as const)
            : s.mode === "failed"
              ? ("red" as const)
              : ("green" as const),
        phase: s.phaseIdx,
      })),
      vehicleCount: this.vehicles.filter((v) => !v.isResource).length,
    };
  }
}
