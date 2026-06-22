"use client";

import { useState } from "react";
import type { Advisory } from "@/lib/types";
import { Chip } from "./Badges";

export function DiversionAdvisoryCard({
  advisory,
  selectedRouteId,
  onSelectRoute,
}: {
  advisory: Advisory;
  selectedRouteId?: string;
  onSelectRoute?: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyAdvisory() {
    const text = [
      `Control style: ${advisory.control_style}`,
      `Impacted corridor: ${advisory.impacted_corridor}`,
      `Candidate alternates: ${advisory.candidate_alternates.join(", ")}`,
      `Control points: ${advisory.control_points.join(", ")}`,
      `Public note: ${advisory.public_note}`,
      advisory.route_options?.length
        ? `Route options: ${advisory.route_options
            .map((r) => `#${r.rank} ${r.id} (${r.distance_km}km, +${r.extra_travel_min}m)`)
            .join("; ")}`
        : "",
    ].join("\n");
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="surface-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs muted uppercase tracking-wide">Operational advisory</div>
        <button
          onClick={copyAdvisory}
          className="text-[11px] px-2 py-0.5 rounded-md"
          style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}
        >
          {copied ? "Copied ✓" : "Copy advisory"}
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <Line label="Control style" value={advisory.control_style} />
        <Line label="Impacted corridor" value={advisory.impacted_corridor} />
        <div>
          <div className="text-[11px] muted mb-1">Candidate alternate movement</div>
          <div className="flex flex-wrap gap-1">
            {advisory.candidate_alternates.map((a) => (
              <Chip key={a}>{a}</Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] muted mb-1">Control points</div>
          <div className="flex flex-wrap gap-1">
            {advisory.control_points.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        </div>
      </div>

      {advisory.route_options?.length ? (
        <div
          className="mt-3 pt-3 text-xs muted"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="mb-2">
            Diversion options · source: {advisory.routing_source ?? "unknown"}
            {advisory.fallback_reason ? ` · ${advisory.fallback_reason}` : ""}
          </div>
          <div className="space-y-2">
            {advisory.route_options.map((route) => {
              const selected =
                selectedRouteId != null
                  ? selectedRouteId === route.id
                  : advisory.selected_route_id === route.id;
              return (
                <button
                  key={route.id}
                  onClick={() => onSelectRoute?.(route.id)}
                  className="w-full text-left px-2 py-1.5 rounded-md"
                  style={{
                    border: "1px solid var(--border)",
                    background: selected ? "var(--panel-2)" : "transparent",
                  }}
                >
                  #{route.rank} {route.id} · {route.distance_km} km · +{route.extra_travel_min} min
                  <div className="text-[11px] muted mt-0.5">{route.advisory_note}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : advisory.route ? (
        <div
          className="mt-3 pt-3 text-xs muted"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          Candidate diversion corridor · {advisory.route.distance_km} km · +
          {advisory.route.extra_travel_min} min · {advisory.route.provider}
        </div>
      ) : null}

      <div
        className="mt-3 p-2.5 rounded-lg text-xs"
        style={{ background: "var(--panel-2)" }}
      >
        📢 {advisory.public_note}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px] muted">{label}: </span>
      <span>{value}</span>
    </div>
  );
}
