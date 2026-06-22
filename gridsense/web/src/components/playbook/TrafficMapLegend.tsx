"use client";

import { useState } from "react";
import type { DataSource, TrafficPhase } from "@/lib/types";

const ROUTE_ITEMS = [
  { color: "#0071e3", label: "Inbound primary" },
  { color: "#60a5fa", label: "Inbound secondary" },
  { color: "#f97316", label: "Outbound primary" },
  { color: "#fdba74", label: "Outbound secondary" },
  { color: "#22c55e", label: "Through diversion" },
  { color: "#a855f7", label: "Emergency access" },
  { color: "#ef4444", label: "Bottleneck edge" },
];

function SourceBadge({ source }: { source: DataSource | undefined }) {
  if (!source) return null;
  const label =
    source === "mappls" ? "Live · Mappls" : source === "osrm" ? "Live · OSM" : "Modelled";
  return (
    <span className="inline-block text-[9px] font-medium px-2 py-0.5 rounded-full ml-1 bg-[#f5f5f7] text-[#6e6e73]">
      {label}
    </span>
  );
}

export function TrafficMapLegend({
  phase,
  onPhaseChange,
  showContingency,
  onToggleContingency,
  isochroneSource,
  facilitiesSource,
  routeSource,
}: {
  phase: TrafficPhase;
  onPhaseChange: (p: TrafficPhase) => void;
  showContingency: boolean;
  onToggleContingency: () => void;
  isochroneSource?: DataSource;
  facilitiesSource?: DataSource;
  routeSource?: DataSource;
}) {
  const [expanded, setExpanded] = useState(false);
  const phases: TrafficPhase[] = ["pre_event", "arrival", "during", "dispersal", "post_event"];

  return (
    <>
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] surface-panel-map px-3 py-2 flex flex-wrap items-center justify-center gap-1.5 max-w-[min(95vw,720px)]">
        {phases.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPhaseChange(p)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              phase === p
                ? "bg-[#1d1d1f] text-white"
                : "text-[#6e6e73] hover:bg-[#f5f5f7]"
            }`}
          >
            {p.replace("_", " ")}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleContingency}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            showContingency ? "bg-[#0071e3] text-white" : "text-[#6e6e73] hover:bg-[#f5f5f7]"
          }`}
        >
          Contingency
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="px-3 py-1.5 rounded-full text-xs font-medium text-[#0071e3] hover:bg-[#f5f5f7]"
        >
          {expanded ? "Hide legend" : "Legend"}
        </button>
      </div>

      {expanded && (
        <div className="absolute top-4 right-4 z-[1000] surface-panel-map p-4 text-xs max-w-[240px] max-h-[50vh] overflow-y-auto">
          <div className="font-semibold text-[#1d1d1f] mb-3">Map legend</div>
          <div className="text-caption text-[#6e6e73] uppercase tracking-wide mb-1">Routes</div>
          <div className="space-y-1 mb-3">
            {ROUTE_ITEMS.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-[#424245]">
                <span className="w-4 h-0.5 rounded" style={{ background: item.color }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="text-caption text-[#6e6e73] uppercase tracking-wide mb-1">Data sources</div>
          <div className="space-y-1 text-[#424245]">
            <div>Routes <SourceBadge source={routeSource} /></div>
            <div>Isochrones <SourceBadge source={isochroneSource} /></div>
            <div>Facilities <SourceBadge source={facilitiesSource} /></div>
          </div>
        </div>
      )}
    </>
  );
}
