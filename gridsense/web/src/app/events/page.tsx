"use client";

import { useSyncExternalStore, useMemo } from "react";
import Link from "next/link";
import { getEventsSnapshot, subscribeEvents } from "@/lib/ops/eventsStore";
import { forecastEvent } from "@/lib/ops/eventPlanning";
import { tierColor } from "@/lib/ui";

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  scheduled: { bg: "#f5f5f7", fg: "#6e6e73", label: "Scheduled" },
  planned: { bg: "#eef2ff", fg: "#3730a3", label: "Plan ready" },
  active: { bg: "#ecfdf5", fg: "#065f46", label: "Active" },
  closed: { bg: "#f5f5f7", fg: "#a1a1a6", label: "Closed" },
};

function startsLabel(min: number): string {
  if (min < 60) return `starts in ${min}m`;
  const h = Math.floor(min / 60);
  return `starts in ${h}h${min % 60 ? ` ${min % 60}m` : ""}`;
}

export default function EventsPage() {
  const snap = useSyncExternalStore(subscribeEvents, getEventsSnapshot, getEventsSnapshot);
  const events = useMemo(() => [...snap.events].sort((a, b) => a.startsInMin - b.startsInMin), [snap]);

  return (
    <div className="content-width py-6 px-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Event Operations Center</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Calendar-driven planning · forecast → strategies → Wind Tunnel → deploy
          </p>
        </div>
        <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
          Operations Center →
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {events.map((e) => {
          const fc = forecastEvent(e);
          const badge = STATUS_BADGE[e.status];
          return (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              className="rounded-2xl border border-black/[0.08] bg-white p-4 hover:border-black/[0.16] hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1d1d1f]">{e.name}</div>
                  <div className="text-[11px] text-[#6e6e73] mt-0.5">{e.venue} · {e.corridor}</div>
                </div>
                <span
                  className="text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: badge.bg, color: badge.fg }}
                >
                  {badge.label}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: `${tierColor(fc.tier)}18`, color: tierColor(fc.tier) }}
                >
                  {fc.tier} · {fc.impact_score}
                </span>
                <span className="text-[11px] text-[#6e6e73]">
                  {e.attendance.toLocaleString("en-IN")} · {startsLabel(e.startsInMin)}
                </span>
              </div>
              {fc.simEligible && (
                <div className="text-[10px] text-[#0071e3] mt-2">◇ Wind-Tunnel eligible</div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
