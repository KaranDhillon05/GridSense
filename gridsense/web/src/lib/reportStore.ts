import type { RecommendResponse, EventPlannerInput } from "@/lib/types";

export const REPORT_STORAGE_KEY = "gridsense_report_payload";

export type ReportPayload = {
  result: RecommendResponse;
  input: EventPlannerInput;
};

export function saveReportPayload(payload: ReportPayload) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(payload));
}

export function loadReportPayload(): ReportPayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(REPORT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReportPayload) : null;
  } catch {
    return null;
  }
}
