"use client";

import type { ForecastResponse } from "@/lib/types";
import { ImpactGauge, FactorBars } from "@/components/ImpactGauge";
import { fmtDuration } from "@/lib/ui";

export function ForecastSummaryCard({ forecast }: { forecast: ForecastResponse }) {
  return (
    <div className="surface-panel p-5">
      <div className="text-caption text-[#6e6e73] uppercase tracking-wide mb-4">Impact forecast</div>
      <div className="flex items-center gap-4">
        <ImpactGauge score={forecast.impact_score} tier={forecast.tier} />
        <div className="text-sm space-y-1.5">
          <Row label="Expected clearance" value={fmtDuration(forecast.expected_duration_min)} />
          {forecast.calibration && forecast.calibration.factor !== 1 && (
            <div className="text-[10px]" style={{ color: "var(--accent)" }} title="Adjusted by the post-event learning loop">
              ✓ calibrated ×{forecast.calibration.factor} from {fmtDuration(forecast.calibration.base)}
            </div>
          )}
          <Row label="Affected radius" value={`${forecast.affected_radius_m} m`} />
          <Row label="Tier" value={forecast.tier} />
        </div>
      </div>
      <div className="mt-4">
        <div className="text-[10px] muted uppercase tracking-wide mb-2">Why this score</div>
        <FactorBars contributions={forecast.contributions} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="muted text-xs">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
