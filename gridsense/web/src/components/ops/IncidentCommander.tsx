"use client";

import { useMemo } from "react";
import { buildCommanderReport } from "@/lib/ops/commander";
import { ESCALATION_COLOR } from "@/lib/ops/format";
import { fmtDuration } from "@/lib/ui";
import type { OpsIncident } from "@/lib/ops/types";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#f5f5f7] rounded-xl p-3">
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color: color ?? "#1d1d1f" }}>
        {value}
      </div>
      <div className="text-[10px] text-[#6e6e73] mt-1 leading-tight">{label}</div>
    </div>
  );
}

export function IncidentCommander({ incident }: { incident: OpsIncident }) {
  const report = useMemo(
    () => buildCommanderReport(incident),
    // recompute when identity / sim result changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incident.id, incident.windTunnel, incident.status]
  );
  const a = report.assessment;
  const escColor = ESCALATION_COLOR[incident.escalation];

  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0071e3]">
          AI Incident Commander
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
          style={{ background: `${escColor}1a`, color: escColor }}
        >
          {incident.escalation}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Spillover risk" value={`${a.spilloverJunctions} jns`} />
        <Stat label="Added delay" value={`~${a.predictedDelayMin}m`} color="#f97316" />
        <Stat
          label="Historical match"
          value={`${a.historicalSimilarityPct}%`}
          color="#0071e3"
        />
        <Stat
          label="Precedent P50 clear"
          value={report.precedent.n ? fmtDuration(report.precedent.median_clearance_min) : "—"}
        />
      </div>

      <p className="text-sm text-[#1d1d1f] leading-snug">{a.summary}</p>

      {report.precedent.n > 0 && (
        <p className="text-[11px] text-[#6e6e73] mt-2 leading-snug">
          Grounded in {report.precedent.n} similar past incidents ({report.precedent.same_cause_n}{" "}
          same cause): actual clearance P50 {fmtDuration(report.precedent.median_clearance_min)}, P90{" "}
          {fmtDuration(report.precedent.p90_clearance_min)} · {Math.round(report.precedent.closure_rate * 100)}% needed a closure.
        </p>
      )}

      {a.escalate && (
        <div className="mt-3 rounded-xl bg-[#fef2f2] border border-[#fecaca] p-2.5">
          <div className="text-[11px] font-semibold text-[#b91c1c] flex items-center gap-1.5">
            <span aria-hidden>⚠</span> Escalation recommended
          </div>
          <p className="text-[11px] text-[#7f1d1d] mt-0.5 leading-snug">
            Queue growth and severity exceed threshold — add units / a barricade team and run the
            Wind Tunnel to commit the strongest response.
          </p>
        </div>
      )}

      {report.recommendedManpower.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-[#6e6e73] mb-1.5">
            Recommended response
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.recommendedManpower.map((m) => (
              <span
                key={m.label}
                className="text-[11px] bg-[#eef2ff] text-[#3730a3] px-2 py-1 rounded-full font-medium"
              >
                {m.count}× {m.label}
              </span>
            ))}
            {report.responsePlan?.diversions[0] && (
              <span className="text-[11px] bg-[#ecfdf5] text-[#065f46] px-2 py-1 rounded-full font-medium">
                Diversion: {report.responsePlan.diversions[0].label}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
