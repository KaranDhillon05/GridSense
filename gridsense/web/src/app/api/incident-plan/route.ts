import { NextRequest, NextResponse } from "next/server";
import { buildTrafficPlan, applyRealTravelTimes } from "@/lib/trafficPlanner";
import { enrichWithMappls } from "@/lib/mapplsContext";
import type { EventInput } from "@/lib/gridsense";

// Full-Bangalore traffic plan for an ops incident. Same OSM-graph network engine
// the /plan page uses (buildTrafficPlan → buildNetworkPlan), exposed as a
// server route because that engine loads a multi-MB graph and must not run in
// the browser. The Wind Tunnel client posts an incident-derived EventInput and
// renders the returned plan + isochrones with the existing map layers.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as EventInput;

  let traffic_plan = await buildTrafficPlan(body);
  const mappls_context = await enrichWithMappls(body, traffic_plan);

  if (traffic_plan && mappls_context.gateway_matrix_source === "mappls") {
    const realTimes = new Map(
      mappls_context.gateway_matrix.map((g) => [g.corridor_id, g.duration_min])
    );
    traffic_plan = applyRealTravelTimes(traffic_plan, realTimes);
  }

  return NextResponse.json({ traffic_plan, mappls_context });
}
