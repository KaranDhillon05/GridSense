"use client";

import { useMemo, useState } from "react";
import {
  runWindTunnel,
  shapeResult,
  acceptWindTunnelPlan,
  type WindTunnelResult,
  type RankedPlan,
} from "@/lib/ops/windTunnel";
import { PillButton } from "@/components/ui/PillButton";
import type { OpsIncident } from "@/lib/ops/types";

function PlanRow({ p, maxDelay }: { p: RankedPlan; maxDelay: number }) {
  const pct = maxDelay > 0 ? (p.outcome.totalDelayVehMin / maxDelay) * 100 : 0;
  return (
    <tr className={p.recommended ? "bg-[#0071e308]" : ""}>
      <td className="py-2 pl-2 pr-1">
        <div className="flex items-center gap-1.5">
          {p.recommended && (
            <span className="text-[9px] font-bold text-white bg-[#0071e3] px-1.5 py-0.5 rounded-full">
              BEST
            </span>
          )}
          <span className="text-xs font-semibold text-[#1d1d1f]">{p.label.replace("Plan ", "")}</span>
        </div>
        <div className="text-[10px] text-[#6e6e73] mt-0.5">{p.blurb}</div>
      </td>
      <td className="py-2 px-1">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 rounded-full bg-[#e8e8ed] flex-1 min-w-[36px] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: p.id === "D" ? "#ef4444" : p.recommended ? "#0071e3" : "#94a3b8",
              }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-[#1d1d1f] w-10 text-right">
            {p.delayVehMin}
          </span>
        </div>
      </td>
      <td className="py-2 px-1 text-[11px] tabular-nums text-[#424245] text-right">{p.maxQueueM}m</td>
      <td className="py-2 px-1 text-[11px] tabular-nums text-[#424245] text-right">
        {p.clearanceMin != null ? `${p.clearanceMin}m` : "—"}
      </td>
      <td className="py-2 px-1 text-[11px] tabular-nums text-[#424245] text-right">{p.resourceCost}</td>
      <td className="py-2 pl-1 pr-2 text-[11px] tabular-nums font-semibold text-right" style={{ color: p.reductionPct > 0 ? "#16a34a" : "#6e6e73" }}>
        {p.id === "D" ? "—" : `${p.reductionPct}%`}
      </td>
    </tr>
  );
}

function bundleCount(plan: NonNullable<WindTunnelResult["trafficPlan"]>): {
  routes: number;
  diversions: number;
  barricades: number;
  posts: number;
  bottlenecks: number;
} {
  const r = plan.routes;
  const routes =
    r.primary_inbound.length +
    r.secondary_inbound.length +
    r.primary_outbound.length +
    r.secondary_outbound.length +
    r.through_diversion.length +
    r.emergency_access.length;
  return {
    routes,
    diversions: r.through_diversion.length,
    barricades: plan.barricade_points.length,
    posts: plan.deployment_posts.length,
    bottlenecks: plan.bottleneck_edges.length,
  };
}

function PlanSummary({ plan }: { plan: NonNullable<WindTunnelResult["trafficPlan"]> }) {
  const c = bundleCount(plan);
  const stats = [
    { label: "Routes", value: c.routes },
    { label: "Diversions", value: c.diversions },
    { label: "Barricades", value: c.barricades },
    { label: "Posts", value: c.posts },
    { label: "Bottlenecks", value: c.bottlenecks },
  ];
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-[#f5f5f7] p-2 text-center">
            <div className="text-sm font-semibold text-[#1d1d1f] tabular-nums">{s.value}</div>
            <div className="text-[9px] text-[#6e6e73] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {plan.methodology && (
        <p className="text-[10px] text-[#6e6e73] mt-2 leading-snug">{plan.methodology}</p>
      )}
    </div>
  );
}

export function WindTunnelPanel({ incident }: { incident: OpsIncident }) {
  const cached = useMemo<WindTunnelResult | null>(() => shapeResult(incident), [incident]);
  const [wt, setWt] = useState<WindTunnelResult | null>(cached);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [accepted, setAccepted] = useState(false);

  const display = wt ?? cached;
  const sim = display?.result && display.plans ? display : null;

  const run = async () => {
    setRunning(true);
    setProgress(0);
    try {
      const res = await runWindTunnel(incident, { seeds: 2, onProgress: setProgress });
      setWt(res);
    } finally {
      setRunning(false);
    }
  };

  const accept = () => {
    if (!display) return;
    acceptWindTunnelPlan(incident, display);
    setAccepted(true);
  };

  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-[#1d1d1f]">Strategy Wind Tunnel</div>
        {sim && (
          <span className="text-[10px] text-[#6e6e73]">
            {sim.result!.seeds} seeds · {sim.result!.windowMin.toFixed(0)} min · {sim.result!.runtimeMs.toFixed(0)}ms
          </span>
        )}
      </div>
      <p className="text-xs text-[#6e6e73] mb-3">
        Generate a full-Bangalore traffic plan — diversions, reroutes, barricades and
        pre-positioning — and, inside the CBD, prove the best response through the live engine.
      </p>

      {!display && (
        <PillButton onClick={run} disabled={running} className="w-full !py-2.5">
          {running ? `Planning… ${progress}%` : "Run Wind Tunnel"}
        </PillButton>
      )}

      {running && !display && (
        <div className="mt-3 h-1.5 rounded-full bg-[#e8e8ed] overflow-hidden">
          <div className="h-full bg-[#0071e3] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {display && (
        <>
          {display.trafficPlan && <PlanSummary plan={display.trafficPlan} />}

          {sim && (
            <>
              <table className="w-full border-collapse mt-3">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wide text-[#6e6e73]">
                    <th className="text-left pl-2 pb-1 font-medium">Plan</th>
                    <th className="text-left px-1 pb-1 font-medium">Delay (veh·min)</th>
                    <th className="text-right px-1 pb-1 font-medium">Queue</th>
                    <th className="text-right px-1 pb-1 font-medium">Clear</th>
                    <th className="text-right px-1 pb-1 font-medium">Cost</th>
                    <th className="text-right pr-2 pb-1 font-medium">↓Delay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {sim.plans!.map((p) => (
                    <PlanRow
                      key={p.id}
                      p={p}
                      maxDelay={Math.max(...sim.plans!.map((x) => x.outcome.totalDelayVehMin), 1)}
                    />
                  ))}
                </tbody>
              </table>

              <p className="text-[11px] text-[#1d1d1f] bg-[#f5f5f7] rounded-lg p-2.5 mt-3 leading-snug">
                {sim.recommendationText}
              </p>
            </>
          )}

          {!sim && display.trafficPlan && (
            <p className="text-[11px] text-[#6e6e73] mt-2 leading-snug">
              This incident is outside the simulated CBD network, so the A/B/C/D delay proof isn&apos;t
              available — but the full-Bangalore plan above is rendered on the map.
            </p>
          )}

          <div className="flex gap-2 mt-3">
            <PillButton onClick={accept} disabled={accepted} className="flex-1 !py-2.5">
              {accepted
                ? "✓ Plan deployed"
                : `Deploy ${sim?.recommended ? sim.recommended.label.split(" · ")[0] : "plan"}`}
            </PillButton>
            <PillButton variant="secondary" onClick={run} disabled={running} className="!py-2.5">
              {running ? `${progress}%` : "Re-run"}
            </PillButton>
          </div>
          {accepted && (
            <p className="text-[11px] text-[#16a34a] mt-2">
              Deployments and tasks pushed to the live operating picture
              {sim ? ". Outcome logged to playbook memory." : "."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
