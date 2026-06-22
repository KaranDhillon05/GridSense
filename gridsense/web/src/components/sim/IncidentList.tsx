"use client";

import { INCIDENT_CATALOG } from "@/lib/sim/incidents";
import type { Engine } from "@/lib/sim/engine";
import type { Incident } from "@/lib/sim/types";

const SEV_COLOR: Record<string, string> = {
  low: "#22c55e",
  moderate: "#eab308",
  high: "#f97316",
  severe: "#ef4444",
};

export function IncidentList({
  incidents,
  engine,
  selected,
  onSelect,
}: {
  incidents: Incident[];
  engine: Engine | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!incidents.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#11151d]/90 p-4 text-white/45 text-xs">
        No active incidents. Click any road on the map to inject one.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-[#11151d]/90 p-3 text-white">
      <div className="font-semibold text-sm mb-2">Active incidents ({incidents.length})</div>
      <div className="space-y-1.5">
        {incidents.map((inc) => {
          const road = engine?.net.edge(inc.edgeId)?.name ?? "road";
          const mins = Math.ceil(inc.durationSec / 60);
          const isSel = selected === inc.id;
          return (
            <button
              key={inc.id}
              onClick={() => onSelect(inc.id)}
              className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition-colors ${
                isSel ? "border-[#0071e3] bg-[#0071e3]/10" : "border-white/8 bg-white/[0.03] hover:bg-white/[0.07]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[inc.severity] }} />
                <span className="text-xs font-medium flex-1 truncate">{INCIDENT_CATALOG[inc.type].label}</span>
                <span className="text-[10px] text-white/40 tabular-nums">~{mins}m</span>
              </div>
              <div className="text-[10px] text-white/45 pl-4 truncate">
                {road}
                {inc.fullBlockage ? " · blocked" : ` · ${inc.lanesAffected} lane(s)`}
                {inc.responseApplied ? " · responding" : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
