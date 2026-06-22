import { NextRequest, NextResponse } from "next/server";
import hotspots from "@/data/hotspots.json";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 400);
  return NextResponse.json((hotspots as any[]).slice(0, limit));
}
