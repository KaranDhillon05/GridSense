"use client";

import { useEffect, useState } from "react";
import {
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { Section } from "@/components/ui/Section";
import { FadeIn, ScrollReveal } from "@/components/ui/motion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { prettyCause, fmtDuration } from "@/lib/ui";

type Win = {
  tier_accuracy: number;
  bucket_accuracy: number;
  within_50pct: number;
  mae_min: number;
  median_ae_min: number;
  bias_min: number;
};
type CauseRow = {
  event_cause: string;
  n: number;
  median_actual_min: number;
  median_pred_min: number;
  median_pred_cal_min: number;
  correction: number;
  bias: string;
  p10_actual_min: number;
  p90_actual_min: number;
  spread_ratio: number;
  reliability: "low" | "medium" | "high";
};
type Learning = {
  overall_before: Win;
  overall_after: Win;
  holdout_n: number;
  holdout_from: string;
  improvement: { tier_acc_delta: number; bucket_acc_delta: number; within_50pct_delta: number; mae_delta_min: number };
  by_cause: CauseRow[];
  top_corrected_segments: any[];
  drift: { month: string; n: number; bucket_acc_before: number; bucket_acc_after: number }[];
  scatter: { cause: string; actual: number; pred: number; cal: number }[];
  error_band: { p10_pct: number; p50_pct: number; p90_pct: number };
  samples: { cause: string; corridor: string; date: string; actual_min: number; predicted_min: number; corrected_min: number }[];
  methodology: string;
};

const RELI_COLOR = { high: "#22c55e", medium: "#eab308", low: "#ef4444" } as const;

export default function LearningPage() {
  const [d, setD] = useState<Learning | null>(null);
  useEffect(() => {
    fetch("/api/learning").then((r) => r.json()).then(setD);
  }, []);

  if (!d) {
    return (
      <div className="p-8 text-[#6e6e73]">Loading…</div>
    );
  }

  const b = d.overall_before;
  const a = d.overall_after;

  return (
    <div>
      <section className="section-spacing">
        <div className="content-width">
          <FadeIn>
            <p className="text-caption text-[#0071e3] uppercase tracking-widest mb-3">Learning loop</p>
            <h1 className="text-title-1 text-[#1d1d1f] max-w-3xl">
              A self-correcting forecast.
            </h1>
            <p className="text-body text-[#6e6e73] mt-4 max-w-3xl">
              After every event closes, GridSense compares predicted clearance against actual
              outcomes, learns a correction, and feeds it back into live forecasts — validated
              out-of-sample on the later 30% of resolved events.
            </p>
          </FadeIn>
        </div>
      </section>

      <Section title="Out-of-sample improvement" subtitle={`Validated on ${d.holdout_n.toLocaleString()} events after ${d.holdout_from}`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <DeltaCard label="Impact-tier accuracy" before={pctText(b.tier_accuracy)} after={pctText(a.tier_accuracy)} delta={d.improvement.tier_acc_delta} unit="pts" primary />
          <DeltaCard label="Duration-class accuracy" before={pctText(b.bucket_accuracy)} after={pctText(a.bucket_accuracy)} delta={d.improvement.bucket_acc_delta} unit="pts" />
          <DeltaCard label="Within ±50%" before={pctText(b.within_50pct)} after={pctText(a.within_50pct)} delta={d.improvement.within_50pct_delta} unit="pts" />
          <DeltaCard label="Mean abs. error" before={`${b.mae_min} min`} after={`${a.mae_min} min`} delta={d.improvement.mae_delta_min} unit="min" lowerBetter />
        </div>
      </Section>

      <Section className="bg-[#f5f5f7]" title="Calibration" subtitle="Each dot is a resolved event. Points on the diagonal are perfect forecasts.">
        <GlassPanel padding={false} className="p-6">
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid stroke="#f5f5f7" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" scale="log" domain={[5, 100000]}
                tick={{ fill: "#6e6e73", fontSize: 11 }} tickFormatter={fmtTick}
                label={{ value: "Actual (min)", position: "insideBottom", offset: -2, fill: "#6e6e73", fontSize: 11 }} />
              <YAxis type="number" dataKey="y" scale="log" domain={[5, 100000]}
                tick={{ fill: "#6e6e73", fontSize: 11 }} tickFormatter={fmtTick}
                label={{ value: "Forecast (min)", angle: -90, position: "insideLeft", fill: "#6e6e73", fontSize: 11 }} />
              <ZAxis range={[18, 18]} />
              <ReferenceLine segment={[{ x: 5, y: 5 }, { x: 100000, y: 100000 }]} stroke="#d2d2d7" strokeDasharray="5 5" ifOverflow="extendDomain" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Scatter name="Base model" data={d.scatter.map((p) => ({ x: p.actual, y: p.pred }))} fill="#aeaeb2" fillOpacity={0.5} isAnimationActive={false} />
              <Scatter name="Calibrated" data={d.scatter.map((p) => ({ x: p.actual, y: p.cal }))} fill="#0071e3" fillOpacity={0.7} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </GlassPanel>
      </Section>

      <Section title="Stability over time" subtitle="Duration-class accuracy by month — the correction holds across periods.">
        <GlassPanel padding={false} className="p-6">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={d.drift} margin={{ left: 4, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f7" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#6e6e73", fontSize: 11 }} />
              <YAxis tick={{ fill: "#6e6e73", fontSize: 11 }} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="bucket_acc_before" name="Base" stroke="#aeaeb2" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="bucket_acc_after" name="Calibrated" stroke="#0071e3" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>
      </Section>

      <Section className="bg-[#f5f5f7]" title="Per-cause calibration" subtitle="Expand each cause for full statistics and confidence levels.">
        <div className="space-y-3">
          {d.by_cause.map((r) => (
            <ExpandableCard
              key={r.event_cause}
              title={prettyCause(r.event_cause)}
              subtitle={`${r.n} events · median actual ${fmtDuration(r.median_actual_min)}`}
              badge={
                <span className="text-xs px-3 py-1 rounded-full font-medium" style={{ color: RELI_COLOR[r.reliability], background: `${RELI_COLOR[r.reliability]}18` }}>
                  {r.reliability}
                </span>
              }
              expandedContent={
                <div className="space-y-2 pt-2 text-sm">
                  <p>Base → Calibrated: {fmtDuration(r.median_pred_min)} → {fmtDuration(r.median_pred_cal_min)}</p>
                  <p>Correction: {r.correction === 1 ? "—" : `×${r.correction}`}</p>
                  <p>Typical range (P10–P90): {fmtDuration(r.p10_actual_min)} – {fmtDuration(r.p90_actual_min)}</p>
                </div>
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Honest uncertainty" subtitle="The planner shows ranges rather than false precision.">
        <GlassPanel>
          <p className="text-body text-[#424245]">
            Across all resolved events, the calibrated estimate lands between{" "}
            <span className="text-[#0071e3] font-medium">{d.error_band.p10_pct}%</span> and{" "}
            <span className="text-[#0071e3] font-medium">+{d.error_band.p90_pct}%</span> of actual time for 80% of events.
          </p>
        </GlassPanel>
      </Section>

      <Section className="bg-[#f5f5f7]" title="After-action review" subtitle="Largest misses and what the loop learned.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.samples.slice(0, 6).map((s, i) => (
            <ScrollReveal key={i}>
              <GlassPanel className="text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-[#1d1d1f]">{prettyCause(s.cause)} · {s.corridor}</span>
                  <span className="text-caption text-[#6e6e73]">{s.date}</span>
                </div>
                <p className="text-[#6e6e73]">
                  Predicted <span className="text-[#1d1d1f]">{fmtDuration(s.predicted_min)}</span>, actual{" "}
                  <span className="text-[#ef4444]">{fmtDuration(s.actual_min)}</span> — now{" "}
                  <span className="text-[#0071e3]">{fmtDuration(s.corrected_min)}</span>.
                </p>
              </GlassPanel>
            </ScrollReveal>
          ))}
        </div>
      </Section>

      <div className="content-width pb-16 text-caption text-[#6e6e73] border-t border-black/[0.06] pt-8">
        <span className="uppercase tracking-wide">Methodology · </span>{d.methodology}
      </div>
    </div>
  );
}

function DeltaCard({ label, before, after, delta, unit, primary, lowerBetter }: {
  label: string; before: string; after: string; delta: number; unit: string; primary?: boolean; lowerBetter?: boolean;
}) {
  const improved = lowerBetter ? delta > 0 : delta > 0;
  const sign = delta > 0 ? "+" : "";
  return (
    <GlassPanel className={primary ? "ring-2 ring-[#0071e3] ring-offset-2" : ""}>
      <div className="text-caption text-[#6e6e73] uppercase tracking-wide">{label}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-sm text-[#aeaeb2] line-through">{before}</span>
        <span className={`text-3xl font-bold tracking-tight ${primary ? "text-[#0071e3]" : "text-[#1d1d1f]"}`}>{after}</span>
      </div>
      <div className="text-caption mt-1" style={{ color: improved ? "#22c55e" : "#6e6e73" }}>
        {improved ? "▲" : ""} {sign}{lowerBetter ? Math.abs(delta) : delta} {unit} {lowerBetter ? "lower" : "better"}
      </div>
    </GlassPanel>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel px-3 py-2 text-xs shadow-elevated">
      {label && <div className="text-[#6e6e73] mb-1">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="text-[#1d1d1f]">{p.name}: {typeof p.value === "number" ? Math.round(p.value) : p.value}</div>
      ))}
    </div>
  );
}

const pctText = (x: number) => `${Math.round(x * 1000) / 10}%`;
function fmtTick(v: number) {
  if (v >= 1440) return `${Math.round(v / 1440)}d`;
  if (v >= 60) return `${Math.round(v / 60)}h`;
  return `${v}m`;
}
