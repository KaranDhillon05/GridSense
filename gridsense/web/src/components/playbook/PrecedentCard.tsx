"use client";

import { useEffect, useState } from "react";
import type { EventPlannerInput } from "@/lib/types";
import type { PrecedentSummary } from "@/lib/precedent";
import { fmtDuration, prettyCause, tierColor } from "@/lib/ui";

// "We've handled this before." Retrieves genuinely similar past events and shows
// their REAL outcomes — an empirical clearance band that grounds the model forecast.
export function PrecedentCard({ input }: { input: EventPlannerInput }) {
  const [data, setData] = useState<PrecedentSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/precedents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
      .then((r) => r.json())
      .then((d: PrecedentSummary) => {
        if (active) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [input]);

  if (!data || data.n === 0) {
    return (
      <div className="surface-panel p-5">
        <div className="text-xs muted uppercase tracking-wide mb-2">Historical precedent</div>
        <div className="text-sm muted">
          {loading ? "Finding similar past events…" : "No comparable past events found."}
        </div>
      </div>
    );
  }

  return (
    <div className="surface-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs muted uppercase tracking-wide">Historical precedent</div>
        <div className="text-[10px] muted">
          {data.same_cause_n}/{data.n} same cause
        </div>
      </div>

      <div className="text-sm mb-3">
        <span className="font-semibold">{data.n}</span> similar past{" "}
        {prettyCause(input.cause).toLowerCase()} events on record. Their{" "}
        <span className="font-medium">actual</span> clearance:
      </div>

      {/* Empirical clearance band (P50 → P90 from real outcomes). */}
      <div className="rounded p-3 mb-3" style={{ background: "var(--panel-2)" }}>
        <div className="flex items-end gap-4">
          <Stat label="Median" value={fmtDuration(data.median_clearance_min)} big />
          <Stat label="P90 (worst case)" value={fmtDuration(data.p90_clearance_min)} />
          <Stat label="Closure rate" value={`${Math.round(data.closure_rate * 100)}%`} />
        </div>
        {data.forecast_within_band != null && (
          <div className="text-[11px] mt-2" style={{ color: data.forecast_within_band ? "#22c55e" : "#f97316" }}>
            {data.forecast_within_band
              ? "✓ Model forecast sits within the historical spread."
              : "⚠ Model forecast is outside the typical historical spread — review."}
          </div>
        )}
      </div>

      {/* Severity mix among analogs. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(data.tier_mix)
          .sort((a, b) => b[1] - a[1])
          .map(([tier, count]) => (
            <span
              key={tier}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--panel-2)", color: tierColor(tier), border: `1px solid ${tierColor(tier)}33` }}
            >
              {count} {tier}
            </span>
          ))}
      </div>

      {/* Representative analogs. */}
      <div className="text-[10px] muted uppercase tracking-wide mb-1.5">Closest analogs</div>
      <div className="space-y-1">
        {data.matches.map((m) => (
          <div key={m.id} className="flex items-center justify-between text-xs">
            <span className="truncate">
              <span className="muted">{m.start_date ?? "—"}</span> · {m.corridor}
              {m.requires_road_closure ? " · closure" : ""}
            </span>
            <span className="font-medium shrink-0 ml-2">{fmtDuration(m.actual_duration_min)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className={big ? "text-lg font-semibold leading-none" : "text-sm font-medium leading-none"}>{value}</div>
      <div className="text-[10px] muted mt-1">{label}</div>
    </div>
  );
}
