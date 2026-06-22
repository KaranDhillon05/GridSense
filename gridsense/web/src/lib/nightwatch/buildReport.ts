// Assembles all analysis outputs into a complete NWReport.

import { analyzeVulnerability } from "./vulnerabilityAnalyzer";
import { computeResilienceScore } from "./resilienceScore";
import { optimizeResources } from "./resourceOptimizer";
import type { NWRunResult, NWReport } from "./types";

export function buildReport(results: NWRunResult[]): NWReport {
  if (!results.length) throw new Error("No results to build report from");

  const { corridors, junctions } = analyzeVulnerability(results);
  const { score, grade } = computeResilienceScore(results);
  const resourcePositioning = optimizeResources(results, corridors);

  const worstScenarios = [...results]
    .sort((a, b) => b.baselineMetrics.vehicleHoursLost - a.baselineMetrics.vehicleHoursLost)
    .slice(0, 5);

  const avgImprovementPct = results.length
    ? results.reduce((s, r) => s + r.improvementPct, 0) / results.length
    : 0;

  const totalRunsWithGridlock = results.filter(r => r.baselineMetrics.gridlock).length;

  const resourceSufficiencyPct = results.length
    ? (results.filter(r => r.resourcesSatisfied >= r.resourcesRequested * 0.8).length / results.length) * 100
    : 100;

  const expectedCongestionReductionPct = avgImprovementPct;

  return {
    runCount: results.length,
    completedAt: Date.now(),
    resilienceScore: score,
    grade,
    topCorridors: corridors.slice(0, 10),
    topJunctions: junctions.slice(0, 5),
    worstScenarios,
    resourcePositioning,
    expectedCongestionReductionPct,
    avgImprovementPct,
    totalRunsWithGridlock,
    resourceSufficiencyPct,
  };
}
