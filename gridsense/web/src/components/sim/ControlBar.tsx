"use client";

import type { SimControls } from "@/hooks/useSimulation";
import type { Metrics } from "@/lib/sim/types";

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SPEEDS = [1, 2, 4, 8];

export function ControlBar({
  controls,
  metrics,
  debug,
  showEdges,
  onRunning,
  onSpeed,
  onSpawn,
  onReset,
  onToggleDebug,
  onToggleEdges,
  onTestRoute,
}: {
  controls: SimControls;
  metrics: Metrics | null;
  debug: boolean;
  showEdges: boolean;
  onRunning: (r: boolean) => void;
  onSpeed: (s: number) => void;
  onSpawn: (n: number) => void;
  onReset: () => void;
  onToggleDebug: () => void;
  onToggleEdges: () => void;
  onTestRoute?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-xl border border-white/10 bg-[#11151d]/90 backdrop-blur">
      <button
        onClick={() => onRunning(!controls.running)}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#22c55e] text-black hover:brightness-110 min-w-[72px]"
      >
        {controls.running ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button
        onClick={onReset}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20"
      >
        ↺ Reset
      </button>
      <button
        onClick={onToggleEdges}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
          !showEdges ? "bg-[#f59e0b] text-black" : "bg-white/10 text-white hover:bg-white/20"
        }`}
        title="Toggle road overlay visibility"
      >
        {showEdges ? "◉ Roads" : "○ Roads"}
      </button>
      <button
        onClick={onTestRoute}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20"
        title="Test connectivity between two junctions"
      >
        ⟷ Test Route
      </button>
      <button
        onClick={onToggleDebug}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
          debug ? "bg-[#e879f9] text-black" : "bg-white/10 text-white hover:bg-white/20"
        }`}
        title="Show junctions, turn connectors, repaired (synthetic) edges"
      >
        ◈ Debug
      </button>

      <div className="flex items-center gap-1 ml-1">
        <span className="text-[11px] text-white/50 mr-1">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={`px-2 py-1 rounded-md text-xs font-medium ${
              controls.speed === s ? "bg-[#0071e3] text-white" : "bg-white/8 text-white/60 hover:bg-white/15"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 ml-1">
        <span className="text-[11px] text-white/50">Demand</span>
        <input
          type="range"
          min={20}
          max={160}
          step={5}
          value={controls.spawnPerMin}
          onChange={(e) => onSpawn(Number(e.target.value))}
          className="w-28 accent-[#0071e3]"
        />
        <span className="text-xs text-white/70 tabular-nums w-16">{controls.spawnPerMin}/min</span>
      </div>

      <div className="ml-auto flex items-center gap-4 text-xs">
        <Stat label="Clock" value={metrics ? fmtClock(metrics.simTime) : "00:00"} />
        <Stat label="Vehicles" value={metrics ? String(metrics.activeVehicles) : "0"} />
        <Stat
          label="Mean speed"
          value={metrics ? `${metrics.meanSpeedKmh.toFixed(0)} km/h` : "–"}
          color={metrics && metrics.meanSpeedKmh < 8 ? "#ef4444" : "#22c55e"}
        />
        {metrics?.gridlock && (
          <span className="px-2 py-1 rounded-md bg-[#ef4444] text-white font-bold animate-pulse">GRIDLOCK</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="leading-tight text-right">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-semibold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
    </div>
  );
}
