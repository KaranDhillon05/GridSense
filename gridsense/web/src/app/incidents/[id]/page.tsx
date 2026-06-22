"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useOps } from "@/lib/ops/useOps";
import {
  assignResource,
  updateIncidentStatus,
  setTaskStatus,
  getOpsState,
} from "@/lib/ops/store";
import { OpsMap } from "@/components/ops/OpsMap";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { IncidentCommander } from "@/components/ops/IncidentCommander";
import { WindTunnelPanel } from "@/components/ops/WindTunnelPanel";
import { PillButton } from "@/components/ui/PillButton";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import { RESOURCE_META } from "@/lib/sim/resources";
import { SEVERITY_COLOR, STATUS_LABEL, formatClock } from "@/lib/ops/format";
import { prettyCause } from "@/lib/ui";
import type { ResourceType } from "@/lib/sim/types";

function dispatchResponse(incidentId: string, type: string) {
  const spec = INCIDENT_CATALOG[type as keyof typeof INCIDENT_CATALOG];
  const types = (Object.keys(spec.response.resources) as ResourceType[]).filter(
    (t) => RESOURCE_META[t]?.mobile
  );
  for (const t of types.slice(0, 3)) {
    const r = getOpsState().resources.find((x) => x.type === t && x.status === "available");
    if (r) assignResource(r.id, incidentId);
  }
  updateIncidentStatus(incidentId, "responding", "Units dispatched");
}

export default function IncidentDetail() {
  const params = useParams<{ id: string }>();
  const state = useOps();
  const incident = useMemo(
    () => state.incidents.find((i) => i.id === params.id),
    [state.incidents, params.id]
  );

  if (!incident) {
    return (
      <div className="content-width py-16 text-center">
        <p className="text-[#6e6e73]">Incident not found.</p>
        <Link href="/incidents" className="text-[#0071e3] text-sm mt-2 inline-block">
          ← Back to incidents
        </Link>
      </div>
    );
  }

  const assigned = state.resources.filter((r) => incident.assignedResourceIds.includes(r.id));
  const tasks = state.tasks.filter((t) => t.incidentId === incident.id);
  const ageMin = Math.round((state.clockMs - incident.detectedAt) / 60000);

  return (
    <div className="content-width py-6 px-4">
      <OpsTickerMount />

      <div className="flex items-center justify-between mb-4">
        <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
          ← Operations Center
        </Link>
        <Link href="/incidents" className="text-sm text-[#6e6e73] hover:text-[#1d1d1f]">
          All incidents
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ background: SEVERITY_COLOR[incident.severity] }}
        />
        <h1 className="text-2xl font-bold text-[#1d1d1f]">{prettyCause(incident.type)}</h1>
        <span className="text-[#6e6e73]">· {incident.corridor}</span>
        <span className="ml-auto flex items-center gap-2 text-sm">
          <span className="px-2.5 py-1 rounded-full bg-[#1d1d1f] text-white text-xs font-medium">
            {STATUS_LABEL[incident.status]}
          </span>
          <span className="text-[#6e6e73] text-xs">
            {incident.id} · open {ageMin}m
          </span>
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_minmax(360px,440px)] gap-5 items-start">
        {/* Left column */}
        <div className="space-y-5">
          <div className="h-[320px] rounded-2xl overflow-hidden border border-black/[0.08] relative">
            <OpsMap
              state={state}
              selectedId={incident.id}
              center={[incident.lat, incident.lon]}
              zoom={incident.incidentPlan ? 14 : 15}
              trafficPlan={incident.incidentPlan}
              mapplsContext={incident.incidentPlanContext}
            />
          </div>

          {/* Timeline */}
          <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
            <div className="text-sm font-semibold text-[#1d1d1f] mb-3">Timeline</div>
            <ol className="space-y-2.5">
              {incident.timeline.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-[#6e6e73] tabular-nums shrink-0 w-12">
                    {formatClock(t.t)}
                  </span>
                  <span className="text-[#1d1d1f]">{t.label}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Tasks */}
          <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
            <div className="text-sm font-semibold text-[#1d1d1f] mb-3">
              Tasks · {tasks.filter((t) => t.status !== "done").length} open
            </div>
            {tasks.length === 0 && <div className="text-xs text-[#6e6e73]">No tasks yet.</div>}
            <div className="space-y-1.5">
              {tasks.map((t) => (
                <label key={t.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={(e) => setTaskStatus(t.id, e.target.checked ? "done" : "todo")}
                    className="accent-[#0071e3]"
                  />
                  <span className={t.status === "done" ? "line-through text-[#a1a1a6]" : "text-[#1d1d1f]"}>
                    {t.title}
                  </span>
                  {t.sourceRecommendation && (
                    <span className="ml-auto text-[10px] text-[#6e6e73]">{t.sourceRecommendation}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <IncidentCommander incident={incident} />
          <WindTunnelPanel incident={incident} />

          {/* Assigned resources + actions */}
          <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
            <div className="text-sm font-semibold text-[#1d1d1f] mb-2">
              Assigned units · {assigned.length}
            </div>
            {assigned.length === 0 ? (
              <div className="text-xs text-[#6e6e73] mb-3">No units assigned yet.</div>
            ) : (
              <div className="space-y-1.5 mb-3">
                {assigned.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className="text-[#1d1d1f]">
                      {r.label} {r.id}
                    </span>
                    <span className="text-[#6e6e73]">
                      {r.status}
                      {r.status === "enroute" && r.etaMin != null ? ` · ETA ${Math.ceil(r.etaMin)}m` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {incident.status !== "closed" && incident.assignedResourceIds.length === 0 && (
                <PillButton
                  variant="secondary"
                  onClick={() => dispatchResponse(incident.id, incident.type)}
                  className="!py-2 !px-4 text-xs"
                >
                  Dispatch response
                </PillButton>
              )}
              {incident.status !== "verified" && incident.status === "detected" && (
                <PillButton
                  variant="secondary"
                  onClick={() => updateIncidentStatus(incident.id, "verified", "Verified")}
                  className="!py-2 !px-4 text-xs"
                >
                  Verify
                </PillButton>
              )}
              {incident.status !== "closed" && (
                <PillButton
                  variant="ghost"
                  onClick={() => updateIncidentStatus(incident.id, "closed", "Closed manually")}
                  className="!py-2 !px-4 text-xs"
                >
                  Close incident
                </PillButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
