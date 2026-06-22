"use client";

import type { OpsMetrics } from "@/lib/ops/types";

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="surface-panel-map px-3 py-2 min-w-[92px]">
      <div
        className="text-xl font-bold tabular-nums leading-none"
        style={{ color: color ?? "#1d1d1f" }}
      >
        {value}
      </div>
      <div className="text-[10px] font-medium text-[#6e6e73] mt-1 uppercase tracking-wide">
        {label}
      </div>
      {sub && <div className="text-[9px] text-[#a1a1a6] mt-0.5">{sub}</div>}
    </div>
  );
}

export function MetricsStrip({ metrics }: { metrics: OpsMetrics }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Metric label="Active" value={metrics.activeIncidents} />
      <Metric label="High-impact" value={metrics.severeCount} color="var(--high)" />
      <Metric
        label="Deployments"
        value={metrics.activeDeployments}
        color="#0071e3"
      />
      <Metric
        label="Resources"
        value={`${metrics.resourcesCommitted}/${metrics.resourcesCommitted + metrics.resourcesAvailable}`}
        sub={`${metrics.resourceUtilizationPct}% committed`}
      />
      <Metric label="Critical corridors" value={metrics.criticalCorridors} color="var(--severe)" />
      <Metric label="Avg response" value={`${metrics.avgResponseMin}m`} />
      <Metric
        label="Veh-hrs saved"
        value={metrics.vehicleHoursSavedToday}
        color="#16a34a"
        sub="today"
      />
      <Metric label="Open tasks" value={metrics.openTasks} />
    </div>
  );
}
