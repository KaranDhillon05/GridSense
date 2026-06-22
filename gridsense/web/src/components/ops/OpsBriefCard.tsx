"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toBrainSnapshot, deterministicBrief } from "@/lib/ops/brain";
import type { OpsState, OpsBrief } from "@/lib/ops/types";

const PRIORITY_COLOR = { high: "#ef4444", med: "#f59e0b", low: "#6e6e73" } as const;

export function OpsBriefCard({ state }: { state: OpsState }) {
  const snapshot = useMemo(() => toBrainSnapshot(state), [state]);
  const ruleBrief = useMemo(() => deterministicBrief(snapshot), [snapshot]);
  const [aiBrief, setAiBrief] = useState<OpsBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const snapRef = useRef(snapshot);
  useEffect(() => {
    snapRef.current = snapshot;
  }, [snapshot]);

  // Refetch the AI brief when the situation materially changes, plus a heartbeat.
  const signature = `${snapshot.metrics.activeIncidents}-${snapshot.metrics.severeCount}-${snapshot.metrics.activeDeployments}`;

  useEffect(() => {
    let alive = true;
    const fetchBrief = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot: snapRef.current }),
        });
        const brief = (await res.json()) as OpsBrief;
        if (alive && brief?.headline) setAiBrief(brief);
      } catch {
        /* keep the rule brief */
      } finally {
        if (alive) setLoading(false);
      }
    };
    const t = setTimeout(fetchBrief, 800);
    const hb = setInterval(fetchBrief, 45000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(hb);
    };
  }, [signature]);

  const brief = aiBrief ?? ruleBrief;

  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0071e3]">
          AI Ops Brief
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
          style={{
            background: brief.source === "ai" ? "#0071e312" : "#6e6e7312",
            color: brief.source === "ai" ? "#0071e3" : "#6e6e73",
          }}
        >
          {brief.source === "ai" ? "live AI" : "rule-based"}
        </span>
        {loading && <span className="text-[9px] text-[#a1a1a6]">refreshing…</span>}
      </div>

      <div className="text-sm font-semibold text-[#1d1d1f] leading-snug">
        {brief.headline}
      </div>
      <p className="text-[11px] text-[#6e6e73] mt-1 leading-snug">{brief.situation}</p>

      {brief.recommendations.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {brief.recommendations.map((r) => (
            <div key={r.id} className="flex gap-2 text-[11px]">
              <span
                className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: PRIORITY_COLOR[r.priority] }}
              />
              <div className="min-w-0">
                <div className="text-[#1d1d1f] font-medium leading-snug">{r.action}</div>
                <div className="text-[#6e6e73] leading-snug">{r.rationale}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {brief.escalations.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-black/[0.05] space-y-1">
          {brief.escalations.map((e, i) => (
            <div key={i} className="text-[11px] text-[#b45309] flex gap-1.5">
              <span aria-hidden>⚠</span>
              <span className="leading-snug">{e}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
