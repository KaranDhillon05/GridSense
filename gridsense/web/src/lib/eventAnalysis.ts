import aggregates from "@/data/aggregates.json";
import events from "@/data/events_slim.json";
import hotspots from "@/data/hotspots.json";
import type { AreaAnalysis, AttendanceBand } from "@/lib/types";

type Hotspot = {
  lat: number;
  lon: number;
  count: number;
};

type SlimEvent = {
  corridor?: string | null;
  junction?: string | null;
  latitude?: number;
  longitude?: number;
};

type AggregatesData = {
  cause_severity?: Record<string, number>;
};

const ATTENDANCE_RADIUS: Record<AttendanceBand, number> = {
  under_500: 350,
  between_500_2000: 500,
  between_2000_10000: 750,
  between_10000_50000: 1100,
  above_50000: 1500,
};

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function topCorridorsNear(lat: number, lon: number, radiusM: number): string[] {
  const scores = new Map<string, number>();
  const all = events as SlimEvent[];
  for (const e of all) {
    if (!e.corridor || e.latitude == null || e.longitude == null) continue;
    const d = metersBetween(lat, lon, e.latitude, e.longitude);
    if (d > radiusM * 1.4) continue;
    scores.set(e.corridor, (scores.get(e.corridor) ?? 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);
}

function topJunctionsNear(lat: number, lon: number, radiusM: number): string[] {
  const bucket = new Map<string, number>();
  const all = events as SlimEvent[];
  for (const e of all) {
    if (!e.junction || e.latitude == null || e.longitude == null) continue;
    const d = metersBetween(lat, lon, e.latitude, e.longitude);
    if (d > radiusM) continue;
    const key = e.junction.trim();
    if (!key) continue;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  return [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
}

function inferPeakConflictWindows(): string[] {
  const a = aggregates as AggregatesData;
  const severeCauses = Object.entries(a.cause_severity ?? {})
    .sort(([, va], [, vb]) => Number(vb) - Number(va))
    .slice(0, 3)
    .map(([cause]) => cause.replace(/_/g, " "));
  return [
    "07:30-10:30 (morning commuter peak)",
    "17:30-21:00 (evening peak + event dispersal)",
    `Cause-sensitive surge: ${severeCauses.join(", ")}`,
  ];
}

function riskHotspotNear(lat: number, lon: number, radiusM: number): Hotspot[] {
  return (hotspots as Hotspot[])
    .filter((h) => metersBetween(lat, lon, h.lat, h.lon) <= radiusM)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

type EventAreaInput = {
  attendance_band?: AttendanceBand;
  lat?: number;
  lon?: number;
};

export function analyzeEventArea(input: EventAreaInput): AreaAnalysis {
  if (input.lat == null || input.lon == null) {
    return {
      estimated_radius_m: ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"],
      nearby_junctions: [],
      nearby_corridors: [],
      peak_conflict_windows: inferPeakConflictWindows(),
    };
  }

  const radius = ATTENDANCE_RADIUS[input.attendance_band ?? "between_500_2000"];
  const nearJunctions = topJunctionsNear(input.lat, input.lon, radius);
  const nearCorridors = topCorridorsNear(input.lat, input.lon, radius);
  const nearHotspots = riskHotspotNear(input.lat, input.lon, radius);
  const hotspotLabels = nearHotspots.map((h, idx) => `Risk cell ${idx + 1} (${h.count} events)`);

  return {
    estimated_radius_m: radius,
    nearby_junctions: [...nearJunctions, ...hotspotLabels].slice(0, 8),
    nearby_corridors: nearCorridors.slice(0, 5),
    peak_conflict_windows: inferPeakConflictWindows(),
  };
}
