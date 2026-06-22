import { NextResponse } from "next/server";
import aggregates from "@/data/aggregates.json";
import model from "@/data/model_meta.json";

export async function GET() {
  const a = aggregates as any;
  return NextResponse.json({
    causes: a.causes,
    corridors: a.corridors,
    zones: a.zones,
    veh_types: a.veh_types,
    n_events: a.n_events,
    date_min: a.date_min,
    date_max: a.date_max,
    model,
  });
}
