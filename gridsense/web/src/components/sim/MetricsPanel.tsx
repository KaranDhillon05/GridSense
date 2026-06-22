"use client";

// Live KPIs + with/without-intervention comparison. The baseline comes from the
// headless "ghost" engine (same incidents, no response). Keeps a short rolling
// history for the delay chart.

import { useEffect, useRef, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Metrics } from "@/lib/sim/types";

interface Point {
  t: number;
  live: number;
  base: number;
}

export function MetricsPanel({
  live,
  baseline,
  interventionAt,
  hasIncident,
}: {
  live: Metrics | null;
  baseline: Metrics | null;
  interventionAt: number | null;
  hasIncident: boolean;
}) {
  const [history, setHistory] = useState<Point[]>([]);
  const lastT = useRef(0);

  useEffect(() => {
    if (!live || !baseline) return;
    if (live.simTime - lastT.current < 1.5) return;
    lastT.current = live.simTime;
    setHistory((h) => {
      const next = [...h, { t: Math.round(live.simTime), live: live.totalDelayVehMin, base: baseline.totalDelayVehMin }];
      return next.slice(-90);
    });
  }, [live, baseline]);

  if (!live) return null;

  const delayDelta = baseline ? baseline.totalDelayVehMin - live.totalDelayVehMin : 0;
  const delayPct = baseline && baseline.totalDelayVehMin > 0 ? (delayDelta / baseline.totalDelayVehMin) * 100 : 0;
  const speedDelta = baseline ? live.meanSpeedKmh - baseline.meanSpeedKmh : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-[#11151d]/90 p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm">Network metrics</div>
        {hasIncident && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60">
            vs no-intervention baseline
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <Kpi label="Mean speed" value={`${live.meanSpeedKmh.toFixed(0)} km/h`} delta={hasIncident ? speedDelta : undefined} unit="km/h" good="up" />
        <Kpi label="Total delay" value={`${live.totalDelayVehMin.toFixed(0)} veh·min`} delta={hasIncident ? -delayDelta : undefined} unit="" good="down" invert />
        <Kpi label="Veh-hours lost" value={live.vehicleHoursLost.toFixed(1)} />
        <Kpi label="Max queue" value={`${live.maxQueueM.toFixed(0)} m`} />
        <Kpi label="Throughput" value={`${live.throughputPerMin}/min`} />
        <Kpi label="Congested links" value={String(live.congestedEdges)} />
      </div>

      {hasIncident && baseline && (
        <div className="mb-3 rounded-lg bg-white/5 px-3 py-2">
          <div className="text-[11px] text-white/50 mb-0.5">Delay reduction from intervention</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${delayPct >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
              {delayPct >= 0 ? "−" : "+"}
              {Math.abs(delayPct).toFixed(0)}%
            </span>
            <span className="text-xs text-white/50">
              {delayDelta >= 0 ? "saved" : "worse by"} {Math.abs(delayDelta).toFixed(0)} veh·min
            </span>
          </div>
        </div>
      )}

      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: "#11151d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Line type="monotone" dataKey="base" name="No intervention" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="live" name="With intervention" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-white/50 mt-1 justify-center">
        <span className="flex items-center gap-1"><i className="inline-block w-3 h-0.5 bg-[#ef4444]" /> No intervention</span>
        <span className="flex items-center gap-1"><i className="inline-block w-3 h-0.5 bg-[#22c55e]" /> With intervention</span>
        {interventionAt != null && <span className="text-white/40">· applied @ {Math.round(interventionAt)}s</span>}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  good,
  invert,
}: {
  label: string;
  value: string;
  delta?: number;
  unit?: string;
  good?: "up" | "down";
  invert?: boolean;
}) {
  let deltaColor = "#9ca3af";
  if (delta != null && Math.abs(delta) > 0.5) {
    const positive = invert ? delta < 0 : delta > 0;
    const isGood = good === "up" ? positive : good === "down" ? !positive : positive;
    deltaColor = isGood ? "#22c55e" : "#ef4444";
  }
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-semibold text-sm tabular-nums">{value}</div>
      {delta != null && Math.abs(delta) > 0.5 && (
        <div className="text-[10px] tabular-nums" style={{ color: deltaColor }}>
          {delta > 0 ? "+" : ""}
          {delta.toFixed(0)}
        </div>
      )}
    </div>
  );
}
