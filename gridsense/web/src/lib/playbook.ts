// GridSense — Operational Playbook generator (pure, rule-based, explainable).
//
// Turns a forecast + the existing resource recommendation into 3–5 candidate
// management strategies, one recommended strategy with a "why", a corridor- and
// junction-aware advisory, a resource plan, and a before/during/after checklist.
//
// This is corridor-aware traffic-operations planning — NOT navigation. The
// ASTraM data gives event-level context, not a road-network graph, so diversion
// output is a *candidate alternate movement corridor*, never a "fastest route".

import {
  type EventInput,
  CAUSE_EQUIPMENT,
  mockDiversionRoute,
  recommend,
} from "@/lib/gridsense";
import { analyzeEventArea } from "@/lib/eventAnalysis";
import type {
  Advisory,
  BarricadePoint,
  Checklist,
  CommNeed,
  DeploymentPost,
  DiversionRouteOption,
  Demand,
  Playbook,
  ResourcePlan,
  Strategy,
  StrategyType,
} from "@/lib/types";

type Forecast = ReturnType<typeof recommend>["forecast"];
type Plan = ReturnType<typeof recommend>["plan"];

// --- Strategy catalog ------------------------------------------------------
// Static templates; the rule engine selects a subset and fills dynamic bits.
type Template = {
  id: string;
  name: string;
  type: StrategyType;
  use_when: string;
  reduction: Demand;
  resource: Demand;
  barricade: Demand;
  comms: CommNeed;
  complexity: Demand;
  baseReasoning: string[];
  baseActions: string[];
};

const CATALOG: Record<string, Template> = {
  full_diversion: {
    id: "full_diversion",
    name: "Full Diversion",
    type: "diversion-heavy",
    use_when: "Unsafe work zone or full closure required",
    reduction: "high",
    resource: "high",
    barricade: "high",
    comms: "urgent",
    complexity: "medium",
    baseReasoning: ["Closure blocks through movement", "Through traffic must be re-routed"],
    baseActions: [
      "Close the affected stretch with hard barricades",
      "Deploy officers at upstream junctions to turn traffic early",
      "Activate the candidate alternate movement corridor",
      "Publish a public diversion advisory",
    ],
  },
  partial_flow: {
    id: "partial_flow",
    name: "Partial Flow Management",
    type: "flow-management",
    use_when: "One side passable; keep limited movement with lane tapers",
    reduction: "medium",
    resource: "medium",
    barricade: "medium",
    comms: "medium",
    complexity: "medium",
    baseReasoning: ["Partial carriageway remains usable", "Avoids a full closure"],
    baseActions: [
      "Taper the affected lane and channel traffic to open lanes",
      "Post officers to meter flow through the pinch point",
      "Pre-position recovery so the lane can reopen fast",
    ],
  },
  peak_hour_restriction: {
    id: "peak_hour_restriction",
    name: "Peak-Hour Restriction",
    type: "time-restriction",
    use_when: "Planned, long-duration work that can avoid peak windows",
    reduction: "medium",
    resource: "low",
    barricade: "low",
    comms: "urgent",
    complexity: "low",
    baseReasoning: [
      "Disruption is planned and long-running",
      "Shifting work out of peak windows cuts congestion impact",
    ],
    baseActions: [
      "Restrict heavy work to off-peak hours",
      "Publish the work-window schedule in advance",
      "Stage barricades for rapid peak-hour removal",
    ],
  },
  rapid_clearance: {
    id: "rapid_clearance",
    name: "Rapid Clearance",
    type: "clearance",
    use_when: "Breakdown/obstruction — fastest path is to clear it",
    reduction: "high",
    resource: "medium",
    barricade: "low",
    comms: "low",
    complexity: "low",
    baseReasoning: [
      "Obstruction is the root cause of the slowdown",
      "Clearing it restores normal flow fastest",
    ],
    baseActions: [
      "Dispatch the field clearance / recovery team immediately",
      "Hold one officer to manage flow around the obstruction",
      "Reopen and stand down once cleared",
    ],
  },
  heavy_vehicle_diversion: {
    id: "heavy_vehicle_diversion",
    name: "Heavy-Vehicle Diversion",
    type: "vehicle-restriction",
    use_when: "Heavy vehicle involved or blocking; cars can still pass",
    reduction: "medium",
    resource: "medium",
    barricade: "medium",
    comms: "medium",
    complexity: "medium",
    baseReasoning: [
      "Heavy vehicle is the main constraint",
      "Restricting heavy traffic keeps lighter flow moving",
    ],
    baseActions: [
      "Divert heavy vehicles to the alternate corridor upstream",
      "Allow light vehicles through under officer control",
      "Coordinate recovery for the blocking vehicle",
    ],
  },
  public_advisory_first: {
    id: "public_advisory_first",
    name: "Public Advisory First",
    type: "communication",
    use_when: "Planned/known event — demand can be reduced before it builds",
    reduction: "medium",
    resource: "low",
    barricade: "low",
    comms: "urgent",
    complexity: "low",
    baseReasoning: [
      "Event is known ahead of time",
      "Early advisory shifts demand away from the corridor",
    ],
    baseActions: [
      "Issue an advance public advisory across channels",
      "Suggest the candidate alternate movement corridor",
      "Coordinate with event organisers on timing",
    ],
  },
  junction_protection: {
    id: "junction_protection",
    name: "Junction Protection",
    type: "junction-control",
    use_when: "Risk of upstream junctions locking up / spillback",
    reduction: "medium",
    resource: "medium",
    barricade: "low",
    comms: "low",
    complexity: "medium",
    baseReasoning: [
      "Spillback can gridlock upstream junctions",
      "Protecting key junctions preserves network flow",
    ],
    baseActions: [
      "Man the upstream control junctions",
      "Hold/adjust signal timing to prevent box-blocking",
      "Keep feeder junctions clear for the alternate corridor",
    ],
  },
};

const HEAVY = new Set(["heavy_vehicle", "truck", "lcv", "bmtc_bus", "ksrtc_bus", "private_bus"]);

// --- Rule engine -----------------------------------------------------------
function selectStrategies(
  inp: EventInput,
  fc: Forecast
): { ids: string[]; recommended: string; why: string[] } {
  const closure = !!inp.requires_road_closure;
  const tier = fc.tier;
  const sensitive = inp.corridor !== "Non-corridor";
  const long = fc.expected_duration_min > 240;
  const cause = inp.cause;
  const heavy = HEAVY.has(inp.veh_type ?? "");
  const planned = !!inp.is_planned;

  const ids: string[] = [];
  const why: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };

  let recommended: string;

  if (closure) {
    // Any road closure blocks through-movement → diversion is the primary lever,
    // regardless of tier. Tier/sensitivity raise the comms + junction emphasis.
    recommended = "full_diversion";
    add("full_diversion");
    add("junction_protection");
    add("public_advisory_first");
    if (planned) add("peak_hour_restriction");
    why.push("Road closure required");
    if (tier === "Severe" || tier === "High") why.push(`${tier} forecast impact`);
    if (sensitive) why.push("High corridor sensitivity");
    if (long) why.push("Long-duration disruption during operating hours");
  } else if ((cause === "vehicle_breakdown" || cause === "accident") && !closure) {
    recommended = "rapid_clearance";
    add("rapid_clearance");
    add("partial_flow");
    add("junction_protection");
    why.push("Obstruction with carriageway still partly usable");
    if (heavy) {
      add("heavy_vehicle_diversion");
      why.push("Heavy vehicle involved");
    }
  } else if (planned && (cause === "public_event" || cause === "construction") && long) {
    // closure is handled by the first branch, so it cannot be true here.
    recommended = cause === "construction" ? "peak_hour_restriction" : "public_advisory_first";
    add("public_advisory_first");
    add("peak_hour_restriction");
    add("partial_flow");
    add("junction_protection");
    why.push("Planned, long-duration disruption during operating hours");
    if (sensitive) why.push("High corridor sensitivity");
  } else if (["water_logging", "tree_fall", "pot_holes", "road_conditions"].includes(cause)) {
    // closure is handled by the first branch, so it cannot be true here.
    recommended = "rapid_clearance";
    add("rapid_clearance");
    add("partial_flow");
    add("public_advisory_first");
    why.push(`Road-condition hazard (${cause.replace(/_/g, " ")})`);
  } else {
    // congestion / others / fallback
    recommended = sensitive ? "junction_protection" : "partial_flow";
    add("partial_flow");
    add("junction_protection");
    add("public_advisory_first");
    why.push("Localised congestion / general slowdown");
  }

  // Ensure heavy-vehicle candidate surfaces whenever relevant.
  if (heavy && !ids.includes("heavy_vehicle_diversion")) add("heavy_vehicle_diversion");

  // Guarantee 3–5 strategies.
  for (const filler of ["public_advisory_first", "junction_protection", "partial_flow"]) {
    if (ids.length >= 3) break;
    add(filler);
  }
  const trimmed = ids.slice(0, 5);
  if (!trimmed.includes(recommended)) trimmed[0] = recommended;

  if (inp.is_peak) why.push("Peak-hour timing amplifies impact");
  return { ids: trimmed, recommended, why: dedupe(why).slice(0, 5) };
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function materialize(
  id: string,
  recommended: string,
  inp: EventInput,
  fc: Forecast
): Strategy {
  const t = CATALOG[id];
  const analysis = analyzeEventArea(inp);
  const mainCorridor = analysis.nearby_corridors[0] ?? inp.corridor;
  const mainJunction = analysis.nearby_junctions[0] ?? inp.junction ?? "primary event junction";
  const reasoning = [...t.baseReasoning];
  if (fc.expected_duration_min > 240) reasoning.push("Long expected duration");
  if (inp.corridor !== "Non-corridor") reasoning.push(`Sensitive corridor (${mainCorridor})`);

  const actions = [...t.baseActions];
  const junctions = inp.affected_junctions ?? 1;
  if (junctions > 1) actions.push(`Cover all ${junctions} affected junctions`);
  actions.push(`Prioritize control around ${mainJunction}`);

  // Confidence: higher when we have duration + a known corridor.
  const confidence: Strategy["confidence"] =
    fc.expected_duration_min && inp.corridor !== "Non-corridor" ? "high" : "medium";

  return {
    id: t.id,
    name: t.name,
    type: t.type,
    recommended: id === recommended,
    use_when: t.use_when,
    expected_congestion_reduction: t.reduction,
    resource_demand: t.resource,
    barricade_demand: t.barricade,
    public_communication_need: t.comms,
    operational_complexity: t.complexity,
    confidence,
    reasoning: dedupe(reasoning).slice(0, 4),
    actions: actions.slice(0, 5),
  };
}

const DIVERSION_TYPES = new Set<StrategyType>(["diversion-heavy", "vehicle-restriction"]);

function buildResourcePlan(plan: Plan, inp: EventInput): ResourcePlan {
  const total = plan.manpower.total_deployment;
  const bars = plan.barricading.barricade_units;
  const lo = (n: number, d: number) => Math.max(0, n - d);
  return {
    officers_range: `${lo(total, 2)}-${total + 4}`,
    barricades_range: bars > 0 ? `${lo(bars, 1)}-${bars + 2}` : "0-2",
    shifts: plan.manpower.shifts,
    wardens: plan.manpower.wardens,
    head_constables: plan.manpower.head_constables,
    constables: plan.manpower.constables,
    special_units: CAUSE_EQUIPMENT[inp.cause] ?? ["Cones", "Caution boards"],
    confidence: plan.confidence,
    narrative: plan.narrative,
  };
}

function buildAdvisory(
  inp: EventInput,
  fc: Forecast,
  recommendedStrategy: Strategy
): Advisory {
  const analysis = analyzeEventArea(inp);
  const diversion = DIVERSION_TYPES.has(recommendedStrategy.type);
  const controlPoints: string[] = [];
  const n = Math.max(1, inp.affected_junctions ?? 1);
  const labels = [
    ...analysis.nearby_junctions,
    "upstream feeder junction",
    "downstream feeder junction",
    "parallel-corridor entry",
    "event-side junction",
  ];
  for (let i = 0; i < Math.min(n, labels.length); i++) controlPoints.push(labels[i]);
  if (inp.junction) controlPoints.unshift(`${inp.junction} (event junction)`);

  const advisory: Advisory = {
    control_style: inp.requires_road_closure
      ? "Full closure"
      : recommendedStrategy.type === "flow-management"
      ? "Partial flow management"
      : recommendedStrategy.type === "clearance"
      ? "Clearance + flow control"
      : "Managed flow",
    impacted_corridor: analysis.nearby_corridors[0] ?? inp.corridor,
    candidate_alternates: diversion
      ? [
          analysis.nearby_corridors[1] ?? "parallel arterial corridor",
          analysis.nearby_corridors[2] ?? "upstream feeder route",
        ]
      : ["lane-level management on-corridor"],
    control_points: controlPoints,
    public_note: diversion
      ? "Avoid the affected stretch and use the suggested alternate movement corridor."
      : "Expect slow movement on the affected stretch; follow officer direction.",
  };

  if (diversion && inp.lat != null && inp.lon != null) {
    const route_options = buildRouteOptions(inp, fc, recommendedStrategy);
    advisory.route_options = route_options;
    advisory.selected_route_id = route_options[0].id;
    advisory.routing_source = "mock";
    advisory.route = route_options[0];
  }
  return advisory;
}

function buildBarricadePoints(inp: EventInput, plan: Plan): BarricadePoint[] {
  if (inp.lat == null || inp.lon == null) return [];
  const total = Math.max(2, Math.min(8, plan.barricading.barricade_units || 2));
  const points: BarricadePoint[] = [];
  for (let i = 0; i < total; i++) {
    const angle = (i / total) * Math.PI * 2;
    const offsetLat = (Math.sin(angle) * 240) / 111320;
    const offsetLon = (Math.cos(angle) * 240) / (111320 * Math.cos((inp.lat * Math.PI) / 180));
    points.push({
      id: `barricade_${i + 1}`,
      lat: inp.lat + offsetLat,
      lon: inp.lon + offsetLon,
      label: `Barricade B${i + 1} - ${i % 2 === 0 ? "Entry Gate" : "Diversion Turn"}`,
      type: i % 3 === 0 ? "hard" : i % 3 === 1 ? "soft" : "coning",
      officers_required: i % 2 === 0 ? 2 : 1,
    });
  }
  return points;
}

function buildDeploymentPosts(inp: EventInput, plan: Plan): DeploymentPost[] {
  if (plan.deployment_posts?.length) return plan.deployment_posts;
  if (inp.lat == null || inp.lon == null) return [];
  const templates: Array<Pick<DeploymentPost, "role" | "shift" | "label">> = [
    { role: "traffic_point", shift: "pre_event", label: "Approach control post" },
    { role: "crowd_control", shift: "during", label: "Venue gate crowd post" },
    { role: "diversion_guide", shift: "during", label: "Diversion guidance post" },
    { role: "quick_response", shift: "all", label: "Quick response standby" },
  ];
  return templates.map((t, i) => ({
    id: `post_${i + 1}`,
    lat: inp.lat! + ((i - 1.5) * 180) / 111320,
    lon: inp.lon! + ((1.5 - i) * 160) / (111320 * Math.cos((inp.lat! * Math.PI) / 180)),
    role: t.role,
    shift: t.shift,
    officers: Math.max(1, Math.round(plan.manpower.total_deployment / (6 + i))),
    label: t.label,
  }));
}

function buildRouteOptions(
  inp: EventInput,
  fc: Forecast,
  recommendedStrategy: Strategy
): DiversionRouteOption[] {
  const primary = mockDiversionRoute(inp.lat!, inp.lon!);
  const arterial = mockDiversionRoute(inp.lat! + 0.0018, inp.lon! - 0.0015);
  const heavy = mockDiversionRoute(inp.lat! - 0.0016, inp.lon! + 0.0014);

  const candidates: Omit<DiversionRouteOption, "rank">[] = [
    {
      id: "primary_diversion",
      ...primary,
      estimated_clearance_relief: "high",
      advisory_note: "Balanced alternate corridor for most through-traffic.",
    },
    {
      id: "arterial_preferred",
      ...{ ...arterial, extra_travel_min: Math.max(1, arterial.extra_travel_min - 2) },
      estimated_clearance_relief: "medium",
      advisory_note: "Faster arterial-oriented alternate; monitor feeder spillback.",
    },
    {
      id: "heavy_vehicle_safe",
      ...{ ...heavy, extra_travel_min: heavy.extra_travel_min + 3 },
      estimated_clearance_relief: "medium",
      advisory_note: "Wider movement envelope for heavy vehicles and recovery access.",
    },
  ];

  const scored = candidates.map((r) => {
    const timePenalty = r.extra_travel_min;
    const closureBoost = inp.requires_road_closure ? 2 : 0;
    const severeBoost = fc.tier === "Severe" ? 2 : 0;
    const strategyBoost =
      recommendedStrategy.type === "diversion-heavy" && r.id === "primary_diversion" ? 2 : 0;
    const heavyBoost = inp.veh_type?.includes("heavy") && r.id === "heavy_vehicle_safe" ? 2 : 0;
    const score = closureBoost + severeBoost + strategyBoost + heavyBoost - timePenalty / 5;
    return { ...r, _score: score };
  });

  return scored
    .sort((a, b) => b._score - a._score)
    .slice(0, 3)
    .map((r, idx) => {
      const { _score, ...rest } = r;
      void _score;
      return { ...rest, rank: idx + 1 };
    });
}

function buildChecklist(inp: EventInput, recommendedStrategy: Strategy): Checklist {
  const closure = !!inp.requires_road_closure;
  const planned = !!inp.is_planned;
  const diversion = DIVERSION_TYPES.has(recommendedStrategy.type);

  const before = [
    "Confirm event location, extent and expected window",
    "Brief field officers on the recommended strategy",
    planned ? "Publish public advisory ahead of the event" : "Alert nearest patrol to the live event",
    "Stage barricades and equipment at control points",
  ];
  if (diversion) before.push("Pre-survey the candidate alternate movement corridor");
  if (closure) before.push("Position recovery/clearance units before closing");

  const during = [
    "Deploy officers to all control points",
    "Monitor upstream junctions for spillback",
    diversion ? "Direct through-traffic onto the alternate corridor" : "Meter flow through the affected stretch",
    "Update public advisory if the situation changes",
  ];

  const after = [
    "Reopen lanes and remove barricades",
    "Stand down field units in stages",
    "Log actual clearance time and resources used",
    "Feed the outcome into post-event learning for calibration",
  ];

  return { before, during, after };
}

export function buildPlaybook(inp: EventInput, fc: Forecast, plan: Plan): Playbook {
  const { ids, recommended, why } = selectStrategies(inp, fc);
  const strategies = ids.map((id) => materialize(id, recommended, inp, fc));
  const rec = strategies.find((s) => s.recommended) ?? strategies[0];

  return {
    recommended_strategy_id: rec.id,
    why,
    strategies,
    resource_plan: buildResourcePlan(plan, inp),
    advisory: buildAdvisory(inp, fc, rec),
    barricade_points: buildBarricadePoints(inp, plan),
    deployment_posts: buildDeploymentPosts(inp, plan),
    checklist: buildChecklist(inp, rec),
  };
}
