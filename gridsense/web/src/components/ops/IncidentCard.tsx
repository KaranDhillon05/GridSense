"use client";

import Link from "next/link";
import { SEVERITY_COLOR, ESCALATION_COLOR } from "@/lib/ops/format";
import { prettyCause } from "@/lib/ui";
import type { OpsIncident } from "@/lib/ops/types";

export function IncidentCard({ incident, clockMs }: { incident: OpsIncident; clockMs: number }) {
  const ageMin = Math.round((clockMs - incident.detectedAt) / 60000);
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="block rounded-xl border border-black/[0.08] bg-white p-3 hover:border-black/[0.16] hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: SEVERITY_COLOR[incident.severity] }}
        />
        <span className="text-sm font-medium text-[#1d1d1f] truncate flex-1">
          {prettyCause(incident.type)}
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase shrink-0"
          style={{ background: `${ESCALATION_COLOR[incident.escalation]}1a`, color: ESCALATION_COLOR[incident.escalation] }}
        >
          {incident.escalation}
        </span>
      </div>
      <div className="text-[11px] text-[#6e6e73] mt-1 truncate">{incident.corridor}</div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-[#a1a1a6]">
        <span>{incident.id} · {ageMin}m</span>
        <span className="flex items-center gap-1.5">
          {incident.scenario && <span className="text-[#0071e3]" title="Wind-Tunnel eligible">◇ sim</span>}
          {incident.assignedResourceIds.length > 0 && (
            <span>{incident.assignedResourceIds.length} units</span>
          )}
          {incident.etaClearMin != null && incident.status !== "detected" && (
            <span>~{Math.round(incident.etaClearMin)}m</span>
          )}
        </span>
      </div>
    </Link>
  );
}
