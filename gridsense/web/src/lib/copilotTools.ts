// GridSense Copilot — tool definitions + implementations.
//
// The Copilot is grounded: it cannot answer from imagination. Every factual claim
// must come from one of these tools, which read the SAME artifacts and engine the
// rest of the app uses (aggregates, the scored-event corpus, the forecast +
// playbook engine, the precedent engine). This keeps the chat answers consistent
// with the /plan console and the dashboards.

import aggregates from "@/data/aggregates.json";
import events from "@/data/events_slim.json";
import { forecast, recommend, type EventInput } from "@/lib/gridsense";
import { buildPlaybook } from "@/lib/playbook";
import { findSimilarEvents } from "@/lib/precedent";

const agg = aggregates as any;
const EVENTS = events as any[];

export const CAUSES: string[] = agg.causes ?? [];
export const CORRIDORS: string[] = agg.corridors ?? [];

// --- A small gazetteer so the model can resolve well-known venues to real
// coordinates + the corridor they sit on. Keeps "plan a protest at Town Hall"
// map-able and precedent-aware without a geocoding dependency.
export const VENUES: Record<string, { lat: number; lon: number; corridor: string }> = {
  "chinnaswamy stadium": { lat: 12.9789, lon: 77.5996, corridor: "CBD 1" },
  "freedom park": { lat: 12.9764, lon: 77.5806, corridor: "CBD 2" },
  "town hall": { lat: 12.9635, lon: 77.5806, corridor: "CBD 2" },
  "majestic": { lat: 12.9774, lon: 77.5713, corridor: "CBD 1" },
  "ksr railway station": { lat: 12.9783, lon: 77.5687, corridor: "CBD 1" },
  "palace grounds": { lat: 13.0007, lon: 77.5905, corridor: "Bellary Road 1" },
  "vidhana soudha": { lat: 12.9794, lon: 77.5907, corridor: "CBD 1" },
  "mg road": { lat: 12.9756, lon: 77.6068, corridor: "CBD 2" },
  "silk board": { lat: 12.9176, lon: 77.6233, corridor: "ORR East 1" },
  "electronic city": { lat: 12.8452, lon: 77.6602, corridor: "Hosur Road" },
  "hebbal": { lat: 13.0358, lon: 77.5970, corridor: "Bellary Road 2" },
  "whitefield": { lat: 12.9698, lon: 77.7500, corridor: "Varthur Road" },
};

function resolveLocation(args: any): { lat?: number; lon?: number; corridor: string } {
  if (typeof args.location_name === "string") {
    const key = args.location_name.trim().toLowerCase();
    const v = VENUES[key];
    if (v) return v;
  }
  return {
    lat: typeof args.lat === "number" ? args.lat : undefined,
    lon: typeof args.lon === "number" ? args.lon : undefined,
    corridor: CORRIDORS.includes(args.corridor) ? args.corridor : "Non-corridor",
  };
}

function buildEventInput(args: any): EventInput {
  const loc = resolveLocation(args);
  const cause = CAUSES.includes(args.cause) ? args.cause : args.is_planned ? "public_event" : "others";
  return {
    event_name: args.event_name,
    cause,
    corridor: loc.corridor,
    lat: loc.lat,
    lon: loc.lon,
    requires_road_closure: !!args.requires_road_closure,
    is_peak: !!args.is_peak,
    is_planned: !!args.is_planned,
    priority: args.priority ?? "High",
    affected_junctions: typeof args.affected_junctions === "number" ? args.affected_junctions : 1,
    expected_attendance: typeof args.expected_attendance === "number" ? args.expected_attendance : undefined,
    start_hour: typeof args.start_hour === "number" ? args.start_hour : undefined,
    veh_type: args.veh_type,
  };
}

// --- Tool schemas (OpenAI / Groq tool-calling format) -----------------------
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_stats",
      description:
        "Look up real aggregate statistics from the ASTraM dataset: median clearance time by cause or corridor, cause severity, corridor sensitivity, event counts, and the dataset window. Use this for any 'how long / how many / which is worst' question.",
      parameters: {
        type: "object",
        properties: {
          cause: { type: "string", description: "Optional cause filter (see known causes)." },
          corridor: { type: "string", description: "Optional corridor filter (see known corridors)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_events",
      description:
        "Search the historical scored-event corpus. Filter by cause, corridor, tier, status, or closure, and get a count, summary stats (avg impact, closure rate), and a few example events. Use for 'where do X cluster / show me Y events' questions.",
      parameters: {
        type: "object",
        properties: {
          cause: { type: "string" },
          corridor: { type: "string" },
          tier: { type: "string", enum: ["Severe", "High", "Moderate", "Low"] },
          status: { type: "string", enum: ["active", "closed", "resolved"] },
          requires_road_closure: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_similar_events",
      description:
        "Given an event description, retrieve genuinely similar PAST events and their real outcomes (median/P90 actual clearance, closure rate, severity mix). Use to ground any forecast in precedent.",
      parameters: {
        type: "object",
        properties: {
          cause: { type: "string", description: "Event cause (see known causes)." },
          corridor: { type: "string" },
          location_name: { type: "string", description: "Optional well-known venue name (e.g. 'Town Hall')." },
          lat: { type: "number" },
          lon: { type: "number" },
          requires_road_closure: { type: "boolean" },
          is_peak: { type: "boolean" },
        },
        required: ["cause"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_event",
      description:
        "Generate a full operational plan for an event described in natural language: impact forecast, recommended strategy with reasons, manpower/barricade resource plan, and historical precedent. Use when the user asks to plan/prepare for an event (rally, protest, match, procession, VIP movement, breakdown, etc.).",
      parameters: {
        type: "object",
        properties: {
          event_name: { type: "string" },
          cause: { type: "string", description: "Event cause (see known causes). Rallies/processions → 'procession' or 'protest'; matches/concerts → 'public_event'." },
          corridor: { type: "string", description: "Corridor (see known corridors)." },
          location_name: { type: "string", description: "Well-known venue name if given (e.g. 'Freedom Park')." },
          lat: { type: "number" },
          lon: { type: "number" },
          expected_attendance: { type: "number" },
          start_hour: { type: "number", description: "0-23 local hour the event starts." },
          is_peak: { type: "boolean", description: "True if the event overlaps the 8-10am or 5-8pm peak." },
          requires_road_closure: { type: "boolean" },
          is_planned: { type: "boolean", description: "True for scheduled events (rallies, matches); false for incidents." },
          affected_junctions: { type: "number" },
          priority: { type: "string", enum: ["High", "Low"] },
        },
        required: ["cause"],
      },
    },
  },
] as const;

// --- Implementations --------------------------------------------------------
function toolQueryStats(args: any) {
  const out: any = {
    dataset_window: `${agg.date_min} to ${agg.date_max}`,
    total_events: agg.n_events,
    resolvable_events: agg.n_resolvable,
    city_median_clearance_min: agg.overall_median_duration_min,
  };
  if (args.cause) {
    out.cause = args.cause;
    out.cause_median_clearance_min = agg.cause_median_duration_min?.[args.cause] ?? null;
    out.cause_severity_0_1 = agg.cause_severity?.[args.cause] ?? null;
  }
  if (args.corridor) {
    out.corridor = args.corridor;
    out.corridor_median_clearance_min = agg.corridor_median_duration_min?.[args.corridor] ?? null;
    out.corridor_sensitivity_0_1 = agg.corridor_sensitivity?.[args.corridor] ?? null;
    out.corridor_event_count = agg.corridor_event_counts?.[args.corridor] ?? null;
  }
  if (!args.cause && !args.corridor) {
    // Overview: the headline rankings.
    out.causes_by_median_clearance_min = Object.entries(agg.cause_median_duration_min ?? {})
      .sort((a: any, b: any) => b[1] - a[1]);
    out.corridors_by_median_clearance_min = Object.entries(agg.corridor_median_duration_min ?? {})
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 8);
  }
  return out;
}

function toolFindEvents(args: any) {
  let rows = EVENTS;
  if (args.cause) rows = rows.filter((e) => e.event_cause === args.cause);
  if (args.corridor) rows = rows.filter((e) => e.corridor === args.corridor);
  if (args.tier) rows = rows.filter((e) => e.tier === args.tier);
  if (args.status) rows = rows.filter((e) => e.status === args.status);
  if (typeof args.requires_road_closure === "boolean")
    rows = rows.filter((e) => !!e.requires_road_closure === args.requires_road_closure);

  const n = rows.length;
  const avgImpact = n ? rows.reduce((s, e) => s + (e.impact_score ?? 0), 0) / n : 0;
  const closureRate = n ? rows.filter((e) => e.requires_road_closure).length / n : 0;

  // Corridor breakdown (top 6) so "where do they cluster" is answerable.
  const byCorridor: Record<string, number> = {};
  for (const e of rows) byCorridor[e.corridor ?? "Unknown"] = (byCorridor[e.corridor ?? "Unknown"] ?? 0) + 1;
  const topCorridors = Object.entries(byCorridor).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const examples = [...rows]
    .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
    .slice(0, 5)
    .map((e) => ({
      id: e.id,
      cause: e.event_cause,
      corridor: e.corridor,
      tier: e.tier,
      impact_score: e.impact_score,
      predicted_duration_min: e.predicted_duration_min,
      address: e.address,
    }));

  return {
    count: n,
    avg_impact_score: Math.round(avgImpact * 10) / 10,
    closure_rate: Math.round(closureRate * 100) / 100,
    top_corridors: topCorridors,
    examples,
  };
}

function toolFindSimilar(args: any) {
  const inp = buildEventInput(args);
  const fc = forecast(inp);
  const summary = findSimilarEvents(inp, 15, fc.expected_duration_min);
  // Trim heavy fields for the LLM context.
  return {
    n: summary.n,
    same_cause_n: summary.same_cause_n,
    median_clearance_min: summary.median_clearance_min,
    p90_clearance_min: summary.p90_clearance_min,
    closure_rate: summary.closure_rate,
    tier_mix: summary.tier_mix,
    model_forecast_min: fc.expected_duration_min,
    forecast_within_historical_band: summary.forecast_within_band,
  };
}

// plan_event returns BOTH a compact text-friendly summary for the LLM and a
// structured `card` the UI can render. The route surfaces `card` to the client.
export function toolPlanEvent(args: any) {
  const inp = buildEventInput(args);
  const { forecast: fc, plan } = recommend(inp);
  const playbook = buildPlaybook(inp, fc, plan);
  const rec = playbook.strategies.find((s) => s.recommended) ?? playbook.strategies[0];
  const precedent = findSimilarEvents(inp, 15, fc.expected_duration_min);

  const card = {
    event_name: inp.event_name ?? null,
    cause: inp.cause,
    corridor: inp.corridor,
    lat: inp.lat ?? null,
    lon: inp.lon ?? null,
    input: inp, // resolved EventInput — lets the UI deep-link into /plan prefilled

    forecast: {
      impact_score: fc.impact_score,
      tier: fc.tier,
      expected_duration_min: fc.expected_duration_min,
      affected_radius_m: fc.affected_radius_m,
    },
    recommended_strategy: { name: rec.name, why: playbook.why },
    resource_plan: playbook.resource_plan,
    precedent: {
      n: precedent.n,
      median_clearance_min: precedent.median_clearance_min,
      p90_clearance_min: precedent.p90_clearance_min,
      closure_rate: precedent.closure_rate,
    },
  };
  return card;
}

export type CopilotToolResult = { result: unknown; card?: unknown };

export function executeTool(name: string, args: any): CopilotToolResult {
  switch (name) {
    case "query_stats":
      return { result: toolQueryStats(args) };
    case "find_events":
      return { result: toolFindEvents(args) };
    case "find_similar_events":
      return { result: toolFindSimilar(args) };
    case "plan_event": {
      const card = toolPlanEvent(args);
      return { result: card, card: { type: "plan", ...card } };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}
