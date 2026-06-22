"use client";

export function SimulationProgress({ pct, count }: { pct: number; count: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white/70">Running simulations</span>
        <span className="text-xs tabular-nums text-white/50">
          {Math.round((pct / 100) * count)}/{count}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-white/30 mt-1.5 text-center">
        {pct < 100 ? `${pct}% complete — UI stays responsive` : "Processing results…"}
      </div>
    </div>
  );
}
