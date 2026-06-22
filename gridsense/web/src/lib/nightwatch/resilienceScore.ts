// Computes a composite network resilience score (0–100, higher = more resilient)
// from Monte Carlo run results.

import type { NWRunResult } from "./types";

export function computeResilienceScore(results: NWRunResult[]): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: Record<string, number>;
} {
  if (!results.length) return { score: 0, grade: "F", breakdown: {} };

  const avgImprovement = avg(results.map(r => r.improvementPct));
  const worstDelay = Math.max(...results.map(r => r.baselineMetrics.totalDelayVehMin));
  const avgSpillover = avg(results.map(r => r.spilloverEdgeCount));
  const sufficiencyPct = results.length
    ? (results.filter(r => r.resourcesSatisfied >= r.resourcesRequested * 0.8).length / results.length) * 100
    : 100;
  const avgClearanceSec = avg(results.map(r => r.clearanceTimeSec));
  const expectedClearanceSec = avg(results.map(r => r.scenario.durationMin * 60));
  const recoveryRatio = expectedClearanceSec > 0
    ? Math.min(1, expectedClearanceSec / Math.max(avgClearanceSec, 1))
    : 1;

  // Each factor → 0–100 sub-score.
  const improvementScore = Math.min(100, avgImprovement * 1.4);
  const worstCaseScore = Math.max(0, 100 - Math.min(100, worstDelay / 5));
  const spreadScore = Math.max(0, 100 - Math.min(100, avgSpillover * 10));
  const sufficiencyScore = sufficiencyPct;
  const recoveryScore = recoveryRatio * 100;

  const score = Math.round(
    improvementScore * 0.30 +
    worstCaseScore * 0.25 +
    spreadScore * 0.20 +
    sufficiencyScore * 0.15 +
    recoveryScore * 0.10
  );

  const clampedScore = Math.max(0, Math.min(100, score));
  const grade =
    clampedScore >= 90 ? "A" :
    clampedScore >= 80 ? "B" :
    clampedScore >= 65 ? "C" :
    clampedScore >= 50 ? "D" : "F";

  return {
    score: clampedScore,
    grade,
    breakdown: {
      interventionEffectiveness: Math.round(improvementScore),
      worstCaseResilience: Math.round(worstCaseScore),
      congestionContainment: Math.round(spreadScore),
      resourceSufficiency: Math.round(sufficiencyScore),
      recoverySpeed: Math.round(recoveryScore),
    },
  };
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
