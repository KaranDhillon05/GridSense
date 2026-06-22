import { NextRequest, NextResponse } from "next/server";
import { TOOLS, executeTool, CAUSES, CORRIDORS } from "@/lib/copilotTools";
import { getLlm } from "@/lib/llm";

// Ops-aware Copilot 2.0: the historical copilot tool-loop PLUS the live operating
// picture injected as context, so it can answer "what's critical now / what's
// overloaded / show best response for bus breakdowns" against real-time state.
export const maxDuration = 30;

const MAX_TOOL_ROUNDS = 3;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

function systemPrompt(situation: string): string {
  return `You are GridSense Copilot 2.0, the operational assistant for the Bengaluru Traffic Police command center.

You orchestrate live traffic operations. You can (1) read the LIVE operating picture below, and (2) ground answers in historical ASTraM data via tools.

Hard rules:
- NEVER invent numbers. Live facts come from the operating picture below; historical stats/precedents MUST come from a tool call.
- This is traffic operations, NOT navigation. Never say "fastest route"; say "alternate movement corridor".
- Be concise and operational. When the user asks what to do, recommend a concrete action (dispatch units, run the Strategy Wind Tunnel on incident X, activate a diversion) and name the incident id.
- For "best response for <incident type>" or "how long do X take", call find_similar_events / query_stats.

LIVE OPERATING PICTURE:
${situation}

Known causes: ${CAUSES.join(", ")}.
Known corridors: ${CORRIDORS.join(", ")}.`;
}

async function callLlm(
  cfg: { url: string; model: string; key: string; extraBody: Record<string, unknown> },
  messages: ChatMessage[]
) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      tools: TOOLS,
      tool_choice: "auto",
      messages,
      ...cfg.extraBody,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message;
}

export async function POST(req: NextRequest) {
  const llm = getLlm();
  const body = (await req.json()) as {
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
    situation?: string;
  };

  if (!llm.key) {
    return NextResponse.json({
      reply:
        "Copilot 2.0 needs an LLM API key. You can still drive operations directly — open an incident to run the Wind Tunnel, or use the dispatch recommendations on /resources.",
      cards: [],
      source: "unavailable",
    });
  }
  const cfg = { url: llm.url, model: llm.model, key: llm.key, extraBody: llm.extraBody };

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(body.situation ?? "(operating picture unavailable)") },
    ...(body.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: body.message },
  ];

  const cards: unknown[] = [];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const msg = await callLlm(cfg, messages);
      if (!msg) break;
      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return NextResponse.json({ reply: msg.content ?? "", cards, source: "ai" });
      }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });
      for (const tc of toolCalls as Array<{ id: string; function?: { name: string; arguments?: string } }>) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          args = {};
        }
        const { result, card } = executeTool(tc.function?.name ?? "", args);
        if (card) cards.push(card);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    const finalRes = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, temperature: 0.3, messages, ...cfg.extraBody }),
      signal: AbortSignal.timeout(15000),
    });
    const finalData = await finalRes.json();
    return NextResponse.json({
      reply: finalData?.choices?.[0]?.message?.content ?? "",
      cards,
      source: "ai",
    });
  } catch (e) {
    console.error("[ops-copilot] error:", e);
    return NextResponse.json({
      reply: "I couldn't reach the reasoning service. Try the dispatch recommendations on /resources, or open an incident to run the Wind Tunnel.",
      cards,
      source: "error",
    });
  }
}
