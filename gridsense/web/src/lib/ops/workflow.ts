// Workflow analytics over the ops store's tasks. Tasks are produced when a Wind
// Tunnel plan is accepted and when incidents are seeded; this rolls them up into
// completion / SLA / throughput metrics for the Workflow Engine.

import type { OpsState, Task, TaskStatus } from "./types";

// SLA budget (ops-minutes) before an open task is "breached", by current status.
const SLA_MIN: Record<TaskStatus, number> = {
  todo: 15,
  in_progress: 40,
  blocked: 10,
  done: Infinity,
};

export interface TaskView extends Task {
  ageMin: number;
  slaBreached: boolean;
  incidentTitle?: string;
}

export interface WorkflowMetrics {
  total: number;
  open: number;
  completed: number;
  completionPct: number;
  slaBreaches: number;
  blocked: number;
  bySource: { source: string; n: number }[];
}

export function buildTaskViews(state: OpsState): TaskView[] {
  return state.tasks.map((t) => {
    const ageMin = (state.clockMs - t.createdAt) / 60000;
    const incident = t.incidentId
      ? state.incidents.find((i) => i.id === t.incidentId)
      : undefined;
    return {
      ...t,
      ageMin: Math.max(0, Math.round(ageMin)),
      slaBreached: t.status !== "done" && ageMin > SLA_MIN[t.status],
      incidentTitle: incident?.title,
    };
  });
}

export function workflowMetrics(views: TaskView[]): WorkflowMetrics {
  const total = views.length;
  const completed = views.filter((t) => t.status === "done").length;
  const open = total - completed;
  const slaBreaches = views.filter((t) => t.slaBreached).length;
  const blocked = views.filter((t) => t.status === "blocked").length;

  const sourceMap = new Map<string, number>();
  for (const t of views) {
    const key = t.sourceRecommendation ? "Wind Tunnel" : t.incidentId ? "Incident response" : "Manual";
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
  }

  return {
    total,
    open,
    completed,
    completionPct: total ? Math.round((completed / total) * 100) : 0,
    slaBreaches,
    blocked,
    bySource: [...sourceMap.entries()].map(([source, n]) => ({ source, n })),
  };
}
