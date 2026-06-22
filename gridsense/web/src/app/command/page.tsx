"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { MapView } from "@/components/MapView";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import {
  prettyCause,
  fmtDuration,
  tierColor,
  type ScoredEvent,
} from "@/lib/ui";

type Hotspot = {
  lat: number;
  lon: number;
  count: number;
  closure_rate: number;
  high_priority_rate: number;
};

type DriftRow = {
  month: string;
  n: number;
  bucket_acc_before: number;
  bucket_acc_after: number;
  median_ae_before: number;
  median_ae_after: number;
};

type ReplaySample = {
  cause: string;
  corridor: string;
  date: string;
  actual_min: number;
  predicted_min: number;
  corrected_min: number;
};

type ByCauseRow = {
  event_cause: string;
  n: number;
  median_actual_min: number;
  median_pred_min: number;
  median_pred_cal_min: number;
  bias: string;
  reliability: string;
};

type ReplayData = {
  date: string;
  events: ScoredEvent[];
  samples: ReplaySample[];
  monthDrift: DriftRow | null;
  byCause: ByCauseRow[];
};

// All 152 real dataset dates (ASTraM, Nov 2023 – Apr 2024)
const DATASET_DATES = [
  "2023-11-09","2023-11-10","2023-11-11","2023-11-12","2023-11-13","2023-11-14","2023-11-15","2023-11-16","2023-11-17","2023-11-18","2023-11-19","2023-11-20","2023-11-21","2023-11-22","2023-11-23","2023-11-24","2023-11-25","2023-11-26","2023-11-27","2023-11-28","2023-11-29","2023-11-30",
  "2023-12-01","2023-12-02","2023-12-03","2023-12-04","2023-12-05","2023-12-06","2023-12-07","2023-12-08","2023-12-09","2023-12-10","2023-12-11","2023-12-12","2023-12-13","2023-12-14","2023-12-15","2023-12-16","2023-12-17","2023-12-18","2023-12-19","2023-12-20","2023-12-21","2023-12-22","2023-12-23","2023-12-24","2023-12-25","2023-12-26","2023-12-27","2023-12-28","2023-12-29","2023-12-30","2023-12-31",
  "2024-01-01","2024-01-02","2024-01-03","2024-01-04","2024-01-05","2024-01-06","2024-01-07","2024-01-08","2024-01-09","2024-01-10","2024-01-11","2024-01-12","2024-01-13","2024-01-14","2024-01-15","2024-01-16","2024-01-17","2024-01-18","2024-01-19","2024-01-20","2024-01-21","2024-01-22","2024-01-23","2024-01-24","2024-01-25","2024-01-26","2024-01-27","2024-01-28","2024-01-29","2024-01-30","2024-01-31",
  "2024-02-01","2024-02-02","2024-02-03","2024-02-04","2024-02-05","2024-02-06","2024-02-07","2024-02-08","2024-02-09","2024-02-10","2024-02-11","2024-02-12","2024-02-13","2024-02-14","2024-02-15","2024-02-16","2024-02-17","2024-02-18","2024-02-19","2024-02-20","2024-02-21","2024-02-22","2024-02-23","2024-02-24","2024-02-25","2024-02-26","2024-02-27","2024-02-28","2024-02-29",
  "2024-03-01","2024-03-02","2024-03-03","2024-03-04","2024-03-05","2024-03-06","2024-03-07","2024-03-08","2024-03-09","2024-03-10","2024-03-11","2024-03-12","2024-03-13","2024-03-14","2024-03-15","2024-03-16","2024-03-17","2024-03-18","2024-03-19","2024-03-20","2024-03-21","2024-03-22","2024-03-23","2024-03-24","2024-03-25","2024-03-26","2024-03-27","2024-03-28","2024-03-29","2024-03-30","2024-03-31",
  "2024-04-01","2024-04-02","2024-04-03","2024-04-04","2024-04-05","2024-04-06","2024-04-07","2024-04-08",
];

// Event counts per date from ASTraM CSV (for sparkline)
const DATE_COUNTS = [11,46,43,33,43,51,54,57,36,45,47,48,47,58,30,25,30,32,56,78,54,60,52,67,47,28,43,50,59,74,37,45,36,53,51,59,126,126,53,69,72,46,65,48,52,40,45,64,49,66,57,60,35,36,38,58,51,44,45,47,35,57,48,32,60,53,53,53,111,52,47,47,41,29,39,51,62,76,17,24,30,36,44,52,46,49,45,43,53,35,40,65,38,50,34,30,73,51,52,50,53,41,42,47,54,65,38,44,51,28,51,56,37,36,45,35,38,50,58,250,66,75,44,73,50,69,58,67,46,51,34,52,43,51,38,42,44,41,124,45,69,134,79,51,41,61,124,53,110,141,82,16];

const MAX_COUNT = 250;

export default function CommandCenter() {
  const [events, setEvents] = useState<ScoredEvent[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  // Replay state
  const [replayMode, setReplayMode] = useState(false);
  const [replayIdx, setReplayIdx] = useState(0);
  const replayDate = DATASET_DATES[replayIdx];
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setPanelOpen(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    fetch("/api/events?limit=2500")
      .then((r) => r.json())
      .then(setEvents);
    fetch("/api/hotspots?limit=350")
      .then((r) => r.json())
      .then(setHotspots);
  }, []);

  // Fetch replay data when date changes
  useEffect(() => {
    if (!replayMode) return;
    setReplayLoading(true);
    fetch(`/api/replay?date=${replayDate}`)
      .then((r) => r.json())
      .then((d) => {
        setReplayData(d);
        setReplayLoading(false);
      });
  }, [replayMode, replayDate]);

  const shown = useMemo(() => {
    if (replayMode && replayData) return replayData.events;
    return onlyActive ? events.filter((e) => e.status === "active") : events;
  }, [events, onlyActive, replayMode, replayData]);

  const kpis = useMemo(() => {
    if (replayMode && replayData) {
      const evs = replayData.events;
      const severe = evs.filter((e) => e.tier === "Severe" || e.tier === "High").length;
      const closures = evs.filter((e) => e.requires_road_closure).length;
      const corridors = new Set(evs.map((e) => e.corridor).filter(Boolean));
      return { active: evs.length, severe, closures, corridors: corridors.size };
    }
    const active = events.filter((e) => e.status === "active");
    const severe = active.filter(
      (e) => e.tier === "Severe" || e.tier === "High"
    ).length;
    const closures = active.filter((e) => e.requires_road_closure).length;
    const corridors = new Set(active.map((e) => e.corridor).filter(Boolean));
    return { active: active.length, severe, closures, corridors: corridors.size };
  }, [events, replayMode, replayData]);

  const ranked = useMemo(() => {
    if (replayMode && replayData)
      return [...replayData.events]
        .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
        .slice(0, 12);
    return [...events.filter((e) => e.status === "active")]
      .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
      .slice(0, 12);
  }, [events, replayMode, replayData]);

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setReplayIdx(Number(e.target.value));
    },
    []
  );

  return (
    <div className="page-full relative overflow-hidden bg-[#f5f5f7]">
      <div className="absolute inset-0">
        <MapView
          events={shown}
          hotspots={hotspots}
          showHeatmap={showHeatmap && !replayMode}
          selectedId={selected}
        />
      </div>

      {/* KPI strip */}
      <div className="absolute top-3 left-3 right-3 lg:right-auto z-[1000] flex flex-wrap gap-2 max-w-[calc(100vw-1.5rem)] lg:max-w-[640px]">
        <KpiCompact
          label={replayMode ? "Events" : "Active"}
          value={kpis.active}
        />
        <KpiCompact label="High-impact" value={kpis.severe} color="var(--high)" />
        <KpiCompact label="Closures" value={kpis.closures} color="var(--severe)" />
        <KpiCompact label="Corridors" value={kpis.corridors} />
        {replayMode && (
          <div className="surface-panel-map px-3 py-2">
            <div className="text-[11px] font-semibold text-[#0071e3]">
              REPLAY
            </div>
            <div className="text-[10px] text-[#6e6e73] mt-0.5">
              {replayDate}
            </div>
          </div>
        )}
      </div>

      {/* Controls — bottom left */}
      <div className="absolute bottom-4 left-3 z-[1000] flex flex-col gap-2 items-start">
        <button
          type="button"
          onClick={() => setControlsOpen((v) => !v)}
          className="surface-panel-map px-4 py-2 text-sm font-medium text-[#1d1d1f]"
        >
          {controlsOpen ? "Hide controls" : "Map controls"}
        </button>
        {controlsOpen && (
          <div className="surface-panel-map p-4 flex flex-col gap-3 text-sm w-[220px]">
            {!replayMode && (
              <>
                <Toggle on={showHeatmap} set={setShowHeatmap} label="Risk heatmap" />
                <Toggle on={onlyActive} set={setOnlyActive} label="Active only" />
              </>
            )}
            <Toggle
              on={replayMode}
              set={(v) => {
                setReplayMode(v);
                if (v) setPanelOpen(true);
              }}
              label="Historical replay"
            />
            {!replayMode && <Legend />}
          </div>
        )}
      </div>

      {/* Replay timeline — bottom centre */}
      {replayMode && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] surface-panel-map px-5 py-3 w-[min(600px,calc(100vw-4rem))]">
          <div className="flex items-center justify-between text-[10px] text-[#6e6e73] mb-2">
            <span className="uppercase tracking-wide font-medium">Nov 2023</span>
            <div className="text-center">
              <span className="text-[#0071e3] font-semibold text-[12px]">{replayDate}</span>
              <span className="text-[#6e6e73] ml-2 text-[10px]">
                {DATE_COUNTS[replayIdx]} events
              </span>
            </div>
            <span className="uppercase tracking-wide font-medium">Apr 2024</span>
          </div>
          {/* Sparkline */}
          <svg viewBox={`0 0 ${DATASET_DATES.length} 20`} className="w-full h-5 mb-1" preserveAspectRatio="none">
            {DATE_COUNTS.map((c, i) => {
              const h = (c / MAX_COUNT) * 18;
              const isActive = i === replayIdx;
              return (
                <rect
                  key={i}
                  x={i}
                  y={20 - h}
                  width={0.85}
                  height={h}
                  fill={isActive ? "#0071e3" : c > 100 ? "#f97316" : "#d1d1d6"}
                  opacity={isActive ? 1 : 0.7}
                />
              );
            })}
          </svg>
          <input
            type="range"
            min={0}
            max={DATASET_DATES.length - 1}
            step={1}
            value={replayIdx}
            onChange={handleSlider}
            className="w-full accent-[#0071e3] h-1.5 rounded-full cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-[#a1a1a6] mt-1">
            {["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"].map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        </div>
      )}

      {/* Event panel toggle */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute bottom-20 right-3 z-[1001] lg:hidden surface-panel-map px-4 py-2 text-sm font-medium text-[#1d1d1f]"
      >
        {panelOpen ? "Hide events" : `Events (${ranked.length})`}
      </button>

      {/* Event list / Replay validation panel */}
      <aside
        className={`absolute top-3 bottom-3 z-[999] w-[min(380px,calc(100vw-1.5rem))] transition-transform duration-300 right-3 ${
          panelOpen
            ? "translate-x-0"
            : "translate-x-[calc(100%+0.75rem)] lg:translate-x-0"
        }`}
      >
        <div className="surface-panel-map h-full flex flex-col overflow-hidden">
          {replayMode ? (
            <ReplayPanel
              data={replayData}
              loading={replayLoading}
              date={replayDate}
              ranked={ranked}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <>
              <div className="p-4 border-b border-black/[0.06] shrink-0">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-[#1d1d1f] text-lg">Deploy now</h2>
                  <span className="text-xs text-[#6e6e73] shrink-0">live feed</span>
                </div>
                <p className="text-xs text-[#6e6e73] mt-1">
                  Ranked by forecast impact. Select to locate on the map.
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {ranked.map((e) => (
                  <ExpandableCard
                    key={e.id}
                    selected={selected === e.id}
                    onSelect={() => setSelected(e.id)}
                    title={prettyCause(e.event_cause)}
                    subtitle={`${e.corridor} · ${e.zone ?? "—"}`}
                    badge={
                      <span
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
                        style={{
                          color: tierColor(e.tier ?? "Low"),
                          background: `${tierColor(e.tier ?? "Low")}18`,
                        }}
                      >
                        {e.tier} · {e.impact_score}
                      </span>
                    }
                    expandedContent={
                      <div className="space-y-1.5">
                        <p>
                          Clears ~{fmtDuration(e.predicted_duration_min)}
                          {e.requires_road_closure ? " · closure" : ""}
                          {e.priority === "High" ? " · high priority" : ""}
                        </p>
                        {e.junction && <p>Junction: {e.junction}</p>}
                      </div>
                    }
                  />
                ))}
                {ranked.length === 0 && (
                  <div className="text-[#6e6e73] text-sm p-4">Loading live events…</div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function ReplayPanel({
  data,
  loading,
  date,
  ranked,
  selected,
  onSelect,
}: {
  data: ReplayData | null;
  loading: boolean;
  date: string;
  ranked: ScoredEvent[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<"events" | "validation">("events");

  return (
    <>
      {/* Header */}
      <div className="p-4 border-b border-black/[0.06] shrink-0">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold text-[#1d1d1f] text-lg">Historical Replay</h2>
          <span className="text-[11px] font-semibold text-[#0071e3] bg-[#0071e308] px-2 py-0.5 rounded-full">
            {date}
          </span>
        </div>
        <p className="text-xs text-[#6e6e73] mt-1">
          ASTraM dataset · drag timeline to explore
        </p>
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {(["events", "validation"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="px-3 py-1 text-xs font-medium rounded-full transition-colors"
              style={{
                background: tab === t ? "#0071e3" : "#e8e8ed",
                color: tab === t ? "#fff" : "#424245",
              }}
            >
              {t === "events" ? "Events" : "Validation"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[#6e6e73] text-sm">
          Loading…
        </div>
      ) : tab === "events" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {ranked.length === 0 ? (
            <div className="text-[#6e6e73] text-sm p-4 text-center">
              No events recorded on {date}
            </div>
          ) : (
            ranked.map((e) => (
              <ExpandableCard
                key={e.id}
                selected={selected === e.id}
                onSelect={() => onSelect(e.id)}
                title={prettyCause(e.event_cause)}
                subtitle={`${e.corridor ?? "—"} · ${e.zone ?? "—"}`}
                badge={
                  <span
                    className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      color: tierColor(e.tier ?? "Low"),
                      background: `${tierColor(e.tier ?? "Low")}18`,
                    }}
                  >
                    {e.tier} · {e.impact_score}
                  </span>
                }
                expandedContent={
                  <div className="space-y-1.5 text-xs text-[#424245]">
                    <p>Forecast: {fmtDuration(e.predicted_duration_min)}</p>
                    {e.requires_road_closure ? <p>Road closure required</p> : null}
                    {e.junction && <p>Junction: {e.junction}</p>}
                  </div>
                }
              />
            ))
          )}
        </div>
      ) : (
        <ValidationTab data={data} date={date} />
      )}
    </>
  );
}

function ValidationTab({ data, date }: { data: ReplayData | null; date: string }) {
  if (!data) return null;
  const { monthDrift, samples, byCause } = data;
  const month = date.slice(0, 7);
  const monthLabel = new Date(month + "-01").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Month accuracy card */}
      {monthDrift ? (
        <section>
          <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2">
            {monthLabel} · Model Accuracy
          </div>
          <div className="grid grid-cols-2 gap-2">
            <AccuracyCell
              label="Bucket acc (before)"
              value={`${monthDrift.bucket_acc_before}%`}
            />
            <AccuracyCell
              label="Bucket acc (after)"
              value={`${monthDrift.bucket_acc_after}%`}
              highlight={monthDrift.bucket_acc_after >= monthDrift.bucket_acc_before}
            />
            <AccuracyCell
              label="Median error (before)"
              value={`${monthDrift.median_ae_before} min`}
            />
            <AccuracyCell
              label="Median error (after)"
              value={`${monthDrift.median_ae_after} min`}
              highlight={monthDrift.median_ae_after <= monthDrift.median_ae_before}
            />
          </div>
          <p className="text-[10px] text-[#6e6e73] mt-2">
            {monthDrift.n} events evaluated · learning loop{" "}
            {monthDrift.bucket_acc_after >= monthDrift.bucket_acc_before
              ? "improved"
              : "degraded"}{" "}
            accuracy this month
          </p>
        </section>
      ) : (
        <div className="text-xs text-[#6e6e73]">No drift data for {month}</div>
      )}

      {/* Samples from this date */}
      {samples.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2">
            Ground-truth samples · {date}
          </div>
          <div className="space-y-2">
            {samples.map((s, i) => (
              <SampleRow key={i} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* By-cause breakdown for this day's event types */}
      {byCause.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2">
            Cause-level forecast accuracy
          </div>
          <div className="space-y-2">
            {byCause.map((c) => (
              <CauseRow key={c.event_cause} c={c} />
            ))}
          </div>
        </section>
      )}

      {samples.length === 0 && byCause.length === 0 && (
        <div className="text-xs text-[#6e6e73] text-center py-4">
          No ground-truth samples available for this date.
          <br />
          Scrub to another day or check the Validation tab on a day with events.
        </div>
      )}

      {/* Drift sparkline */}
      <DriftChart currentMonth={month} />
    </div>
  );
}

function AccuracyCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-1"
      style={{ background: highlight ? "#0071e308" : "#f5f5f7" }}
    >
      <div
        className="text-sm font-bold tabular-nums"
        style={{ color: highlight ? "#0071e3" : "#1d1d1f" }}
      >
        {value}
      </div>
      <div className="text-[10px] text-[#6e6e73] leading-tight">{label}</div>
      {highlight && (
        <div className="text-[9px] text-[#0071e3] font-medium">↑ improved</div>
      )}
    </div>
  );
}

function SampleRow({ s }: { s: ReplaySample }) {
  const errBefore = Math.abs(s.actual_min - s.predicted_min);
  const errAfter = Math.abs(s.actual_min - s.corrected_min);
  const improved = errAfter < errBefore;
  return (
    <div className="bg-[#f5f5f7] rounded-xl p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[#1d1d1f]">
          {prettyCause(s.cause)}
        </span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: improved ? "#22c55e18" : "#ef444418",
            color: improved ? "#16a34a" : "#dc2626",
          }}
        >
          {improved ? "✓ improved" : "↓ degraded"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px] text-[#6e6e73]">
        <div>
          <div className="font-medium text-[#1d1d1f]">
            {fmtDuration(s.actual_min)}
          </div>
          <div>Actual</div>
        </div>
        <div>
          <div className="font-medium text-[#1d1d1f]">
            {fmtDuration(s.predicted_min)}
          </div>
          <div>Predicted</div>
        </div>
        <div>
          <div
            className="font-medium"
            style={{ color: improved ? "#0071e3" : "#1d1d1f" }}
          >
            {fmtDuration(s.corrected_min)}
          </div>
          <div>Corrected</div>
        </div>
      </div>
      {s.corridor !== "Non-corridor" && (
        <div className="text-[10px] text-[#6e6e73]">{s.corridor}</div>
      )}
    </div>
  );
}

function CauseRow({ c }: { c: ByCauseRow }) {
  const errorPct =
    c.median_actual_min > 0
      ? Math.round(
          (Math.abs(c.median_pred_cal_min - c.median_actual_min) /
            c.median_actual_min) *
            100
        )
      : 0;
  const reliabilityColor =
    c.reliability === "high"
      ? "#22c55e"
      : c.reliability === "medium"
      ? "#eab308"
      : "#f97316";
  return (
    <div className="flex items-center gap-3 py-2 border-b border-black/[0.04] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[#1d1d1f] truncate">
          {prettyCause(c.event_cause)}
        </div>
        <div className="text-[10px] text-[#6e6e73] mt-0.5">
          Actual {fmtDuration(c.median_actual_min)} · Forecast{" "}
          {fmtDuration(c.median_pred_cal_min)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-semibold text-[#1d1d1f]">{errorPct}% err</div>
        <div
          className="text-[10px] font-medium"
          style={{ color: reliabilityColor }}
        >
          {c.reliability}
        </div>
      </div>
    </div>
  );
}

// Simple inline drift sparkline using SVG bars
function DriftChart({ currentMonth }: { currentMonth: string }) {
  const DRIFT = [
    { month: "2023-11", acc: 62.7, label: "N" },
    { month: "2023-12", acc: 64.2, label: "D" },
    { month: "2024-01", acc: 56.9, label: "J" },
    { month: "2024-02", acc: 56.8, label: "F" },
    { month: "2024-03", acc: 53.0, label: "M" },
    { month: "2024-04", acc: 49.1, label: "A" },
  ];
  const max = 70;
  const h = 48;
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-2">
        Forecast accuracy by month
      </div>
      <div className="bg-[#f5f5f7] rounded-xl p-3">
        <svg viewBox={`0 0 ${DRIFT.length * 40} ${h + 20}`} className="w-full">
          {DRIFT.map((d, i) => {
            const barH = (d.acc / max) * h;
            const isActive = d.month === currentMonth;
            return (
              <g key={d.month} transform={`translate(${i * 40 + 4}, 0)`}>
                <rect
                  x={0}
                  y={h - barH}
                  width={32}
                  height={barH}
                  rx={4}
                  fill={isActive ? "#0071e3" : "#d1d1d6"}
                />
                <text
                  x={16}
                  y={h + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isActive ? "#0071e3" : "#6e6e73"}
                  fontWeight={isActive ? "bold" : "normal"}
                >
                  {d.label}
                </text>
                <text
                  x={16}
                  y={h - barH - 3}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isActive ? "#0071e3" : "#a1a1a6"}
                >
                  {d.acc}%
                </text>
              </g>
            );
          })}
        </svg>
        <p className="text-[10px] text-[#6e6e73] mt-1">
          Bucket accuracy after learning loop correction
        </p>
      </div>
    </section>
  );
}

function KpiCompact({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="surface-panel-map px-3 py-2 min-w-[88px]">
      <div
        className="text-xl font-bold tabular-nums leading-none"
        style={{ color: color ?? "#1d1d1f" }}
      >
        {value}
      </div>
      <div className="text-[10px] font-medium text-[#6e6e73] mt-1 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}

function Toggle({
  on,
  set,
  label,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => set(!on)}
      className="flex items-center gap-3 w-full text-left rounded-lg"
      style={{ color: on ? "#1d1d1f" : "#6e6e73" }}
    >
      <span
        className="w-10 h-6 rounded-full relative transition-colors shrink-0"
        style={{ background: on ? "#0071e3" : "#e8e8ed" }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all"
          style={{ left: on ? 18 : 2 }}
        />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

function Legend() {
  const tiers = ["Severe", "High", "Moderate", "Low"];
  return (
    <div className="pt-2 border-t border-black/[0.06]">
      <div className="text-[10px] text-[#6e6e73] mb-2 uppercase tracking-wide font-medium">
        Impact tier
      </div>
      <div className="flex flex-col gap-1.5">
        {tiers.map((t) => (
          <div key={t} className="flex items-center gap-2 text-sm text-[#424245]">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: tierColor(t) }}
            />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}
