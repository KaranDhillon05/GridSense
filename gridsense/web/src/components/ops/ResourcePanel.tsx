"use client";

import { useMemo } from "react";
import type { OpsResource, OpsResourceStatus } from "@/lib/ops/types";

const STATUS_COLOR: Record<OpsResourceStatus, string> = {
  available: "#22c55e",
  enroute: "#f59e0b",
  onscene: "#0071e3",
  returning: "#a1a1a6",
};

export function ResourcePanel({ resources }: { resources: OpsResource[] }) {
  const groups = useMemo(() => {
    const by: Record<string, OpsResource[]> = {};
    for (const r of resources) (by[r.type] ??= []).push(r);
    return Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]));
  }, [resources]);

  return (
    <div className="space-y-2">
      {groups.map(([type, list]) => {
        const avail = list.filter((r) => r.status === "available").length;
        return (
          <div key={type} className="flex items-center justify-between text-xs">
            <span className="text-[#424245]">{list[0].label}</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold tabular-nums text-[#1d1d1f]">
                {avail}/{list.length}
              </span>
              <span className="flex gap-0.5">
                {list.map((r) => (
                  <span
                    key={r.id}
                    title={`${r.id} · ${r.status}`}
                    className="w-2 h-2 rounded-full"
                    style={{ background: STATUS_COLOR[r.status] }}
                  />
                ))}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
