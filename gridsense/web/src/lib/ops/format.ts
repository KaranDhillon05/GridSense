import type { Severity } from "@/lib/sim/types";
import type { IncidentStatus } from "./types";

export const SEVERITY_COLOR: Record<Severity, string> = {
  severe: "#ef4444",
  high: "#f97316",
  moderate: "#eab308",
  low: "#22c55e",
};

export const ESCALATION_COLOR: Record<"low" | "medium" | "high" | "critical", string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  detected: "Detected",
  verified: "Verified",
  responding: "Responding",
  managed: "Managed",
  clearing: "Clearing",
  closed: "Closed",
};

/** Format an ops-clock value (ms-of-day or epoch ms) as HH:MM. */
export function formatClock(ms: number): string {
  const totalMin = Math.floor((((ms % 86400000) + 86400000) % 86400000) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function severityColor(s: Severity): string {
  return SEVERITY_COLOR[s];
}
