"use client";

import type { TrafficImpactReport } from "@/lib/types";

export function TrafficImpactCard({ impact }: { impact: TrafficImpactReport }) {
  return (
    <div className="surface-panel p-5">
      <div className="text-xs muted uppercase tracking-wide mb-3">Traffic impact</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Peak arrival" value={`${impact.peak_arrival_vph} vph`} />
        <Stat label="Peak departure" value={`${impact.peak_departure_vph} vph`} />
        <Stat label="Vehicle trips" value={String(impact.total_vehicle_trips)} />
        <Stat label="Dispersal p90" value={`${impact.time_to_disperse_p90_min} min`} />
        <Stat label="Baseline delay" value={`+${impact.baseline_delay_min} min`} />
        <Stat label="Load factor" value={`${Math.round(impact.traffic_load_factor * 100)}%`} />
      </div>
      {impact.critical_edges.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-[10px] muted uppercase tracking-wide mb-1">Critical edges</div>
          <ul className="text-xs space-y-1">
            {impact.critical_edges.slice(0, 4).map((e) => (
              <li key={e.edge_id}>
                {e.name} — {Math.round(e.utilization * 100)}% util ({e.assigned_flow_vph} vph)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
        {value}
      </div>
      <div className="text-[11px] muted">{label}</div>
    </div>
  );
}
