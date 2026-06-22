"use client";

import { FadeIn } from "@/components/ui/motion";
import type { ResourceRecommendation } from "@/lib/nightwatch/types";

const RESOURCE_ICONS: Record<string, string> = {
  tow_truck: "🚚",
  officer: "👮",
  ambulance: "🚑",
  fire_engine: "🚒",
  recovery_van: "🔧",
  barricade: "🚧",
  maintenance_crew: "⚙️",
};

export function ResourcePositioningCard({
  recommendations,
}: {
  recommendations: ResourceRecommendation[];
}) {
  return (
    <FadeIn delay={0.2}>
      <div className="rounded-2xl border border-white/10 bg-[#11151d]/90 p-5">
        <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">
          Recommended Resource Pre-Positioning
        </div>
        <p className="text-[11px] text-white/30 mb-4">
          Moving these resources closer to high-risk corridors before incidents occur.
        </p>

        <div className="space-y-2.5">
          {recommendations.map((r, i) => (
            <div key={i} className="rounded-xl bg-white/5 px-3 py-3">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{RESOURCE_ICONS[r.resourceType] ?? "📍"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{r.label}</span>
                    <span className="text-[10px] font-bold text-[#22c55e] shrink-0">
                      +{r.expectedImprovementPct}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px]">
                    <span className="text-white/40 truncate">{r.currentLocation}</span>
                    <span className="text-white/20 shrink-0">→</span>
                    <span className="text-[#60a5fa] font-medium truncate">{r.recommendedLocation}</span>
                  </div>
                  <div className="text-[10px] text-white/30 mt-1 truncate">{r.reason}</div>
                </div>
              </div>
            </div>
          ))}

          {!recommendations.length && (
            <div className="text-center text-white/30 text-xs py-4">
              No repositioning needed — resources are optimally located.
            </div>
          )}
        </div>
      </div>
    </FadeIn>
  );
}
