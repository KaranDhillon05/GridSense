// Counterfactual Playbook Memory — the operational learning loop.
//
// Every time GridSense simulates a decision (on the Plan page or in the
// Replay-and-Prove backtester) it logs the situation, the decision, and the
// MEASURED outcome here. Recommendations can then cite evidence —
// "across N similar simulated incidents, this response cut delay by ~X%" —
// instead of an unbacked heuristic. This is learning about DECISIONS, not
// retraining a predictor: the simulator manufactures the outcome labels that
// real incident logs never record.
//
// Storage is the browser's localStorage so the memory accumulates across the
// session/demo and is fully self-contained (no backend write path needed).

export interface MemoryContext {
  cause: string;
  corridor: string;
  tier: string;
  closure: boolean;
  incidentType: string;
  lat?: number;
  lon?: number;
}

export interface MemoryOutcome {
  baselineVehHours: number;
  recommendedVehHours: number;
  vehHoursSaved: number;
  reductionPct: number;
  bestVsAlternativePct?: number;
  clearanceMin?: number | null;
}

export interface MemoryEntry {
  id: string;
  ts: number;
  source: "plan" | "backtest";
  label: string;
  context: MemoryContext;
  outcome: MemoryOutcome;
}

export interface MemoryEvidence {
  n: number;
  avgReductionPct: number;
  medianReductionPct: number;
  totalVehHoursSaved: number;
  avgVsAlternativePct: number;
  samples: MemoryEntry[];
}

const KEY = "gridsense_playbook_memory_v1";
const CAP = 300;

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function loadMemory(): MemoryEntry[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(list: MemoryEntry[]) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP)));
  } catch {
    /* quota / disabled storage — memory is best-effort */
  }
}

export function logOutcome(entry: Omit<MemoryEntry, "id" | "ts">): MemoryEntry {
  const full: MemoryEntry = {
    ...entry,
    id: `${entry.source}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    ts: Date.now(),
  };
  const list = loadMemory();
  list.push(full);
  persist(list);
  return full;
}

/** Bulk insert (backtester writes many outcomes at once). */
export function logOutcomes(entries: Array<Omit<MemoryEntry, "id" | "ts">>): void {
  if (!entries.length) return;
  const list = loadMemory();
  const now = Date.now();
  entries.forEach((e, i) => {
    list.push({ ...e, id: `${e.source}_${now}_${i}`, ts: now + i });
  });
  persist(list);
}

export function clearMemory(): void {
  if (hasStorage()) window.localStorage.removeItem(KEY);
}

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Similarity score; entries scoring 0 (different cause AND type) are excluded. */
function similarity(ctx: MemoryContext, e: MemoryEntry): number {
  let s = 0;
  if (e.context.incidentType === ctx.incidentType) s += 3;
  if (e.context.cause === ctx.cause) s += 2;
  if (s === 0) return 0; // require at least same cause or same incident type
  if (e.context.corridor === ctx.corridor) s += 2;
  if (e.context.closure === ctx.closure) s += 1;
  if (e.context.tier === ctx.tier) s += 1;
  if (
    ctx.lat != null &&
    ctx.lon != null &&
    e.context.lat != null &&
    e.context.lon != null &&
    metersBetween(ctx.lat, ctx.lon, e.context.lat, e.context.lon) < 1500
  ) {
    s += 2;
  }
  return s;
}

/** Retrieve evidence for a context: similar past simulated decisions + outcomes. */
export function findSimilar(ctx: MemoryContext, limit = 40): MemoryEvidence {
  const scored = loadMemory()
    .map((e) => ({ e, score: similarity(ctx, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.ts - a.e.ts)
    .slice(0, limit)
    .map((x) => x.e);

  const n = scored.length;
  if (!n) {
    return { n: 0, avgReductionPct: 0, medianReductionPct: 0, totalVehHoursSaved: 0, avgVsAlternativePct: 0, samples: [] };
  }
  const reductions = scored.map((e) => e.outcome.reductionPct).sort((a, b) => a - b);
  const median = reductions[Math.floor(reductions.length / 2)];
  const avg = reductions.reduce((a, b) => a + b, 0) / n;
  const savings = scored.reduce((a, e) => a + (e.outcome.vehHoursSaved || 0), 0);
  const vsAlt = scored.filter((e) => e.outcome.bestVsAlternativePct != null);
  const avgVsAlt = vsAlt.length
    ? vsAlt.reduce((a, e) => a + (e.outcome.bestVsAlternativePct || 0), 0) / vsAlt.length
    : 0;

  return {
    n,
    avgReductionPct: Math.round(avg),
    medianReductionPct: Math.round(median),
    totalVehHoursSaved: Math.round(savings),
    avgVsAlternativePct: Math.round(avgVsAlt),
    samples: scored.slice(0, 6),
  };
}
