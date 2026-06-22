"use client";

import type { ResponsePlan } from "@/lib/sim/decisionEngine";
import type { Resource } from "@/lib/sim/types";
import { RESOURCE_META } from "@/lib/sim/resources";

const STRATEGY_LABEL: Record<string, string> = {
  none: "No diversion",
  local: "Local diversion",
  full: "Full diversion (road closed)",
  split: "Split traffic across corridors",
  oneway: "Temporary one-way plan",
  corridor: "Protected corridor",
  perimeter: "Perimeter closure",
};

export function ResponsePanel({
  plan,
  applied,
  resources,
  onApply,
}: {
  plan: ResponsePlan;
  applied: boolean;
  resources: Resource[];
  onApply: (p: ResponsePlan) => void;
}) {
  const onScene = resources.filter((r) => r.targetIncidentId === plan.incidentId);
  return (
    <div className="rounded-xl border border-white/10 bg-[#11151d]/90 p-4 text-white">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-sm">Recommended response</div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0071e3]/20 text-[#7cc0ff]">decision engine</span>
      </div>
      <div className="text-[12px] text-white/70 mb-3">{plan.headline}</div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-[#22c55e]/10 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/40">Projected delay ↓</div>
          <div className="font-bold text-lg text-[#22c55e]">{plan.projectedDelayReductionPct}%</div>
        </div>
        <div className="rounded-lg bg-white/5 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/40">Est. clearance</div>
          <div className="font-bold text-lg">{plan.expectedClearanceMin} min</div>
        </div>
      </div>

      <Section title="Diversion strategy">
        <div className="text-xs text-white/80 mb-1">{STRATEGY_LABEL[plan.diversionStrategy] ?? plan.diversionStrategy}</div>
        {plan.diversions.map((d) => (
          <div key={d.rank} className="flex items-center gap-2 text-[11px] text-white/60 mb-0.5">
            <span className="w-9 tabular-nums text-[#7cc0ff] font-semibold">{Math.round(d.share * 100)}%</span>
            <span className="flex-1 truncate">{d.label || "alternate corridor"}</span>
            <span className="text-white/40">{d.lengthKm} km</span>
          </div>
        ))}
        {!plan.diversions.length && <div className="text-[11px] text-white/40">No viable diversion corridor</div>}
      </Section>

      <Section title="Signal plan">
        <div className="text-[11px] text-white/70">{plan.signalPlan.action}</div>
      </Section>

      <Section title="Manpower & equipment">
        <div className="flex flex-wrap gap-1">
          {plan.manpower.map((m) => (
            <span key={m.type} className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/75">
              {m.count}× {m.label}
            </span>
          ))}
          {plan.barricades > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/75">{plan.barricades}× barricades/cones</span>
          )}
        </div>
      </Section>

      <Section title="Field actions">
        <ul className="text-[11px] text-white/65 list-disc list-inside space-y-0.5">
          {plan.actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </Section>

      {!applied ? (
        <button
          onClick={() => onApply(plan)}
          className="w-full mt-1 py-2 rounded-lg bg-[#0071e3] text-white text-sm font-semibold hover:brightness-110"
        >
          ✓ Apply intervention
        </button>
      ) : (
        <div className="mt-1">
          <div className="text-[11px] text-[#22c55e] font-medium mb-1">✓ Intervention applied — units dispatched</div>
          <div className="flex flex-wrap gap-1">
            {onScene.map((r) => (
              <span
                key={r.id}
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  r.status === "onscene" ? "bg-[#22c55e]/20 text-[#86efac]" : "bg-[#eab308]/20 text-[#fde047]"
                }`}
              >
                {RESOURCE_META[r.type].label} · {r.status === "onscene" ? "on scene" : "en route"}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{title}</div>
      {children}
    </div>
  );
}
