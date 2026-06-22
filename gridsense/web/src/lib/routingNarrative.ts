// GridSense — operations brief for the map-intelligence routing plan.
//
// Takes the COMPUTED routing metrics (the narrative_grounding from networkPlanner)
// and asks Groq to write a short, human ops brief grounded STRICTLY on those
// numbers. The decisions are algorithmic; the LLM only narrates them. Falls back
// to a deterministic template if no LLM key is set or the call fails, so the
// brief is always present. Mirrors the auth/timeout/fallback pattern in ai.ts.

import { getLlm } from "@/lib/llm";

const SYSTEM = `You are a traffic-operations planner for the Bengaluru Traffic Police (ASTraM).
You are given the COMPUTED output of a road-network optimization (real OSM graph + equilibrium traffic assignment). Write a tight operations brief.

Hard rules:
- Use ONLY the numbers provided. Never invent roads, routes, or figures.
- This is corridor-aware traffic operations, NOT navigation. Never say "fastest route"; say "candidate alternate movement corridor" / "approach".
- 4-7 sentences, operational and specific. Reference the load split, the hard closures, the diversion, the reserved emergency corridor, and the top bottleneck.
- Plain text, no markdown headers.`;

export async function generateOpsBrief(grounding: Record<string, unknown>): Promise<string> {
  const { url, model, key, extraBody } = getLlm();
  if (!key) return templateBrief(grounding);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...extraBody,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Computed routing plan:\n${JSON.stringify(grounding, null, 2)}\n\nWrite the operations brief.` },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return templateBrief(grounding);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : templateBrief(grounding);
  } catch {
    return templateBrief(grounding);
  }
}

// Deterministic fallback so the brief is never empty.
function templateBrief(g: Record<string, unknown>): string {
  const inb = (g.inbound_approaches as Array<any>) ?? [];
  const out = (g.outbound_approaches as Array<any>) ?? [];
  const em = g.emergency as { hospital: string; distance_km: number } | null;
  const bn = (g.bottlenecks as Array<any>) ?? [];
  const hard = (g.hard_closures as number) ?? 0;
  const divs = (g.diversions as Array<any>) ?? [];
  const parts: string[] = [];
  if (inb.length) {
    const lead = inb[0];
    parts.push(
      `Inbound demand distributes across ${inb.length} real approach${inb.length > 1 ? "es" : ""}, led by ${lead.road} at ${lead.share_pct}% (${lead.flow_vph} vph).`
    );
  }
  if (out.length) parts.push(`Dispersal releases across ${out.length} outbound corridor${out.length > 1 ? "s" : ""}; stagger exit waves to hold utilization below 1.0.`);
  if (hard) parts.push(`${hard} boundary cut-edge${hard > 1 ? "s are" : " is"} hard-closed to keep through-traffic out of the cordon.`);
  if (divs.length) parts.push(`Through-movements are diverted around the cordon on real streets.`);
  if (em) parts.push(`A ${em.distance_km} km corridor to ${em.hospital} is reserved and gated — never barricaded.`);
  if (bn.length) parts.push(`Watch ${bn[0].road} (utilization ${bn[0].utilization}) as the primary bottleneck.`);
  return parts.join(" ");
}
