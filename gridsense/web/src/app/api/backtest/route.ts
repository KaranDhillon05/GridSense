import { NextRequest, NextResponse } from "next/server";
import events from "@/data/events_slim.json";
import simNetwork from "@/data/sim_network.json";

// Replay-and-Prove candidate feed: historical ASTraM events that fall inside the
// simulated CBD twin (so they can actually be replayed in the microsim). The
// client simulates each one (do-nothing vs GridSense's recommended response) and
// tallies the vehicle-hours that would have been saved. Filtering lives here so
// the heavy events_slim.json never ships to the browser.

const RAW_CENTER = (simNetwork as { meta: { center: number[] } }).meta.center;
const CENTER: [number, number] = [RAW_CENTER[0], RAW_CENTER[1]];
// CBD twin footprint is ~2.2 km across; keep candidates near the dense core so
// they reliably snap to a simulated edge.
const CBD_RADIUS_KM = 1.8;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type RawEvent = {
  id: string;
  event_cause: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  corridor?: string;
  priority?: string;
  requires_road_closure?: number | boolean;
  status?: string;
  impact_score?: number;
  tier?: string;
  predicted_duration_min?: number;
  is_planned?: number | boolean;
  start_datetime?: string;
};

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date"); // optional YYYY-MM-DD
  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 12)));

  // 1) Restrict to the CBD twin footprint (cheap radius filter) AND to acute,
  // response-relevant incidents. Chronic infrastructure defects (e.g. pot-holes
  // logged as open for days) are a maintenance problem, not a traffic-response
  // one, and never clear within any operational window — so we replay incidents
  // a same-shift coordinated response can actually act on (~20 min to ~3 h).
  const cbd = (events as RawEvent[]).filter((e) => {
    if (typeof e.latitude !== "number" || typeof e.longitude !== "number") return false;
    if (haversineKm(CENTER[0], CENTER[1], e.latitude, e.longitude) > CBD_RADIUS_KM) return false;
    const dur = e.predicted_duration_min ?? 0;
    return dur >= 20 && dur <= 180;
  });

  // 2) Suggest the days with the most CBD incidents (quick-pick chips).
  const dayCounts = new Map<string, number>();
  for (const e of cbd) {
    const d = e.start_datetime?.slice(0, 10);
    if (d) dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const suggestedDates = [...dayCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([d, count]) => ({ date: d, count }));

  // 3) Apply the optional date filter, then rank for traffic relevance: named
  // corridors first (busier roads the twin actually loads), then road closures
  // (where a coordinated diversion matters), then forecast impact.
  let rows = cbd;
  if (date) rows = rows.filter((e) => e.start_datetime?.startsWith(date));
  const onCorridor = (e: RawEvent) => (e.corridor && e.corridor !== "Non-corridor" ? 1 : 0);
  rows = rows
    .sort((a, b) => {
      if (onCorridor(a) !== onCorridor(b)) return onCorridor(b) - onCorridor(a);
      const ca = a.requires_road_closure ? 1 : 0;
      const cb = b.requires_road_closure ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (b.impact_score ?? 0) - (a.impact_score ?? 0);
    })
    .slice(0, limit);

  const out = rows.map((e) => ({
    id: e.id,
    cause: e.event_cause,
    corridor: e.corridor ?? "Non-corridor",
    tier: e.tier ?? "Moderate",
    impact_score: e.impact_score ?? 0,
    predicted_duration_min: e.predicted_duration_min ?? 60,
    requires_road_closure: !!e.requires_road_closure,
    is_planned: !!e.is_planned,
    priority: e.priority ?? "High",
    lat: e.latitude as number,
    lon: e.longitude as number,
    address: e.address ?? "",
    start_datetime: e.start_datetime ?? "",
  }));

  return NextResponse.json({
    date: date ?? null,
    center: CENTER,
    cbd_total: cbd.length,
    suggested_dates: suggestedDates,
    events: out,
  });
}
