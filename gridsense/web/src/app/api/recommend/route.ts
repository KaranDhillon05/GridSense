import { NextRequest, NextResponse } from "next/server";
import {
  getDiversionAlternatives,
  recommend,
  type EventInput,
} from "@/lib/gridsense";
import { buildPlaybook } from "@/lib/playbook";
import { generateAiPlaybook } from "@/lib/ai";
import type { Playbook } from "@/lib/types";
import { analyzeEventArea } from "@/lib/eventAnalysis";
import { buildTrafficPlan, applyRealTravelTimes } from "@/lib/trafficPlanner";
import { enrichWithMappls } from "@/lib/mapplsContext";

// The plan makes several parallel OSRM road-snapping + Mappls/LLM calls; give the
// serverless function headroom beyond the default 10s so they complete reliably.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as EventInput;
  const { forecast, plan } = recommend(body);
  const area = analyzeEventArea(body);
  let traffic_plan = await buildTrafficPlan(body);

  // Rule-engine playbook is always computed — it's our deterministic fallback
  // and the source of the data-grounded resource_plan numbers.
  const rulePlaybook = buildPlaybook(body, forecast, plan);

  // Run Mappls enrichment and LLM generation in parallel (both are async I/O).
  const [ai, routing, mappls_context] = await Promise.all([
    generateAiPlaybook(body, forecast),
    body.lat != null && body.lon != null
      ? getDiversionAlternatives({
          lat: body.lat,
          lon: body.lon,
          requires_road_closure: body.requires_road_closure,
          is_peak: body.is_peak,
          veh_type: body.veh_type,
        })
      : Promise.resolve(null),
    enrichWithMappls(body, traffic_plan),
  ]);

  // Apply real Mappls travel times to route ETAs when available.
  if (traffic_plan && mappls_context.gateway_matrix_source === "mappls") {
    const realTimes = new Map(
      mappls_context.gateway_matrix.map((g) => [g.corridor_id, g.duration_min])
    );
    traffic_plan = applyRealTravelTimes(traffic_plan, realTimes);
  }

  // When Mappls predictive routing succeeded, prepend the road-snapped route to
  // the advisory options so it becomes the default selected route on the map.
  const enrichedRouting = (() => {
    if (!routing) return null;
    if (!mappls_context.predictive_diversion || mappls_context.predictive_diversion_source !== "mappls") return routing;
    const pred = mappls_context.predictive_diversion;
    // Prepend predictive route (it replaces the primary mock arc).
    const existingWithoutPrimary = routing.route_options.filter((r) => r.id !== "primary_diversion");
    return {
      ...routing,
      route_options: [pred, ...existingWithoutPrimary],
      selected_route_id: pred.id,
      routing_source: "mapmyindia" as const,
    };
  })();

  // Merge routing result into advisory (applies to both AI and rule playbooks).
  function applyRouting(advisory: typeof rulePlaybook.advisory) {
    if (!enrichedRouting) return advisory;
    const selectedRoute =
      enrichedRouting.route_options.find((r) => r.id === enrichedRouting.selected_route_id) ??
      enrichedRouting.route_options[0];
    return {
      ...advisory,
      route_options: enrichedRouting.route_options,
      selected_route_id: enrichedRouting.selected_route_id,
      routing_source: enrichedRouting.routing_source,
      fallback_reason: enrichedRouting.fallback_reason,
      route: selectedRoute,
    };
  }

  let playbook: Playbook;
  let source: "ai" | "rules";
  if (ai) {
    // Keep our reproducible, data-grounded resource_plan; take strategy
    // reasoning + advisory + checklist from the AI. Re-attach routing (real
    // Mappls or mock) from the rule playbook if the AI didn't include geometry.
    const baseAdvisory = routing
      ? ai.advisory
      : { ...ai.advisory, ...(!ai.advisory.route && rulePlaybook.advisory.route ? {
          route: rulePlaybook.advisory.route,
          route_options: rulePlaybook.advisory.route_options,
          selected_route_id: rulePlaybook.advisory.selected_route_id,
          routing_source: rulePlaybook.advisory.routing_source,
          fallback_reason: rulePlaybook.advisory.fallback_reason,
        } : {}) };
    playbook = {
      ...ai,
      advisory: applyRouting(baseAdvisory),
      resource_plan: rulePlaybook.resource_plan,
      barricade_points: rulePlaybook.barricade_points,
      deployment_posts: rulePlaybook.deployment_posts,
    };
    source = "ai";
  } else {
    playbook = { ...rulePlaybook, advisory: applyRouting(rulePlaybook.advisory) };
    source = "rules";
  }

  if (traffic_plan) {
    playbook = {
      ...playbook,
      barricade_points: traffic_plan.barricade_points,
      deployment_posts: traffic_plan.deployment_posts,
      advisory: {
        ...playbook.advisory,
        impacted_corridor:
          traffic_plan.access_corridors.find((c) => c.direction === "inbound")?.name ??
          playbook.advisory.impacted_corridor,
        candidate_alternates: [
          ...traffic_plan.routes.secondary_inbound.map((r) => `Inbound: ${r.id}`),
          ...traffic_plan.routes.through_diversion.map((r) => `Diversion: ${r.id}`),
        ],
        control_points: traffic_plan.access_corridors
          .slice(0, 5)
          .map((c) => `${c.name} (${c.direction})`),
      },
    };
    plan.deployment_posts = traffic_plan.deployment_posts as typeof plan.deployment_posts;
  }

  return NextResponse.json({ forecast, plan, playbook, source, area, traffic_plan, mappls_context });
}
