// GridSense — AI-assisted playbook generation (Groq / Llama).
//
// Design: the AI does NOT replace our learned signals. We keep the trained
// duration model + data-derived impact score as the factual base, build a
// grounding context from real ASTraM statistics (historical clearance for this
// cause/corridor, closure rates, event density), and ask the LLM to reason over
// THAT to produce strategies + advisory. If GROQ_API_KEY is missing or the call
// fails / returns invalid JSON, callers fall back to the rule engine, so the
// demo never breaks.

import aggregates from "@/data/aggregates.json";
import type { EventInput } from "@/lib/gridsense";
import type { Playbook, Strategy } from "@/lib/types";
import { getLlm } from "@/lib/llm";

type Forecast = {
  impact_score: number;
  tier: string;
  expected_duration_min: number;
  affected_radius_m: number;
};

// --- Grounding context: real numbers the model must reason over -------------
export function buildGrounding(inp: EventInput, fc: Forecast) {
  const agg = aggregates as any;
  const causeMed = agg.cause_median_duration_min?.[inp.cause] ?? null;
  const corridorMed = agg.corridor_median_duration_min?.[inp.corridor] ?? null;
  const corridorEvents = agg.corridor_event_counts?.[inp.corridor] ?? null;
  const zoneEvents = inp.zone ? agg.zone_event_counts?.[inp.zone] ?? null : null;

  return {
    forecast: {
      impact_score: fc.impact_score,
      tier: fc.tier,
      expected_clearance_min: fc.expected_duration_min,
      affected_radius_m: fc.affected_radius_m,
    },
    event: {
      cause: inp.cause,
      corridor: inp.corridor,
      zone: inp.zone ?? "Unknown",
      junction: inp.junction ?? null,
      vehicle_type: inp.veh_type ?? "unknown",
      priority: inp.priority ?? "High",
      requires_road_closure: !!inp.requires_road_closure,
      is_planned: !!inp.is_planned,
      is_peak_hour: !!inp.is_peak,
      affected_junctions: inp.affected_junctions ?? 1,
    },
    historical_evidence: {
      city_median_clearance_min: agg.overall_median_duration_min,
      this_cause_median_clearance_min: causeMed,
      this_corridor_median_clearance_min: corridorMed,
      this_corridor_total_events_in_dataset: corridorEvents,
      this_zone_total_events_in_dataset: zoneEvents,
      dataset_window: `${agg.date_min} to ${agg.date_max}`,
      dataset_event_count: agg.n_events,
    },
  };
}

// --- Prompt -----------------------------------------------------------------
const SYSTEM = `You are a traffic-operations planning assistant for the Bengaluru Traffic Police (ASTraM).
You receive a data-derived forecast and REAL historical statistics from the ASTraM event dataset, and you produce an operational playbook.

Hard rules:
- This is corridor-aware traffic operations planning, NOT navigation. Never claim a "fastest route" or optimal routing. Refer to "candidate alternate movement corridor".
- Ground every recommendation in the provided forecast and historical_evidence. Reference the numbers (e.g. expected clearance, this-corridor median) in your reasoning.
- Be concrete and operational (officer deployment, barricading, junction control, diversion, public advisory, timing).
- Output STRICT JSON only, matching the requested schema. No prose outside JSON.`;

function userPrompt(grounding: ReturnType<typeof buildGrounding>): string {
  return `Generate an operational playbook for this event.

CONTEXT (data-derived forecast + real ASTraM statistics):
${JSON.stringify(grounding, null, 2)}

Return STRICT JSON with this exact shape:
{
  "recommended_strategy_id": string,                // id of the best strategy below
  "why": string[],                                  // 2-5 bullets, each citing a forecast/historical number
  "strategies": [                                   // 3-5 strategies, exactly one with recommended=true
    {
      "id": string,                                 // snake_case, e.g. "full_diversion"
      "name": string,
      "type": "diversion-heavy"|"flow-management"|"time-restriction"|"clearance"|"vehicle-restriction"|"communication"|"junction-control",
      "recommended": boolean,
      "use_when": string,
      "expected_congestion_reduction": "low"|"medium"|"high",
      "resource_demand": "low"|"medium"|"high",
      "barricade_demand": "low"|"medium"|"high",
      "public_communication_need": "low"|"medium"|"urgent",
      "operational_complexity": "low"|"medium"|"high",
      "confidence": "low"|"medium"|"high",
      "reasoning": string[],                         // 2-4 bullets
      "actions": string[]                            // 3-5 concrete field actions
    }
  ],
  "advisory": {
    "control_style": string,
    "impacted_corridor": string,
    "candidate_alternates": string[],
    "control_points": string[],
    "public_note": string,
    "selected_route_id"?: string,
    "route_options"?: [
      {
        "id": string,
        "rank": number,
        "provider": string,
        "geometry": number[][],
        "distance_km": number,
        "extra_travel_min": number,
        "estimated_clearance_relief": "low"|"medium"|"high",
        "advisory_note": string
      }
    ]
  },
  "checklist": { "before": string[], "during": string[], "after": string[] }
}`;
}

// --- Validation: ensure the LLM output is usable ----------------------------
function isValidPlaybook(p: any): p is Omit<Playbook, "resource_plan"> {
  if (!p || typeof p !== "object") return false;
  if (!Array.isArray(p.strategies) || p.strategies.length < 3 || p.strategies.length > 5)
    return false;
  const recCount = p.strategies.filter((s: any) => s?.recommended).length;
  if (recCount !== 1) return false;
  const okStrategy = (s: any): s is Strategy =>
    s && typeof s.id === "string" && typeof s.name === "string" &&
    Array.isArray(s.reasoning) && Array.isArray(s.actions);
  if (!p.strategies.every(okStrategy)) return false;
  if (typeof p.recommended_strategy_id !== "string") return false;
  if (!Array.isArray(p.why)) return false;
  if (!p.advisory || !p.checklist) return false;
  if (!Array.isArray(p.advisory.candidate_alternates)) return false;
  if (!Array.isArray(p.checklist.before)) return false;
  return true;
}

export type AiPlaybook = Omit<Playbook, "resource_plan">;

// Returns the AI playbook (minus resource_plan, which we compute from our own
// data-grounded recommender), or null to signal "use the rule-engine fallback".
export async function generateAiPlaybook(
  inp: EventInput,
  fc: Forecast
): Promise<AiPlaybook | null> {
  const { url, model, key, extraBody } = getLlm();
  if (!key) return null;

  const grounding = buildGrounding(inp, fc);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...extraBody,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(grounding) },
        ],
      }),
      // Generous timeout: the playbook is a large structured generation and can
      // take >12s on a cold start, especially with reasoning models.
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!isValidPlaybook(parsed)) return null;
    // Keep recommended_strategy_id consistent with the flagged strategy, in case
    // the model's top-level id drifts from the one it marked recommended.
    const flagged = parsed.strategies.find((s: Strategy) => s.recommended);
    if (flagged && parsed.recommended_strategy_id !== flagged.id) {
      parsed.recommended_strategy_id = flagged.id;
    }
    return parsed as AiPlaybook;
  } catch (e) {
    console.error("[ai-playbook] threw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
