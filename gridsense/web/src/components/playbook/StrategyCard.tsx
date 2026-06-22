"use client";

import type { Strategy } from "@/lib/types";
import { DemandBadge } from "./Badges";

const TYPE_LABEL: Record<string, string> = {
  "diversion-heavy": "Diversion",
  "flow-management": "Flow mgmt",
  "time-restriction": "Time restriction",
  clearance: "Clearance",
  "vehicle-restriction": "Vehicle restriction",
  communication: "Communication",
  "junction-control": "Junction control",
};

export function StrategyCard({
  strategy,
  selected,
  onSelect,
}: {
  strategy: Strategy;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="text-left surface-panel p-4 w-full transition hover:shadow-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3]"
      style={{
        boxShadow: selected ? "0 0 0 2px #0071e3" : undefined,
        borderColor: strategy.recommended ? "rgba(34,197,94,0.3)" : undefined,
      }}
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-medium text-sm leading-snug">{strategy.name}</div>
        {strategy.recommended && (
          <span
            className="self-start text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "var(--low)", color: "#06210f" }}
          >
            RECOMMENDED
          </span>
        )}
        <div className="text-[11px] text-[#6e6e73]">
          {TYPE_LABEL[strategy.type] ?? strategy.type}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3">
        <DemandBadge label="Congestion cut" value={strategy.expected_congestion_reduction} />
        <DemandBadge label="Resources" value={strategy.resource_demand} />
        <DemandBadge label="Barricades" value={strategy.barricade_demand} />
        <DemandBadge label="Comms" value={strategy.public_communication_need} />
        <DemandBadge label="Complexity" value={strategy.operational_complexity} />
        <DemandBadge label="Confidence" value={strategy.confidence} />
      </div>

      {selected && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-[11px] muted">{strategy.use_when}</div>
          <div>
            <div className="text-[10px] muted uppercase tracking-wide mb-1">Reasoning</div>
            <ul className="text-xs space-y-0.5 list-disc list-inside">
              {strategy.reasoning.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] muted uppercase tracking-wide mb-1">Actions</div>
            <ul className="text-xs space-y-0.5 list-disc list-inside">
              {strategy.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </button>
  );
}
