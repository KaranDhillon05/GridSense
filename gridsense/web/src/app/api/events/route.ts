import { NextRequest, NextResponse } from "next/server";
import events from "@/data/events_slim.json";

// MOCK ASTraM live feed: returns scored events; ?status=active filters to the
// synthesized live set. In production this proxies the real ASTraM stream.
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 2000);
  let out = events as any[];
  if (status) out = out.filter((e) => e.status === status);
  out = [...out].sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0));
  return NextResponse.json(out.slice(0, limit));
}
