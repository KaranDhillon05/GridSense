// Operations Intelligence (Learning 3.0) — the "Best Known Response" library.
//
// Reads the counterfactual playbook memory (decisions GridSense simulated + their
// MEASURED outcomes) and rolls it up into per-incident-type evidence: which
// response works, how much delay it cut, across how many proven cases. This is
// learning about DECISIONS, complementing the technical forecast calibration on
// /learning.

import { loadMemory, type MemoryEntry } from "@/lib/playbookMemory";
import { prettyCause } from "@/lib/ui";

export interface BestResponse {
  incidentType: string;
  label: string;
  n: number;
  avgReductionPct: number;
  totalVehHoursSaved: number;
  avgVsAlternativePct: number;
  bestPlan: string;
  topCorridor: string;
}

function planFromLabel(label: string): string | null {
  const seg = label.split(" · ").find((s) => /^Plan [A-D]$/.test(s.trim()));
  return seg ? seg.trim() : null;
}

function mode(items: string[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
}

export function buildBestResponses(): { library: BestResponse[]; recent: MemoryEntry[]; total: number } {
  const memory = loadMemory();
  const byType = new Map<string, MemoryEntry[]>();
  for (const e of memory) {
    const key = e.context.incidentType || e.context.cause || "other";
    (byType.get(key) ?? byType.set(key, []).get(key)!).push(e);
  }

  const library: BestResponse[] = [...byType.entries()]
    .map(([type, entries]) => {
      const n = entries.length;
      const avgReduction = Math.round(entries.reduce((s, e) => s + e.outcome.reductionPct, 0) / n);
      const totalSaved = Math.round(entries.reduce((s, e) => s + (e.outcome.vehHoursSaved || 0), 0));
      const vsAltVals = entries.filter((e) => e.outcome.bestVsAlternativePct != null);
      const avgVsAlt = vsAltVals.length
        ? Math.round(vsAltVals.reduce((s, e) => s + (e.outcome.bestVsAlternativePct || 0), 0) / vsAltVals.length)
        : 0;
      const plans = entries.map((e) => planFromLabel(e.label)).filter(Boolean) as string[];
      const corridors = entries.map((e) => e.context.corridor).filter(Boolean);
      return {
        incidentType: type,
        label: prettyCause(type),
        n,
        avgReductionPct: avgReduction,
        totalVehHoursSaved: totalSaved,
        avgVsAlternativePct: avgVsAlt,
        bestPlan: plans.length ? mode(plans) : "Recommended plan",
        topCorridor: corridors.length ? mode(corridors) : "—",
      };
    })
    .sort((a, b) => b.n - a.n || b.avgReductionPct - a.avgReductionPct);

  const recent = [...memory].sort((a, b) => b.ts - a.ts).slice(0, 8);
  return { library, recent, total: memory.length };
}
