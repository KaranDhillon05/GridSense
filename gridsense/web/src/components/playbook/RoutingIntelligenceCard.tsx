"use client";

import type { TrafficPlanOutput, TrafficRoute } from "@/lib/types";

// Surfaces the map-intelligence engine's reasoning: the AI ops brief, the
// algorithm used, and the structured "why" behind each approach / diversion /
// emergency corridor / barricade. Only renders for the network engine.
export function RoutingIntelligenceCard({ plan }: { plan: TrafficPlanOutput }) {
  if (plan.plan_source !== "network") return null;
  const r = plan.routes;
  const inbound = [...r.primary_inbound, ...r.secondary_inbound];
  const outbound = [...r.primary_outbound, ...r.secondary_outbound];
  const hardClosures = plan.barricade_points.filter((b) => b.type === "hard");

  return (
    <div className="surface-panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs muted uppercase tracking-wide">Routing intelligence</div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--panel-2)", color: "var(--accent)", border: "1px solid var(--border)" }}
        >
          ✨ map-derived
        </span>
      </div>

      {plan.ops_brief && <p className="text-sm leading-relaxed">{plan.ops_brief}</p>}

      <ApproachGroup title="Inbound approaches" routes={inbound} />
      <ApproachGroup title="Dispersal corridors" routes={outbound} />

      {r.through_diversion.length > 0 && (
        <Section title="Through-diversion">
          {r.through_diversion.map((d) => (
            <Why key={d.id} text={d.reasoning?.summary} />
          ))}
        </Section>
      )}

      {r.emergency_access[0]?.reasoning && (
        <Section title="Emergency access">
          <Why text={r.emergency_access[0].reasoning?.summary} accent="#22c55e" />
        </Section>
      )}

      {hardClosures.length > 0 && (
        <Section title={`Barricades — ${hardClosures.length} hard closure${hardClosures.length > 1 ? "s" : ""}`}>
          {hardClosures.slice(0, 3).map((b) => (
            <Why key={b.id} text={b.reasoning?.summary ?? b.label} />
          ))}
        </Section>
      )}

      {plan.methodology && (
        <div className="text-[10px] muted pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="uppercase tracking-wide">Method:</span> {plan.methodology}
        </div>
      )}
    </div>
  );
}

function ApproachGroup({ title, routes }: { title: string; routes: TrafficRoute[] }) {
  if (!routes.length) return null;
  return (
    <Section title={title}>
      {routes.map((rt) => {
        const road = rt.reasoning?.summary?.match(/via ([^;]+);/)?.[1] ?? rt.signage[0]?.location ?? rt.id;
        return (
          <div key={rt.id} className="text-xs flex items-start justify-between gap-2">
            <span className="truncate">
              <span className="font-medium">{road}</span>
              {rt.reasoning?.summary ? ` — ${rt.reasoning.summary.replace(/^[^—]*—\s*/, "")}` : ""}
            </span>
            <span
              className="shrink-0 tabular-nums"
              style={{ color: rt.utilization > 1 ? "#ef4444" : rt.utilization > 0.85 ? "#f97316" : "var(--muted)" }}
            >
              {Math.round(rt.utilization * 100)}%
            </span>
          </div>
        );
      })}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="text-[10px] muted uppercase tracking-wide mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Why({ text, accent }: { text?: string; accent?: string }) {
  if (!text) return null;
  return (
    <div className="text-xs leading-snug" style={accent ? { color: accent } : undefined}>
      {text}
    </div>
  );
}
