"use client";

export type SimCount = 100 | 500 | 1000;

export function RunControls({
  count,
  onCount,
  onRun,
  running,
  disabled,
}: {
  count: SimCount;
  onCount: (n: SimCount) => void;
  onRun: () => void;
  running: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
        <span className="font-semibold text-sm text-white">Simulation Batch</span>
      </div>
      <p className="text-[12px] text-white/50 mb-4 leading-relaxed">
        Run headless Monte Carlo scenarios using historical incident patterns. Each run compares
        the network with and without intervention.
      </p>

      <div className="flex gap-2 mb-4">
        {([100, 500, 1000] as SimCount[]).map((n) => (
          <button
            key={n}
            onClick={() => onCount(n)}
            disabled={running}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
              count === n
                ? "bg-[#0071e3] text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            } disabled:opacity-40`}
          >
            {n.toLocaleString()}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-white/40 mb-3 text-center">
        {count} simulations &times; 2 scenarios (baseline + response) ≈{" "}
        {count === 100 ? "~5s" : count === 500 ? "~25s" : "~60s"}
      </div>

      <button
        onClick={onRun}
        disabled={running || disabled}
        className="w-full py-3 rounded-xl bg-[#0071e3] text-white font-semibold text-sm
          hover:bg-[#005bbf] active:bg-[#004fa3] transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {running ? "Running simulations…" : "Run Night Watch"}
      </button>
    </div>
  );
}
