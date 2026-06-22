"use client";

import { useState } from "react";
import type { Checklist } from "@/lib/types";

type Phase = "before" | "during" | "after";
const PHASES: { id: Phase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "during", label: "During" },
  { id: "after", label: "After" },
];

export function FieldChecklist({ checklist }: { checklist: Checklist }) {
  const [phase, setPhase] = useState<Phase>("before");
  const [done, setDone] = useState<Record<string, boolean>>({});

  const items = checklist[phase];

  return (
    <div className="surface-panel p-5">
      <div className="text-xs muted uppercase tracking-wide mb-3">Field checklist</div>
      <div className="flex gap-1 mb-3">
        {PHASES.map((p) => (
          <button
            key={p.id}
            onClick={() => setPhase(p.id)}
            className="flex-1 text-xs py-1.5 rounded-md transition"
            style={{
              background: phase === p.id ? "var(--accent)" : "var(--panel-2)",
              color: phase === p.id ? "#fff" : "var(--muted)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => {
          const key = `${phase}-${i}`;
          const checked = done[key];
          return (
            <li key={key}>
              <button
                onClick={() => setDone((d) => ({ ...d, [key]: !d[key] }))}
                className="flex items-start gap-2 text-sm text-left w-full"
                style={{ color: checked ? "var(--muted)" : "var(--text)" }}
              >
                <span
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 text-[10px]"
                  style={{
                    background: checked ? "var(--low)" : "var(--panel-2)",
                    border: "1px solid var(--border)",
                    color: "#06210f",
                  }}
                >
                  {checked ? "✓" : ""}
                </span>
                <span style={{ textDecoration: checked ? "line-through" : "none" }}>
                  {item}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
