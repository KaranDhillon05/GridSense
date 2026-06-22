"use client";

// Small shared chips used across playbook cards.

const DEMAND_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  urgent: "#ef4444",
};

export function DemandBadge({ label, value }: { label: string; value: string }) {
  const color = DEMAND_COLOR[value] ?? "var(--muted)";
  return (
    <div className="flex items-center justify-between gap-3 text-xs min-w-0">
      <span className="text-[#6e6e73] shrink-0">{label}</span>
      <span
        className="px-2 py-0.5 rounded-full font-medium capitalize shrink-0"
        style={{ background: "var(--panel-2)", color }}
      >
        {value}
      </span>
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full"
      style={{ background: "var(--panel-2)" }}
    >
      {children}
    </span>
  );
}
