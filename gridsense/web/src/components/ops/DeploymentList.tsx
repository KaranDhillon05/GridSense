"use client";

import type { Deployment } from "@/lib/ops/types";

const KIND_LABEL: Record<Deployment["kind"], string> = {
  diversion: "Diversion",
  barricade: "Barricade",
  signal_override: "Signal override",
  field_unit: "Field unit",
};

const KIND_COLOR: Record<Deployment["kind"], string> = {
  diversion: "#22c55e",
  barricade: "#ef4444",
  signal_override: "#a855f7",
  field_unit: "#3b82f6",
};

export function DeploymentList({ deployments }: { deployments: Deployment[] }) {
  const active = deployments.filter((d) => d.status !== "stood_down");
  if (!active.length)
    return <div className="text-xs text-[#6e6e73]">No active deployments.</div>;
  return (
    <div className="space-y-1.5">
      {active.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: KIND_COLOR[d.kind] }}
          />
          <span className="text-[#1d1d1f] font-medium">{KIND_LABEL[d.kind]}</span>
          <span className="text-[#6e6e73] truncate">{d.label}</span>
          {d.status === "proposed" && (
            <span className="ml-auto text-[10px] text-[#f59e0b] font-medium shrink-0">
              proposed
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
