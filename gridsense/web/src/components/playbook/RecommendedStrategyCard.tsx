"use client";

import type { Strategy } from "@/lib/types";

export function RecommendedStrategyCard({
  strategy,
  why,
}: {
  strategy: Strategy;
  why: string[];
}) {
  return (
    <div
      className="surface-panel p-5"
      style={{ borderColor: "var(--low)", borderWidth: 1 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "var(--low)", color: "#06210f" }}
        >
          RECOMMENDED STRATEGY
        </span>
      </div>
      <div className="text-lg font-semibold mt-2">{strategy.name}</div>
      <div className="text-xs muted">{strategy.use_when}</div>

      <div className="mt-3">
        <div className="text-[10px] muted uppercase tracking-wide mb-1.5">
          Why this is recommended
        </div>
        <ul className="space-y-1">
          {why.map((w, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span style={{ color: "var(--low)" }}>✓</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="text-[10px] muted uppercase tracking-wide mb-1.5">
          First actions
        </div>
        <ol className="space-y-1 text-sm list-decimal list-inside">
          {strategy.actions.slice(0, 4).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
