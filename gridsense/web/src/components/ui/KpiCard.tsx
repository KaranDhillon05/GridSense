import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  color,
  className = "",
}: {
  label: string;
  value: number | string;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`glass-panel px-5 py-4 min-w-[120px] ${className}`}>
      <div
        className="text-3xl font-bold tabular-nums tracking-tight"
        style={{ color: color ?? "var(--text)" }}
      >
        {value}
      </div>
      <div className="text-caption text-[#6e6e73] mt-1 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}
