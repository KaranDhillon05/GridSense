export const TIER_COLOR: Record<string, string> = {
  Severe: "#ef4444",
  High: "#f97316",
  Moderate: "#eab308",
  Low: "#22c55e",
};

export function tierColor(tier: string): string {
  return TIER_COLOR[tier] ?? "#22c55e";
}

export function prettyCause(c?: string | null): string {
  if (!c) return "—";
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function fmtDuration(min?: number | null): string {
  if (min == null) return "—";
  if (min < 90) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

export type ScoredEvent = {
  id: string;
  event_cause: string;
  latitude: number;
  longitude: number;
  address?: string;
  corridor?: string;
  zone?: string;
  junction?: string;
  priority?: string;
  requires_road_closure?: number | boolean;
  status?: string;
  impact_score?: number;
  tier?: string;
  predicted_duration_min?: number;
  is_planned?: number | boolean;
  start_datetime?: string;
};
