"use client";

import { useMemo } from "react";
import { IncidentCard } from "./IncidentCard";
import { STATUS_LABEL } from "@/lib/ops/format";
import { INCIDENT_STATUS_ORDER } from "@/lib/ops/types";
import type { OpsIncident, IncidentStatus } from "@/lib/ops/types";

const COLUMN_ACCENT: Record<IncidentStatus, string> = {
  detected: "#ef4444",
  verified: "#f97316",
  responding: "#0071e3",
  managed: "#8b5cf6",
  clearing: "#14b8a6",
  closed: "#a1a1a6",
};

export function IncidentBoard({
  incidents,
  clockMs,
}: {
  incidents: OpsIncident[];
  clockMs: number;
}) {
  const byStatus = useMemo(() => {
    const map: Record<IncidentStatus, OpsIncident[]> = {
      detected: [],
      verified: [],
      responding: [],
      managed: [],
      clearing: [],
      closed: [],
    };
    for (const i of incidents) map[i.status].push(i);
    return map;
  }, [incidents]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {INCIDENT_STATUS_ORDER.map((status) => {
        const list = byStatus[status];
        return (
          <div key={status} className="min-w-0">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: COLUMN_ACCENT[status] }}
              />
              <span className="text-xs font-semibold text-[#1d1d1f]">{STATUS_LABEL[status]}</span>
              <span className="text-[11px] text-[#a1a1a6] tabular-nums">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.map((i) => (
                <IncidentCard key={i.id} incident={i} clockMs={clockMs} />
              ))}
              {list.length === 0 && (
                <div className="text-[11px] text-[#c7c7cc] px-1 py-3 text-center border border-dashed border-black/[0.06] rounded-xl">
                  —
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
