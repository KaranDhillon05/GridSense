import type { Metrics } from "@/lib/sim/types";
import type { IncidentType, Severity } from "@/lib/sim/types";
import type { ResourceType } from "@/lib/sim/types";

export interface NWScenario {
  seed: number;
  incidentType: IncidentType;
  edgeId: string;
  edgeName: string;
  startTimeSec: number;
  durationMin: number;
  severity: Severity;
  lanesAffected: number;
}

export interface NWRunResult {
  scenario: NWScenario;
  baselineMetrics: Metrics;
  responseMetrics: Metrics;
  improvementPct: number;
  queueGrowthM: number;
  spilloverEdgeCount: number;
  clearanceTimeSec: number;
  resourcesRequested: number;
  resourcesSatisfied: number;
}

export interface CorridorVulnerability {
  edgeId: string;
  name: string;
  lat: number;
  lon: number;
  avgDelayVehMin: number;
  worstDelayVehMin: number;
  avgQueueM: number;
  avgSpillover: number;
  avgImprovementPct: number;
  incidentCount: number;
  resourceDemandScore: number;
  riskScore: number;
}

export interface JunctionVulnerability {
  nodeId: string;
  name: string;
  lat: number;
  lon: number;
  congestionHitCount: number;
  avgQueueImpact: number;
  riskScore: number;
}

export interface ResourceRecommendation {
  resourceType: ResourceType;
  label: string;
  currentLocation: string;
  recommendedLocation: string;
  targetEdgeId: string;
  reason: string;
  expectedImprovementPct: number;
}

export interface NWReport {
  runCount: number;
  completedAt: number;
  resilienceScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  topCorridors: CorridorVulnerability[];
  topJunctions: JunctionVulnerability[];
  worstScenarios: NWRunResult[];
  resourcePositioning: ResourceRecommendation[];
  expectedCongestionReductionPct: number;
  avgImprovementPct: number;
  totalRunsWithGridlock: number;
  resourceSufficiencyPct: number;
}
