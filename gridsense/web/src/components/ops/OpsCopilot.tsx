"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toBrainSnapshot, snapshotToPrompt } from "@/lib/ops/brain";
import { getOpsState, updateIncidentStatus, assignResource } from "@/lib/ops/store";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { RESOURCE_META } from "@/lib/sim/resources";
import type { OpsState, ResourceType } from "@/lib/ops/types";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK = [
  "What are the critical incidents right now?",
  "What resources are overloaded?",
  "Show the best response for a bus breakdown",
];

function dispatchAllUnresourced(): number {
  const s = getOpsState();
  const needy = s.incidents.filter(
    (i) => i.status !== "closed" && i.assignedResourceIds.length === 0 && i.status !== "detected"
  );
  let n = 0;
  for (const inc of needy) {
    const types = (Object.keys(INCIDENT_CATALOG[inc.type].response.resources) as ResourceType[]).filter(
      (t) => RESOURCE_META[t]?.mobile
    );
    let dispatched = false;
    for (const t of types.slice(0, 2)) {
      const r = getOpsState().resources.find((x) => x.type === t && x.status === "available");
      if (r) {
        assignResource(r.id, inc.id);
        dispatched = true;
      }
    }
    if (dispatched) {
      updateIncidentStatus(inc.id, "responding", "Dispatched via Copilot");
      n++;
    }
  }
  return n;
}

export function OpsCopilot({ state }: { state: OpsState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const situation = useMemo(() => snapshotToPrompt(toBrainSnapshot(state)), [state]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    const history = messages.slice(-6);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ops-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history, situation }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.reply || "(no reply)" }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the reasoning service." }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    }
  };

  const topIncident = useMemo(() => {
    const ESC: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...state.incidents]
      .filter((i) => i.status !== "closed")
      .sort((a, b) => ESC[a.escalation] - ESC[b.escalation])[0];
  }, [state.incidents]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-4 left-3 z-[1002] surface-panel-map px-4 py-2.5 text-sm font-medium text-[#1d1d1f] flex items-center gap-2"
      >
        <span className="w-2 h-2 rounded-full bg-[#0071e3]" /> Copilot 2.0
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 left-3 z-[1002] w-[min(360px,calc(100vw-1.5rem))] surface-panel-map flex flex-col max-h-[70vh]">
      <div className="flex items-center justify-between p-3 border-b border-black/[0.06]">
        <span className="text-sm font-semibold text-[#1d1d1f]">Copilot 2.0</span>
        <button type="button" onClick={() => setOpen(false)} className="text-[#6e6e73] hover:text-[#1d1d1f] text-lg leading-none">
          ×
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]">
        {messages.length === 0 && (
          <div className="text-xs text-[#6e6e73]">
            Ask about the live picture or history. Try a suggestion below.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-xs rounded-xl px-3 py-2 max-w-[88%] ${
              m.role === "user"
                ? "bg-[#0071e3] text-white ml-auto"
                : "bg-white border border-black/[0.06] text-[#1d1d1f]"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && <div className="text-xs text-[#a1a1a6]">thinking…</div>}
      </div>

      {/* Quick actions */}
      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => send(q)}
            className="text-[10px] bg-[#f0f0f2] hover:bg-[#e8e8ed] text-[#424245] rounded-full px-2 py-1"
          >
            {q.length > 28 ? q.slice(0, 26) + "…" : q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const n = dispatchAllUnresourced();
            setMessages((m) => [
              ...m,
              { role: "assistant", content: n ? `Dispatched units to ${n} unresourced incident(s).` : "No unresourced incidents to dispatch." },
            ]);
          }}
          className="text-[10px] bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#3730a3] rounded-full px-2 py-1 font-medium"
        >
          ⚡ Dispatch unresourced
        </button>
        {topIncident && (
          <button
            type="button"
            onClick={() => router.push(`/incidents/${topIncident.id}`)}
            className="text-[10px] bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#3730a3] rounded-full px-2 py-1 font-medium"
          >
            ◇ Wind Tunnel top incident
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="p-2 border-t border-black/[0.06] flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Copilot…"
          className="flex-1 text-sm bg-white border border-black/[0.08] rounded-full px-3 py-1.5 focus:outline-none focus:border-[#0071e3]"
        />
        <button
          type="submit"
          disabled={loading}
          className="text-sm font-medium text-white bg-[#1d1d1f] rounded-full px-3 py-1.5 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
