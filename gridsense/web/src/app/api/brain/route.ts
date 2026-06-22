import { NextRequest, NextResponse } from "next/server";
import { getLlm } from "@/lib/llm";
import {
  deterministicBrief,
  snapshotToPrompt,
  type BrainSnapshot,
} from "@/lib/ops/brain";
import type { OpsBrief } from "@/lib/ops/types";

// One LLM round-trip; keep headroom beyond the default.
export const maxDuration = 30;

const SYSTEM = `You are the GridSense Operations Brain for the Bengaluru Traffic Police command center.
You are given the CURRENT live operating picture (metrics + active incidents). Produce a crisp, scannable operations brief a duty officer can read in 30 seconds.

Hard rules:
- Use ONLY the numbers in the situation report. Never invent incidents, corridors, or figures.
- This is traffic operations, NOT navigation. Talk about response, diversion, units, escalation — never "fastest route".
- Be terse and operational. Prioritise by severity, escalation, and whether an incident is unresourced.
- Recommend running the Strategy Wind Tunnel for sim-eligible incidents before committing a plan.

Respond with STRICT JSON only, matching:
{"headline": string, "situation": string, "priorities": string[], "recommendations": [{"action": string, "rationale": string, "priority": "high"|"med"|"low", "incidentId"?: string}], "escalations": string[]}`;

export async function POST(req: NextRequest) {
  let snapshot: BrainSnapshot;
  try {
    const body = (await req.json()) as { snapshot: BrainSnapshot };
    snapshot = body.snapshot;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const fallback = (): OpsBrief => deterministicBrief(snapshot);

  const llm = getLlm();
  if (!llm.key) return NextResponse.json(fallback());

  try {
    const res = await fetch(llm.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${llm.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: snapshotToPrompt(snapshot) },
        ],
        ...llm.extraBody,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty");
    const parsed = JSON.parse(content);

    const brief: OpsBrief = {
      headline: String(parsed.headline ?? fallback().headline),
      situation: String(parsed.situation ?? ""),
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map(String).slice(0, 5) : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.slice(0, 5).map((r: Record<string, unknown>, idx: number) => ({
            id: `rec-${idx}`,
            incidentId: typeof r.incidentId === "string" ? r.incidentId : undefined,
            action: String(r.action ?? ""),
            rationale: String(r.rationale ?? ""),
            priority: r.priority === "high" || r.priority === "low" ? r.priority : "med",
          }))
        : [],
      escalations: Array.isArray(parsed.escalations) ? parsed.escalations.map(String).slice(0, 5) : [],
      source: "ai",
      generatedAt: Date.now(),
    };
    return NextResponse.json(brief);
  } catch (e) {
    console.error("[brain] error:", e);
    return NextResponse.json(fallback());
  }
}
