// Event Operations Center store. Planned events (matches, concerts, rallies, VIP
// movements) live in their own lightweight module store; when an event's plan is
// generated it is STAGED as an incident in the main ops store so it flows into
// the live operating picture. Several venues sit inside the CBD twin so the Wind
// Tunnel is available for them.

import type { EventType, AttendanceBand } from "@/lib/types";

export type EventStatus = "scheduled" | "planned" | "active" | "closed";

export interface OpsEvent {
  id: string;
  name: string;
  type: EventType;
  cause: string; // ASTraM cause used for scoring/precedent
  venue: string;
  corridor: string;
  lat: number;
  lon: number;
  startsInMin: number; // relative to ops clock (for "starts in" display)
  attendance: number;
  attendanceBand: AttendanceBand;
  requiresClosure: boolean;
  status: EventStatus;
  linkedIncidentId?: string;
}

function bandFor(n: number): AttendanceBand {
  if (n >= 50000) return "above_50000";
  if (n >= 10000) return "between_10000_50000";
  if (n >= 2000) return "between_2000_10000";
  if (n >= 500) return "between_500_2000";
  return "under_500";
}

function seedEvents(): OpsEvent[] {
  const raw: Omit<OpsEvent, "attendanceBand" | "status">[] = [
    { id: "EVT-1", name: "RCB vs CSK — IPL", type: "sports_match", cause: "public_event", venue: "Chinnaswamy Stadium", corridor: "CBD 1", lat: 12.9789, lon: 77.5996, startsInMin: 180, attendance: 40000, requiresClosure: false },
    { id: "EVT-2", name: "Open-air Concert", type: "concert_festival", cause: "public_event", venue: "Palace Grounds", corridor: "Palace Road", lat: 12.9989, lon: 77.5926, startsInMin: 320, attendance: 25000, requiresClosure: false },
    { id: "EVT-3", name: "Political Rally", type: "political_rally", cause: "public_event", venue: "Freedom Park", corridor: "Seshadri Road", lat: 12.9756, lon: 77.5862, startsInMin: 90, attendance: 15000, requiresClosure: true },
    { id: "EVT-4", name: "City Marathon", type: "marathon_road_race", cause: "public_event", venue: "MG Road", corridor: "MG Road", lat: 12.9756, lon: 77.6068, startsInMin: 600, attendance: 8000, requiresClosure: true },
    { id: "EVT-5", name: "VIP Movement", type: "vip_movement", cause: "vip_movement", venue: "Vidhana Soudha", corridor: "Ambedkar Veedhi", lat: 12.9794, lon: 77.5912, startsInMin: 45, attendance: 500, requiresClosure: true },
  ];
  return raw.map((e) => ({ ...e, attendanceBand: bandFor(e.attendance), status: "scheduled" as EventStatus }));
}

let events: OpsEvent[] = seedEvents();
const listeners = new Set<() => void>();
let version = 0;
let snapshot = { version, events };

export function getEventsSnapshot() {
  return snapshot;
}
export function subscribeEvents(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function commit() {
  version += 1;
  snapshot = { version, events: [...events] };
  listeners.forEach((l) => l());
}

export function findEvent(id: string): OpsEvent | undefined {
  return events.find((e) => e.id === id);
}

export function markEventPlanned(id: string, incidentId: string): void {
  events = events.map((e) =>
    e.id === id ? { ...e, status: "planned", linkedIncidentId: incidentId } : e
  );
  commit();
}

export function setEventStatus(id: string, status: EventStatus): void {
  events = events.map((e) => (e.id === id ? { ...e, status } : e));
  commit();
}
