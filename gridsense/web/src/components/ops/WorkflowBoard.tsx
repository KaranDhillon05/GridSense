"use client";

import { useMemo } from "react";
import Link from "next/link";
import { setTaskStatus } from "@/lib/ops/store";
import type { TaskView } from "@/lib/ops/workflow";
import type { TaskStatus } from "@/lib/ops/types";

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: "todo", label: "To do", accent: "#ef4444" },
  { status: "in_progress", label: "In progress", accent: "#0071e3" },
  { status: "blocked", label: "Blocked", accent: "#f59e0b" },
  { status: "done", label: "Completed", accent: "#22c55e" },
];

const NEXT: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: "in_progress",
  in_progress: "done",
  blocked: "in_progress",
};

function TaskCard({ t }: { t: TaskView }) {
  const next = NEXT[t.status];
  return (
    <div
      className={`rounded-xl border bg-white p-3 ${
        t.slaBreached ? "border-[#fecaca]" : "border-black/[0.08]"
      }`}
    >
      <div className="text-sm font-medium text-[#1d1d1f] leading-snug">{t.title}</div>
      {t.incidentTitle && (
        <Link
          href={`/incidents/${t.incidentId}`}
          className="text-[11px] text-[#0071e3] hover:underline mt-1 inline-block"
        >
          {t.incidentId} · {t.incidentTitle}
        </Link>
      )}
      <div className="flex items-center justify-between mt-2 text-[10px]">
        <span className="text-[#a1a1a6]">
          {t.ageMin}m old{t.sourceRecommendation ? ` · ${t.sourceRecommendation}` : ""}
        </span>
        {t.slaBreached && (
          <span className="text-[#b91c1c] font-semibold">SLA breach</span>
        )}
      </div>
      {next && (
        <button
          type="button"
          onClick={() => setTaskStatus(t.id, next)}
          className="mt-2 w-full text-[11px] font-medium text-[#0071e3] hover:bg-[#f5f5f7] rounded-lg py-1 transition-colors"
        >
          → Mark {next === "done" ? "completed" : next.replace("_", " ")}
        </button>
      )}
    </div>
  );
}

export function WorkflowBoard({ tasks }: { tasks: TaskView[] }) {
  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskView[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of tasks) map[t.status].push(t);
    // newest first within a column
    for (const k of Object.keys(map) as TaskStatus[]) map[k].sort((a, b) => b.createdAt - a.createdAt);
    return map;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {COLUMNS.map((col) => (
        <div key={col.status}>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="w-2 h-2 rounded-full" style={{ background: col.accent }} />
            <span className="text-sm font-semibold text-[#1d1d1f]">{col.label}</span>
            <span className="text-[11px] text-[#a1a1a6] tabular-nums">
              {byStatus[col.status].length}
            </span>
          </div>
          <div className="space-y-2">
            {byStatus[col.status].map((t) => (
              <TaskCard key={t.id} t={t} />
            ))}
            {byStatus[col.status].length === 0 && (
              <div className="text-[11px] text-[#c7c7cc] px-1 py-3 text-center border border-dashed border-black/[0.06] rounded-xl">
                —
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
