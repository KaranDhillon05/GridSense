// Generates realistic incident scenarios for Night Watch Monte Carlo batch runs.
// Location weights derived from hotspots.json; type weights from historical
// frequencies; duration from INCIDENT_CATALOG + correction factors.

import { INCIDENT_CATALOG, SEVERITY_DURATION_MULT } from "@/lib/sim/incidents";
import { getNetwork } from "@/lib/sim/network";
import { mulberry32 } from "@/lib/sim/demand";
import type { IncidentType, Severity } from "@/lib/sim/types";
import type { NWScenario } from "./types";
import hotspots from "@/data/hotspots.json";
import correctionFactors from "@/data/correction_factors.json";

type Hotspot = { lat: number; lon: number; count: number };
type CorrectionFactors = { by_cause: Record<string, number> };

const CORRECTIONS = (correctionFactors as CorrectionFactors).by_cause ?? {};

// Incident type weights: vehicle_breakdown, bus_breakdown, truck_breakdown,
// minor_accident, major_accident, signal_failure, road_construction,
// waterlogging, political_rally, others evenly split from remainder.
const TYPE_WEIGHTS: [IncidentType, number][] = [
  ["vehicle_breakdown", 35],
  ["minor_accident", 20],
  ["bus_breakdown", 10],
  ["major_accident", 8],
  ["signal_failure", 8],
  ["road_construction", 6],
  ["waterlogging", 5],
  ["political_rally", 3],
  ["truck_breakdown", 3],
  ["protest", 2],
];

// Severity distribution per incident category.
const SEVERITY_BY_CATEGORY: Record<string, [Severity, number][]> = {
  breakdown: [["low", 50], ["moderate", 35], ["high", 15], ["severe", 0]],
  accident: [["low", 5], ["moderate", 30], ["high", 45], ["severe", 20]],
  hazard: [["low", 10], ["moderate", 30], ["high", 40], ["severe", 20]],
  closure: [["low", 0], ["moderate", 15], ["high", 55], ["severe", 30]],
  event: [["low", 0], ["moderate", 20], ["high", 50], ["severe", 30]],
  infra: [["low", 20], ["moderate", 50], ["high", 25], ["severe", 5]],
};

// Peak-hour time weights (sec of day). Bins of ~1 hour each.
// Each entry: [startSec, weightMultiplier]
const PEAK_HOURS = [
  [7 * 3600, 3.0], [8 * 3600, 3.5], [9 * 3600, 2.5],
  [17 * 3600, 3.0], [18 * 3600, 3.5], [19 * 3600, 2.5], [20 * 3600, 1.5],
];

function weightedSample<T>(items: [T, number][], rng: () => number): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

function sampleSeverity(category: string, rng: () => number): Severity {
  const dist = SEVERITY_BY_CATEGORY[category] ?? SEVERITY_BY_CATEGORY.breakdown;
  return weightedSample(dist, rng);
}

function sampleStartTime(rng: () => number): number {
  // Build a weighted bucket list of 1-hour slots.
  const buckets: [number, number][] = [];
  for (let h = 0; h < 24; h++) {
    const sec = h * 3600;
    const peak = PEAK_HOURS.find(([s]) => s === sec);
    buckets.push([sec, peak ? peak[1] : 1.0]);
  }
  const slot = weightedSample(buckets, rng);
  // Uniform within the hour.
  return slot + Math.floor(rng() * 3600);
}

function durationMin(type: IncidentType, severity: Severity, rng: () => number): number {
  const spec = INCIDENT_CATALOG[type];
  const [lo, hi] = spec.durationMin;
  const base = lo + rng() * (hi - lo);
  const sevMult = SEVERITY_DURATION_MULT[severity];
  // Map incident type to correction_factors cause key.
  const causeKey = type.replace("vehicle_breakdown", "vehicle_breakdown")
    .replace("bus_breakdown", "vehicle_breakdown")
    .replace("truck_breakdown", "vehicle_breakdown")
    .replace("minor_accident", "accident")
    .replace("major_accident", "accident")
    .replace("multi_vehicle_accident", "accident")
    .replace("road_construction", "construction")
    .replace("metro_construction", "construction")
    .replace("waterlogging", "water_logging");
  const corrFactor = CORRECTIONS[causeKey] ?? 1.0;
  return base * sevMult * corrFactor;
}

// Cache edge weights lazily — build once from hotspot proximity.
let _edgeWeights: [string, number, string, number, number][] | null = null;

function getEdgeWeights(): [string, number, string, number, number][] {
  if (_edgeWeights) return _edgeWeights;
  const net = getNetwork();
  const hotspotsData = hotspots as Hotspot[];

  // Road class priority base weight.
  const classBase: Record<string, number> = {
    arterial: 4, sub_arterial: 2, collector: 1.5, local: 1,
  };

  const result: [string, number, string, number, number][] = [];
  for (const e of net.edges) {
    const edgeMid = net.centreAt(e.id, net.edgeLength(e.id) / 2);
    // Find nearest hotspot and use its count as weight boost.
    let hotspotBoost = 0;
    for (const hs of hotspotsData) {
      const dlat = hs.lat - edgeMid.lat;
      const dlon = hs.lon - edgeMid.lon;
      const dist = Math.sqrt(dlat * dlat + dlon * dlon);
      if (dist < 0.01) { // ~1km tolerance
        hotspotBoost = Math.max(hotspotBoost, hs.count / 20);
      }
    }
    const base = classBase[e.road_class] ?? 1;
    const w = base + hotspotBoost;
    result.push([e.id, w, e.name ?? "Unnamed Road", edgeMid.lat, edgeMid.lon]);
  }
  _edgeWeights = result;
  return result;
}

function sampleEdge(rng: () => number): { edgeId: string; name: string; lat: number; lon: number } {
  const weights = getEdgeWeights();
  const items: [[string, string, number, number], number][] = weights.map(
    ([id, w, name, lat, lon]) => [[id, name, lat, lon], w]
  );
  const [edgeId, name, lat, lon] = weightedSample(items, rng);
  return { edgeId, name, lat, lon };
}

export function generateScenario(seed: number): NWScenario {
  const rng = mulberry32(seed);
  const incidentType = weightedSample(TYPE_WEIGHTS, rng);
  const spec = INCIDENT_CATALOG[incidentType];
  const severity = sampleSeverity(spec.category, rng);
  const { edgeId, name } = sampleEdge(rng);
  const startTimeSec = sampleStartTime(rng);
  const dur = durationMin(incidentType, severity, rng);
  const lanes = Math.max(1, Math.min(spec.defaultLanes, 3));

  return {
    seed,
    incidentType,
    edgeId,
    edgeName: name,
    startTimeSec,
    durationMin: dur,
    severity,
    lanesAffected: lanes,
  };
}
