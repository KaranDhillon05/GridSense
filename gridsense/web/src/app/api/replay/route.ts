import { NextRequest, NextResponse } from "next/server";
import events from "@/data/events_slim.json";
import learning from "@/data/learning.json";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date"); // YYYY-MM-DD
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const month = date.slice(0, 7); // YYYY-MM

  // Events whose start_datetime falls on this date
  const dayEvents = (events as any[]).filter(
    (e) => e.start_datetime && e.start_datetime.startsWith(date)
  );

  // Samples from this exact date
  const l = learning as any;
  const daySamples = (l.samples as any[]).filter((s: any) => s.date === date);

  // Drift row for this month
  const monthDrift = (l.drift as any[]).find((d: any) => d.month === month) ?? null;

  // By-cause breakdown filtered to causes present in dayEvents
  const causesPresent = new Set(dayEvents.map((e: any) => e.event_cause));
  const byCause = (l.by_cause as any[]).filter((c: any) =>
    causesPresent.has(c.event_cause)
  );

  return NextResponse.json({
    date,
    events: dayEvents,
    samples: daySamples,
    monthDrift,
    byCause,
  });
}
