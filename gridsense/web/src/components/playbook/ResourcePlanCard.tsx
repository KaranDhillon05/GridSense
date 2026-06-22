"use client";

import type { ResourcePlan } from "@/lib/types";
import { Chip } from "./Badges";

export function ResourcePlanCard({ plan }: { plan: ResourcePlan }) {
  return (
    <div className="surface-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs muted uppercase tracking-wide">Resource plan</div>
        <span className="text-[11px] muted">confidence: {plan.confidence}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat n={plan.officers_range} l="Officers (range)" />
        <Stat n={plan.barricades_range} l="Barricades (range)" />
        <Stat n={String(plan.constables)} l="Constables / shift" />
        <Stat n={String(plan.head_constables)} l="Head constables" />
        <Stat n={String(plan.wardens)} l="Wardens" />
        <Stat n={String(plan.shifts)} l="Shifts" />
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="text-[10px] muted uppercase tracking-wide mb-1.5">Special units / equipment</div>
        <div className="flex flex-wrap gap-1">
          {plan.special_units.map((u) => (
            <Chip key={u}>{u}</Chip>
          ))}
        </div>
      </div>

      <div className="text-xs muted mt-3">{plan.narrative}</div>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>
        {n}
      </div>
      <div className="text-[11px] muted">{l}</div>
    </div>
  );
}
