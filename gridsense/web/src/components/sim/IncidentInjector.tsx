"use client";

import { useState } from "react";
import { INCIDENT_CATALOG, INCIDENT_TYPES } from "@/lib/sim/incidents";
import type { EdgePick } from "./SimMap";
import type { IncidentInput } from "@/lib/sim/engine";
import type { IncidentType, Severity } from "@/lib/sim/types";

const SEVERITIES: Severity[] = ["low", "moderate", "high", "severe"];

const CATEGORY_LABEL: Record<string, string> = {
  breakdown: "Breakdowns",
  accident: "Accidents",
  hazard: "Hazards",
  closure: "Closures",
  event: "Events & Gatherings",
  infra: "Infrastructure",
};

type LaneSide = "left" | "right" | "both";

export function IncidentInjector({
  pick,
  roadName,
  laneCount,
  onInject,
  onCancel,
}: {
  pick: EdgePick;
  roadName: string;
  laneCount: number;
  onInject: (input: IncidentInput) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<IncidentType>("multi_vehicle_accident");
  const spec = INCIDENT_CATALOG[type];
  const [severity, setSeverity] = useState<Severity>(spec.defaultSeverity);
  const [side, setSide] = useState<LaneSide>("right");
  const [lanes, setLanes] = useState<number>(Math.min(1, laneCount));
  const [full, setFull] = useState<boolean>(spec.closesRoad);

  const onType = (t: IncidentType) => {
    setType(t);
    const s = INCIDENT_CATALOG[t];
    setSeverity(s.defaultSeverity);
    setFull(s.closesRoad);
    setLanes(Math.min(Math.max(1, s.defaultLanes), Math.max(1, laneCount)));
  };

  const maxBlock = Math.max(1, laneCount);
  const singleLane = laneCount <= 1;

  const grouped = INCIDENT_TYPES.reduce<Record<string, IncidentType[]>>((acc, t) => {
    const cat = INCIDENT_CATALOG[t].category;
    (acc[cat] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="w-[340px] rounded-xl border border-white/12 bg-[#11151d]/95 backdrop-blur shadow-2xl p-4 text-white">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">Inject incident</div>
        <button onClick={onCancel} className="text-white/40 hover:text-white text-lg leading-none">
          ×
        </button>
      </div>
      <div className="text-[11px] text-white/50 mb-3">
        On <span className="text-white/80">{roadName}</span>
      </div>

      <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1">Type</label>
      <select
        value={type}
        onChange={(e) => onType(e.target.value as IncidentType)}
        className="w-full mb-3 rounded-lg bg-[#0b0e14] border border-white/12 px-2 py-1.5 text-sm"
      >
        {Object.entries(grouped).map(([cat, types]) => (
          <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>
            {types.map((t) => (
              <option key={t} value={t}>
                {INCIDENT_CATALOG[t].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1">Severity</label>
      <div className="flex gap-1 mb-3">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={`flex-1 py-1 rounded-md text-xs capitalize ${
              severity === s ? "bg-[#0071e3] text-white" : "bg-white/8 text-white/60 hover:bg-white/15"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1">
        Affected lane{singleLane ? "" : "s"} · {laneCount}-lane road
      </label>
      {singleLane ? (
        <div className="text-[11px] text-white/50 mb-3">Single-lane road — blockage stops this direction.</div>
      ) : (
        <>
          <div className="flex gap-1 mb-2">
            {([
              ["right", "Right (centre)"],
              ["left", "Left (kerb)"],
              ["both", "Both"],
            ] as [LaneSide, string][]).map(([s, label]) => (
              <button
                key={s}
                disabled={full}
                onClick={() => setSide(s)}
                className={`flex-1 py-1 rounded-md text-[11px] ${
                  side === s && !full ? "bg-[#0071e3] text-white" : "bg-white/8 text-white/60 hover:bg-white/15"
                } ${full ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="block text-[11px] text-white/40 mb-1">
            Lanes blocked: {full ? laneCount : Math.min(lanes, side === "both" ? maxBlock : maxBlock - 1)}
          </label>
          <input
            type="range"
            min={1}
            max={maxBlock}
            value={lanes}
            disabled={full}
            onChange={(e) => setLanes(Number(e.target.value))}
            className="w-full accent-[#0071e3] mb-2 disabled:opacity-40"
          />
        </>
      )}

      <label className="flex items-center gap-2 text-xs mb-4">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
        Full closure (all lanes blocked)
      </label>

      <button
        onClick={() =>
          onInject({
            type,
            edgeId: pick.edgeId,
            distOnEdge: pick.distOnEdge,
            severity,
            laneSide: side,
            lanesAffected: lanes,
            fullBlockage: full,
          })
        }
        className="w-full py-2 rounded-lg bg-[#ef4444] text-white text-sm font-semibold hover:brightness-110"
      >
        ⚠ Inject {spec.label}
      </button>
    </div>
  );
}
