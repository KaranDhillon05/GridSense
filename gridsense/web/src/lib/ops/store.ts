// GridSense 2.0 — shared operations store.
//
// A provider-less module singleton (the root layout is protected, so no React
// Context). Exposes a useSyncExternalStore-compatible (subscribe, getSnapshot)
// pair plus mutators. Readable by non-React code (the AI brain payload, the
// ticker). Persisted to localStorage so a demo survives reloads, but re-seeded
// when stale so it always opens "live".

import { seedOpsState } from "./seed";
import { rederive } from "./derive";
import type {
  OpsState,
  OpsIncident,
  Deployment,
  Task,
  OpsBrief,
  IncidentStatus,
  IncidentAssessment,
} from "./types";
import type { PlanSimResult } from "@/lib/sim/strategySimulator";
import type { TrafficPlanOutput, MapplsContext } from "@/lib/types";

const STORAGE_KEY = "gridsense_ops_state_v1";
const STALE_MS = 2 * 60 * 60 * 1000; // re-seed if older than 2h

let current: OpsState = seedOpsState();
let hydrated = false;
const listeners = new Set<() => void>();

export function getOpsState(): OpsState {
  return current;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ savedAt: Date.now(), state: current })
      );
    } catch {
      /* quota / disabled — best effort */
    }
  }, 400);
}

function commit() {
  rederive(current);
  current = { ...current, version: current.version + 1 };
  listeners.forEach((l) => l());
  schedulePersist();
}

/** The core primitive: mutate the draft in place, then commit (rederive + notify). */
export function mutate(fn: (s: OpsState) => void): void {
  fn(current);
  commit();
}

/** Allocate a unique sequential id with a prefix (does not commit). */
export function nextId(prefix: string): string {
  const id = `${prefix}-${current.seq}`;
  current.seq += 1;
  return id;
}

// --- Client hydration (call once, post-mount) ------------------------------

export function hydrateFromStorage(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { savedAt: number; state: OpsState };
    if (!parsed?.state || Date.now() - parsed.savedAt > STALE_MS) return;
    current = { ...parsed.state, version: current.version + 1 };
    rederive(current);
    listeners.forEach((l) => l());
  } catch {
    /* corrupt store — keep the fresh seed */
  }
}

/** Wipe persistence and re-seed (used by a "reset demo" control). */
export function resetOpsState(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  current = seedOpsState();
  commit();
}

// --- Named mutators --------------------------------------------------------

export function findIncident(id: string): OpsIncident | undefined {
  return current.incidents.find((i) => i.id === id);
}

export function updateIncidentStatus(id: string, status: IncidentStatus, note?: string): void {
  mutate((s) => {
    const inc = s.incidents.find((i) => i.id === id);
    if (!inc) return;
    inc.status = status;
    inc.timeline.push({ t: s.clockMs, label: note ?? `Status → ${status}` });
    if (status === "closed") inc.etaClearMin = 0;
  });
}

export function assignResource(resourceId: string, incidentId: string): void {
  mutate((s) => {
    const r = s.resources.find((x) => x.id === resourceId);
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (!r || !inc) return;
    r.status = "enroute";
    r.assignedIncidentId = incidentId;
    r.etaMin = Math.max(2, Math.round(4 + Math.random() * 6));
    if (!inc.assignedResourceIds.includes(resourceId)) inc.assignedResourceIds.push(resourceId);
    inc.timeline.push({ t: s.clockMs, label: `${r.label} dispatched` });
  });
}

export function addDeployment(dep: Deployment): void {
  mutate((s) => {
    s.deployments.push(dep);
    const inc = s.incidents.find((i) => i.id === dep.incidentId);
    if (inc && !inc.deploymentIds.includes(dep.id)) inc.deploymentIds.push(dep.id);
  });
}

export function upsertTask(task: Task): void {
  mutate((s) => {
    const idx = s.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) s.tasks[idx] = task;
    else {
      s.tasks.push(task);
      const inc = task.incidentId ? s.incidents.find((i) => i.id === task.incidentId) : undefined;
      if (inc && !inc.taskIds.includes(task.id)) inc.taskIds.push(task.id);
    }
  });
}

export function setTaskStatus(taskId: string, status: Task["status"]): void {
  mutate((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.status = status;
    if (status === "done") t.completedAt = s.clockMs;
  });
}

export function applyWindTunnelResult(incidentId: string, result: PlanSimResult): void {
  mutate((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (inc) inc.windTunnel = result;
  });
}

export function applyIncidentPlan(
  incidentId: string,
  plan: TrafficPlanOutput | null,
  context?: MapplsContext
): void {
  mutate((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (inc) {
      inc.incidentPlan = plan;
      inc.incidentPlanContext = context;
    }
  });
}

export function setIncidentAssessment(incidentId: string, a: IncidentAssessment): void {
  mutate((s) => {
    const inc = s.incidents.find((i) => i.id === incidentId);
    if (inc) inc.aiAssessment = a;
  });
}

export function setBrief(brief: OpsBrief): void {
  mutate((s) => {
    s.brief = brief;
  });
}

export function addIncident(inc: OpsIncident): void {
  mutate((s) => {
    s.incidents.unshift(inc);
  });
}
