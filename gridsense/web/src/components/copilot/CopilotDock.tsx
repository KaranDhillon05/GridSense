"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import type { EventInput } from "@/lib/gridsense";
import { fmtDuration, prettyCause, tierColor } from "@/lib/ui";

type PlanCard = {
  type: "plan";
  event_name: string | null;
  cause: string;
  corridor: string;
  input: EventInput;
  forecast: { impact_score: number; tier: string; expected_duration_min: number; affected_radius_m: number };
  recommended_strategy: { name: string; why: string[] };
  resource_plan: any;
  precedent: { n: number; median_clearance_min: number; p90_clearance_min: number; closure_rate: number };
};

type Msg = { role: "user" | "assistant"; content: string; cards?: PlanCard[] };

const SUGGESTIONS = [
  "Which corridors have the worst breakdown clearance times?",
  "Plan a 20k protest at Freedom Park at 5pm with road closure",
  "Show me the most severe waterlogging events on record",
];

export function CopilotDock() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const data = await res.json();
      const cards = (data.cards ?? []).filter((c: any) => c?.type === "plan") as PlanCard[];
      setMsgs((m) => [...m, { role: "assistant", content: data.reply ?? "", cards }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function openFullPlan(card: PlanCard) {
    sessionStorage.setItem("gridsense_copilot_plan_input", JSON.stringify(card.input));
    router.push("/plan");
    setOpen(false);
  }

  if (path === "/plan/report") return null;

  return (
    <>
      <motion.button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[1000] rounded-full px-5 py-3.5 text-sm font-semibold bg-[#1d1d1f] text-white shadow-elevated flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071e3]"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        aria-label="Ask GridSense"
      >
        <span className="text-base">✨</span> Ask GridSense
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1001] bg-black/20 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 z-[1002] w-full sm:w-[420px] flex flex-col glass-panel rounded-l-3xl border-r-0 shadow-elevated"
            >
              <div className="flex items-center justify-between px-5 h-16 shrink-0 border-b border-black/[0.04]">
                <div className="leading-tight">
                  <div className="font-semibold text-[#1d1d1f]">GridSense Copilot</div>
                  <div className="text-caption text-[#6e6e73]">Grounded on ASTraM data</div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-2xl text-[#6e6e73] px-2 rounded-full hover:bg-[#f5f5f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3]"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
                {msgs.length === 0 && (
                  <div className="space-y-4">
                    <p className="text-sm text-[#6e6e73]">
                      Ask about the data, or describe an event to plan — I&apos;ll forecast impact,
                      recommend a strategy, and pull historical precedent.
                    </p>
                    <div className="space-y-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="block w-full text-left text-sm px-4 py-3 rounded-2xl bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors text-[#424245]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm max-w-[90%] whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-[#1d1d1f] text-white"
                          : "bg-[#f5f5f7] text-[#1d1d1f]"
                      }`}
                    >
                      {m.content}
                      {m.cards?.map((c, j) => (
                        <PlanCardView key={j} card={c} onOpen={() => openFullPlan(c)} />
                      ))}
                    </div>
                  </div>
                ))}

                {loading && <div className="text-caption text-[#6e6e73]">Thinking…</div>}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="p-4 flex gap-2 shrink-0 border-t border-black/[0.04]"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask or describe an event…"
                  className="flex-1 text-sm px-4 py-2.5 rounded-full bg-[#f5f5f7] border border-black/[0.06] text-[#1d1d1f] focus:outline focus:outline-2 focus:outline-[#0071e3]"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="text-sm font-medium px-5 py-2.5 rounded-full bg-[#1d1d1f] text-white disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function PlanCardView({ card, onOpen }: { card: PlanCard; onOpen: () => void }) {
  const fc = card.forecast;
  return (
    <div className="mt-3 rounded-2xl p-4 text-xs bg-white border border-black/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[#1d1d1f]">{card.event_name || prettyCause(card.cause)}</span>
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-medium"
          style={{ background: `${tierColor(fc.tier)}18`, color: tierColor(fc.tier) }}
        >
          {fc.tier} · {fc.impact_score}
        </span>
      </div>
      <div className="space-y-0.5 text-[#6e6e73]">
        <div>Corridor: <span className="text-[#1d1d1f]">{card.corridor}</span></div>
        <div>Forecast: <span className="text-[#1d1d1f]">{fmtDuration(fc.expected_duration_min)}</span></div>
        <div>Strategy: <span className="text-[#1d1d1f]">{card.recommended_strategy.name}</span></div>
      </div>
      <button
        onClick={onOpen}
        className="mt-3 w-full text-center text-[11px] font-medium py-2 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#0071e3]"
      >
        Open full plan →
      </button>
    </div>
  );
}
