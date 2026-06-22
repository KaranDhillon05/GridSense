"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { AttendanceBand, EventPlannerInput, EventType } from "@/lib/types";
import { prettyCause } from "@/lib/ui";
import { PillButton } from "@/components/ui/PillButton";

type Aggregates = {
  causes: string[];
  corridors: string[];
  zones: string[];
  veh_types: string[];
};

export type SampleScenario = { label: string; input: EventPlannerInput };

export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    label: "Cricket match · Chinnaswamy",
    input: {
      event_name: "Chinnaswamy Day Match",
      event_type: "sports_match",
      attendance_band: "between_10000_50000",
      expected_attendance: 28000,
      start_hour: 17,
      end_hour: 22,
      entry_gates: 5,
      parking_required: true,
      heavy_vehicle_restriction: true,
      public_transport_involved: true,
      roads_to_close: [
        { id: "chinnaswamy_main", name: "Chinnaswamy Main Approach" },
        { id: "mg_road_connector", name: "MG Road Connector" },
      ],
      cause: "public_event", corridor: "CBD 2", zone: "Central Zone 2",
      junction: "Chinnaswamy", priority: "High", requires_road_closure: true,
      is_planned: true, veh_type: "private_car", hour: 19, dow: 5,
      is_weekend: true, is_peak: true, affected_junctions: 3,
      lat: 12.9788, lon: 77.5996,
    },
  },
  {
    label: "Metro construction · ORR",
    input: {
      event_name: "ORR Metro Block Work",
      event_type: "construction_road_closure",
      attendance_band: "between_500_2000",
      expected_attendance: 1100,
      start_hour: 10,
      end_hour: 20,
      entry_gates: 2,
      parking_required: false,
      heavy_vehicle_restriction: true,
      public_transport_involved: false,
      roads_to_close: [{ id: "orr_work_zone", name: "ORR Work Zone Northbound" }],
      cause: "construction", corridor: "ORR East 1", zone: "East Zone 1",
      junction: "Marathahalli", priority: "High", requires_road_closure: true,
      is_planned: true, veh_type: "others", hour: 18, dow: 2,
      is_weekend: false, is_peak: true, affected_junctions: 2,
      lat: 12.9352, lon: 77.6245,
    },
  },
  {
    label: "Heavy-vehicle breakdown · Hosur Rd",
    input: {
      event_name: "Silk Board Breakdown",
      event_type: "public_gathering",
      attendance_band: "under_500",
      expected_attendance: 250,
      start_hour: 9,
      end_hour: 12,
      entry_gates: 1,
      parking_required: false,
      heavy_vehicle_restriction: false,
      public_transport_involved: false,
      roads_to_close: [],
      cause: "vehicle_breakdown", corridor: "Hosur Road", zone: "South Zone 2",
      junction: "Silk Board", priority: "High", requires_road_closure: false,
      is_planned: false, veh_type: "truck", hour: 9, dow: 1,
      is_weekend: false, is_peak: true, affected_junctions: 1,
      lat: 12.9166, lon: 77.6228,
    },
  },
  {
    label: "Waterlogging · Mysore Rd",
    input: {
      event_name: "Nayandahalli Rain Impact",
      event_type: "public_gathering",
      attendance_band: "between_500_2000",
      expected_attendance: 800,
      start_hour: 8,
      end_hour: 13,
      entry_gates: 2,
      parking_required: false,
      heavy_vehicle_restriction: false,
      public_transport_involved: true,
      roads_to_close: [],
      cause: "water_logging", corridor: "Mysore Road", zone: "West Zone 1",
      junction: "Nayandahalli", priority: "High", requires_road_closure: false,
      is_planned: false, veh_type: "others", hour: 8, dow: 3,
      is_weekend: false, is_peak: true, affected_junctions: 2,
      lat: 12.9417, lon: 77.5231,
    },
  },
];

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EVENT_TYPES: Array<{ value: EventType; label: string }> = [
  { value: "public_gathering", label: "Public gathering" },
  { value: "sports_match", label: "Sports match" },
  { value: "concert_festival", label: "Concert / festival" },
  { value: "political_rally", label: "Political rally" },
  { value: "religious_procession", label: "Religious procession" },
  { value: "marathon_road_race", label: "Marathon / road race" },
  { value: "vip_movement", label: "VIP movement" },
  { value: "construction_road_closure", label: "Construction / road closure" },
];

const ATTENDANCE_BANDS: Array<{ value: AttendanceBand; label: string; estimate: number }> = [
  { value: "under_500", label: "<500", estimate: 300 },
  { value: "between_500_2000", label: "500-2000", estimate: 1200 },
  { value: "between_2000_10000", label: "2000-10000", estimate: 6000 },
  { value: "between_10000_50000", label: "10000-50000", estimate: 25000 },
  { value: "above_50000", label: ">50000", estimate: 65000 },
];

const STEPS = ["Scenario", "Venue", "Scale & timing", "Review"];

const VenuePickerMap = dynamic(() => import("./VenuePickerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-caption text-[#6e6e73]">
      Loading map…
    </div>
  ),
});

export function EventPlannerForm({
  value,
  onChange,
  onSubmit,
  loading,
}: {
  value: EventPlannerInput;
  onChange: (v: EventPlannerInput) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const [step, setStep] = useState(0);
  const [agg, setAgg] = useState<Aggregates | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    fetch("/api/aggregates")
      .then((r) => r.json())
      .then((d: Aggregates) => setAgg(d));
  }, []);

  const set = <K extends keyof EventPlannerInput>(k: K, v: EventPlannerInput[K]) =>
    onChange({ ...value, [k]: v });

  const closureOptions = [
    value.corridor,
    ...(agg?.corridors ?? []).slice(0, 5),
    "Venue entry north",
    "Venue entry south",
  ].filter((v, idx, arr) => !!v && arr.indexOf(v) === idx);

  const toggleRoad = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const exists = value.roads_to_close.some((r) => r.id === id);
    const roads = exists
      ? value.roads_to_close.filter((r) => r.id !== id)
      : [...value.roads_to_close, { id, name }];
    set("roads_to_close", roads);
    set("requires_road_closure", roads.length > 0);
  };

  return (
    <div className="surface-panel p-6 space-y-6">
      <div>
        <h2 className="text-title-2 text-[#1d1d1f] text-xl">Plan an event</h2>
        <p className="text-caption text-[#6e6e73] mt-2">
          Forecast impact and build an operational playbook — one step at a time.
        </p>
      </div>

      {/* Step indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`text-center py-2.5 px-2 rounded-xl text-xs font-medium transition-colors ${
              i === step
                ? "bg-[#1d1d1f] text-white"
                : i < step
                  ? "bg-[#e8f4fd] text-[#0071e3]"
                  : "bg-[#f5f5f7] text-[#6e6e73]"
            }`}
          >
            <span className="block sm:inline">{i + 1}.</span>{" "}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reduced ? false : { opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? undefined : { opacity: 0, x: -20 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="space-y-4 min-h-[280px]"
        >
          {step === 0 && (
            <>
              <Field label="Quick scenario presets">
                <div className="grid grid-cols-1 gap-2">
                  {SAMPLE_SCENARIOS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => onChange(s.input)}
                      className="text-left text-sm surface-panel px-4 py-3 hover:bg-[#f5f5f7] transition-colors"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Event name">
                <input
                  value={value.event_name}
                  onChange={(e) => set("event_name", e.target.value)}
                  placeholder="e.g. Chinnaswamy evening match"
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Event type">
                  <select
                    value={value.event_type}
                    onChange={(e) => set("event_type", e.target.value as EventType)}
                    className={inputClass}
                  >
                    {EVENT_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Cause">
                  <Select value={value.cause} onChange={(v) => set("cause", v)}
                    options={agg?.causes ?? [value.cause]} render={prettyCause} />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <Field label="Venue location (click map to place pin)">
                <div className="h-48 rounded-2xl overflow-hidden border border-black/[0.06]">
                  <VenuePickerMap
                    lat={value.lat}
                    lon={value.lon}
                    onPick={(lat, lon) => onChange({ ...value, lat, lon })}
                  />
                </div>
                <p className="text-caption text-[#6e6e73] mt-2">
                  Selected: {value.lat?.toFixed(5) ?? "—"}, {value.lon?.toFixed(5) ?? "—"}
                </p>
              </Field>
              <Field label="Corridor">
                <Select value={value.corridor} onChange={(v) => set("corridor", v)}
                  options={agg?.corridors ?? [value.corridor]} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Zone">
                  <Select value={value.zone ?? "Unknown"} onChange={(v) => set("zone", v)}
                    options={["Unknown", ...(agg?.zones ?? [])]} />
                </Field>
                <Field label="Priority">
                  <Select value={value.priority} onChange={(v) => set("priority", v)}
                    options={["High", "Low"]} />
                </Field>
              </div>
              <Field label="Junction (optional)">
                <input
                  value={value.junction ?? ""}
                  onChange={(e) => set("junction", e.target.value)}
                  placeholder="e.g. Silk Board"
                  className={inputClass}
                />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expected attendance">
                  <select
                    value={value.attendance_band}
                    onChange={(e) => {
                      const band = e.target.value as AttendanceBand;
                      const estimate = ATTENDANCE_BANDS.find((x) => x.value === band)?.estimate ?? value.expected_attendance;
                      onChange({ ...value, attendance_band: band, expected_attendance: estimate });
                    }}
                    className={inputClass}
                  >
                    {ATTENDANCE_BANDS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Vehicle type">
                  <Select value={value.veh_type ?? "others"} onChange={(v) => set("veh_type", v)}
                    options={agg?.veh_types ?? [value.veh_type ?? "others"]} render={prettyCause} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Start hour">
                  <input type="number" min={0} max={23} value={value.start_hour}
                    onChange={(e) => set("start_hour", Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="End hour">
                  <input type="number" min={0} max={23} value={value.end_hour}
                    onChange={(e) => set("end_hour", Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Entry gates">
                  <input type="number" min={1} max={10} value={value.entry_gates}
                    onChange={(e) => set("entry_gates", Number(e.target.value))} className={inputClass} />
                </Field>
              </div>
              <Field label="Road segments to close">
                <div className="grid grid-cols-1 gap-1.5">
                  {closureOptions.map((option) => {
                    const active = value.roads_to_close.some((r) => r.name === option);
                    return (
                      <button
                        type="button"
                        key={option}
                        onClick={() => toggleRoad(option)}
                        className={`text-left text-sm rounded-xl px-3 py-2 transition-colors ${
                          active ? "bg-[#e8f4fd] text-[#0071e3]" : "bg-[#f5f5f7] text-[#424245] hover:bg-[#e8e8ed]"
                        }`}
                      >
                        {active ? "✓ " : ""}{option}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Check label="Parking required" on={value.parking_required} set={(v) => set("parking_required", v)} />
                <Check label="Public transport" on={value.public_transport_involved} set={(v) => set("public_transport_involved", v)} />
                <Check label="Heavy vehicle restriction" on={value.heavy_vehicle_restriction} set={(v) => set("heavy_vehicle_restriction", v)} />
                <Check label="Road closure" on={value.requires_road_closure} set={(v) => set("requires_road_closure", v)} />
                <Check label="Peak hour" on={value.is_peak} set={(v) => set("is_peak", v)} />
                <Check label="Planned" on={value.is_planned} set={(v) => set("is_planned", v)} />
              </div>
              <Field label={`Hour: ${value.hour}:00`}>
                <input type="range" min={0} max={23} value={value.hour}
                  onChange={(e) => set("hour", Number(e.target.value))} className="w-full accent-[#0071e3]" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Day">
                  <Select value={DOW[value.dow]} onChange={(v) => {
                    const idx = DOW.indexOf(v);
                    onChange({ ...value, dow: idx, is_weekend: idx >= 5 });
                  }} options={DOW} />
                </Field>
                <Field label={`Affected junctions: ${value.affected_junctions}`}>
                  <input type="range" min={1} max={6} value={value.affected_junctions}
                    onChange={(e) => set("affected_junctions", Number(e.target.value))} className="w-full accent-[#0071e3]" />
                </Field>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <ReviewRow label="Event" value={value.event_name || "—"} />
              <ReviewRow label="Type" value={EVENT_TYPES.find((t) => t.value === value.event_type)?.label ?? value.event_type} />
              <ReviewRow label="Cause" value={prettyCause(value.cause)} />
              <ReviewRow label="Corridor" value={value.corridor} />
              <ReviewRow label="Attendance" value={`~${value.expected_attendance.toLocaleString()}`} />
              <ReviewRow label="Hours" value={`${value.start_hour}:00 – ${value.end_hour}:00`} />
              <ReviewRow label="Road closures" value={value.roads_to_close.length ? value.roads_to_close.map((r) => r.name).join(", ") : "None"} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-3 pt-2">
        {step > 0 && (
          <PillButton variant="secondary" type="button" onClick={() => setStep((s) => s - 1)} className="flex-1">
            Back
          </PillButton>
        )}
        {step < STEPS.length - 1 ? (
          <PillButton type="button" onClick={() => setStep((s) => s + 1)} className="flex-1">
            Continue
          </PillButton>
        ) : (
          <PillButton type="button" onClick={onSubmit} disabled={loading} className="flex-1">
            {loading ? "Building playbook…" : "Forecast & build playbook"}
          </PillButton>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full text-sm rounded-xl px-3 py-2.5 bg-[#f5f5f7] border border-black/[0.06] text-[#1d1d1f] focus:outline focus:outline-2 focus:outline-[#0071e3] focus:outline-offset-0";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-caption text-[#6e6e73] mb-1.5 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function Select({
  value, onChange, options, render,
}: {
  value: string; onChange: (v: string) => void; options: string[]; render?: (v: string) => string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((o) => (
        <option key={o} value={o}>{render ? render(o) : o}</option>
      ))}
    </select>
  );
}

function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => set(!on)}
      className="flex items-center gap-2 text-sm text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3]"
      style={{ color: on ? "var(--text)" : "var(--muted)" }}>
      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] shrink-0 ${
        on ? "bg-[#0071e3] text-white" : "bg-[#f5f5f7] border border-black/[0.08]"
      }`}>
        {on ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-black/[0.04]">
      <span className="text-[#6e6e73]">{label}</span>
      <span className="font-medium text-[#1d1d1f] text-right">{value}</span>
    </div>
  );
}
