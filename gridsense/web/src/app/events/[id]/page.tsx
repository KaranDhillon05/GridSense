"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getEventsSnapshot, subscribeEvents } from "@/lib/ops/eventsStore";
import { forecastEvent, eventToIncident, stageEvent } from "@/lib/ops/eventPlanning";
import { useOps } from "@/lib/ops/useOps";
import { OpsTickerMount } from "@/components/ops/OpsTickerMount";
import { IncidentCommander } from "@/components/ops/IncidentCommander";
import { WindTunnelPanel } from "@/components/ops/WindTunnelPanel";
import { PillButton } from "@/components/ui/PillButton";
import { tierColor, fmtDuration } from "@/lib/ui";
import { INCIDENT_CATALOG } from "@/lib/sim/incidents";

export default function EventDetail() {
  const params = useParams<{ id: string }>();
  const snap = useSyncExternalStore(subscribeEvents, getEventsSnapshot, getEventsSnapshot);
  const state = useOps();
  const event = snap.events.find((e) => e.id === params.id);

  const fc = useMemo(() => (event ? forecastEvent(event) : null), [event]);
  const preview = useMemo(() => (event ? eventToIncident(event) : null), [event]);
  const stagedIncident = event?.linkedIncidentId
    ? state.incidents.find((i) => i.id === event.linkedIncidentId)
    : undefined;

  if (!event || !fc || !preview) {
    return (
      <div className="content-width py-16 text-center">
        <p className="text-[#6e6e73]">Event not found.</p>
        <Link href="/events" className="text-[#0071e3] text-sm mt-2 inline-block">
          ← Back to events
        </Link>
      </div>
    );
  }

  const incidentForPanels = stagedIncident ?? preview;

  return (
    <div className="content-width py-6 px-4">
      <OpsTickerMount />

      <div className="flex items-center justify-between mb-4">
        <Link href="/events" className="text-sm text-[#0071e3] hover:underline">
          ← Event Operations Center
        </Link>
        {stagedIncident && (
          <Link href={`/incidents/${stagedIncident.id}`} className="text-sm text-[#6e6e73] hover:text-[#1d1d1f]">
            Open in incident command →
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-[#1d1d1f]">{event.name}</h1>
        <span className="text-[#6e6e73]">· {event.venue} · {event.corridor}</span>
        <span
          className="ml-auto text-sm font-semibold px-3 py-1 rounded-full"
          style={{ background: `${tierColor(fc.tier)}18`, color: tierColor(fc.tier) }}
        >
          {fc.tier} · {fc.impact_score}
        </span>
      </div>

      {/* Forecast summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        <div className="surface-panel-map px-4 py-3">
          <div className="text-xl font-bold tabular-nums">{event.attendance.toLocaleString("en-IN")}</div>
          <div className="text-[10px] text-[#6e6e73] uppercase tracking-wide mt-1">Attendance</div>
        </div>
        <div className="surface-panel-map px-4 py-3">
          <div className="text-xl font-bold tabular-nums">{fmtDuration(fc.expected_duration_min)}</div>
          <div className="text-[10px] text-[#6e6e73] uppercase tracking-wide mt-1">Expected impact window</div>
        </div>
        <div className="surface-panel-map px-4 py-3">
          <div className="text-xl font-bold tabular-nums">{INCIDENT_CATALOG[fc.type].label}</div>
          <div className="text-[10px] text-[#6e6e73] uppercase tracking-wide mt-1">Modeled as</div>
        </div>
        <div className="surface-panel-map px-4 py-3">
          <div className="text-xl font-bold tabular-nums">{event.requiresClosure ? "Yes" : "No"}</div>
          <div className="text-[10px] text-[#6e6e73] uppercase tracking-wide mt-1">Road closure</div>
        </div>
      </div>

      {event.status === "scheduled" ? (
        <div className="rounded-2xl border border-black/[0.08] bg-white p-5 mb-5">
          <div className="text-sm font-semibold text-[#1d1d1f] mb-1">Generate operational plan</div>
          <p className="text-xs text-[#6e6e73] mb-4 max-w-lg">
            Stage this event as a managed operation. GridSense forecasts the impact, builds the AI
            Commander assessment, and — for CBD venues — lets you wind-tunnel test Plan A/B/C/D before
            deploying resources, diversions and tasks into the live operating picture.
          </p>
          <PillButton onClick={() => stageEvent(event)}>Generate plan & stage operation</PillButton>
        </div>
      ) : (
        <div className="text-[11px] text-[#065f46] bg-[#ecfdf5] rounded-lg px-3 py-2 mb-5 inline-block">
          ✓ Staged as operation {stagedIncident?.id ?? event.linkedIncidentId} — plan below flows to the live picture.
        </div>
      )}

      {/* Commander + Wind Tunnel (preview before staging, live after) */}
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <IncidentCommander incident={incidentForPanels} />
        {event.status === "scheduled" ? (
          <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white p-4 text-xs text-[#6e6e73]">
            Stage the operation to run the Strategy Wind Tunnel and deploy a plan.
          </div>
        ) : (
          <WindTunnelPanel incident={incidentForPanels} />
        )}
      </div>
    </div>
  );
}
