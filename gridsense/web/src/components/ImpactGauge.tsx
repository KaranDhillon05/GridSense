"use client";

import { motion, useReducedMotion } from "framer-motion";
import { tierColor } from "@/lib/ui";

export function ImpactGauge({
  score,
  tier,
}: {
  score: number;
  tier: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = tierColor(tier);
  const reduced = useReducedMotion();

  return (
    <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
      <svg width={140} height={140} className="-rotate-90">
        <circle cx={70} cy={70} r={r} fill="none" stroke="#f5f5f7" strokeWidth={12} />
        <motion.circle
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 15 }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold tracking-tight" style={{ color }}>
          {score.toFixed(0)}
        </div>
        <div className="text-xs text-[#6e6e73] -mt-1">/ 100</div>
        <div className="text-xs font-semibold mt-0.5" style={{ color }}>
          {tier}
        </div>
      </div>
    </div>
  );
}

export function FactorBars({
  contributions,
}: {
  contributions: Record<string, number>;
}) {
  const labels: Record<string, string> = {
    duration: "Clearance time",
    closure: "Road closure",
    cause: "Cause severity",
    location: "Location sensitivity",
    timing: "Peak timing",
  };
  const max = Math.max(0.1, ...Object.values(contributions));
  return (
    <div className="space-y-2.5">
      {Object.entries(contributions).map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 text-xs">
          <div className="w-28 text-[#6e6e73] shrink-0">{labels[k] ?? k}</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden bg-[#f5f5f7]">
            <div
              className="h-full rounded-full bg-[#0071e3]"
              style={{ width: `${(v / max) * 100}%` }}
            />
          </div>
          <div className="w-8 text-right tabular-nums text-[#1d1d1f]">{v.toFixed(0)}</div>
        </div>
      ))}
    </div>
  );
}
