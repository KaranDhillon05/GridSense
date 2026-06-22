import { NextRequest, NextResponse } from "next/server";
import { TOOLS, executeTool, CAUSES, CORRIDORS } from "@/lib/copilotTools";
import { getLlm } from "@/lib/llm";

// The copilot runs a bounded tool loop (model → tool → model). Give it headroom
// beyond the default since each turn is an LLM round-trip.
export const maxDuration = 30;

const MAX_TOOL_ROUNDS = 3;

const SYSTEM = `You are GridSense Copilot, an assistant for the Bengaluru Traffic Police (ASTraM) congestion-management platform.

You help officers (1) query the historical ASTraM event data and (2) generate operational plans for events that are about to happen.

Hard rules:
- NEVER invent numbers. Every statistic or forecast MUST come from a tool call. If a tool returns no data, say so.
- This is corridor-aware traffic operations, NOT navigation. Never claim a "fastest route"; say "candidate alternate movement corridor".
- When the user describes an event to plan/prepare for (rally, protest, match, procession, VIP movement, breakdown, waterlogging, etc.), call plan_event. Infer cause, whether it's planned, peak overlap, and likely road closure from the description. Resolve well-known venues by passing location_name.
- For "how long / how many / worst" questions, call query_stats or find_events. To ground a forecast in precedent, call find_similar_events.
- Keep answers concise and operational. Cite the actual numbers the tools return.

Known causes: ${CAUSES.join(", ")}.
Known corridors: ${CORRIDORS.join(", ")}.`;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

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
  };

  if (!llm.key) {
    return NextResponse.json({
      reply:
        "The Copilot needs an LLM API key (GEMINI_API_KEY, CEREBRAS_API_KEY, or GROQ_API_KEY) to be configured. Meanwhile you can use the Plan an Event console directly for forecasts and playbooks.",
      cards: [],
      source: "unavailable",
    });
  }
  const cfg = { url: llm.url, model: llm.model, key: llm.key, extraBody: llm.extraBody };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
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

      // Record the assistant's tool-call turn, then execute each tool.
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        let args: any = {};
        try {
          args = JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          args = {};
        }
        if (!args || typeof args !== "object") args = {};
        const { result, card } = executeTool(tc.function?.name, args);
        if (card) cards.push(card);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Ran out of tool rounds — ask the model for a final answer with no more tools.
    const finalRes = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, temperature: 0.3, messages, ...cfg.extraBody }),
      signal: AbortSignal.timeout(15000),
    });
    const finalData = await finalRes.json();
    const finalMsg = finalData?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ reply: finalMsg, cards, source: "ai" });
  } catch (e) {
    console.error("[copilot] error:", e);
    return NextResponse.json({
      reply:
        "I couldn't reach the reasoning service just now. Please try again, or use the Plan an Event console for a full playbook.",
      cards,
      source: "error",
    });
  }
}
