import { NextRequest, NextResponse } from "next/server";
import { forecast, type EventInput } from "@/lib/gridsense";
import { findSimilarEvents } from "@/lib/precedent";

// Given an event, return historically similar past events and their real outcomes.
// Same input shape as /api/forecast.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as EventInput;
  const fc = forecast(body);
  const summary = findSimilarEvents(body, 15, fc.expected_duration_min);
  return NextResponse.json(summary);
}
