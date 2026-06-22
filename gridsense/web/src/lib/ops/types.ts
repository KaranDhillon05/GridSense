// GridSense 2.0 — Operations domain types.
//
// The shared "operating picture" that the Operations Center, Incident Manager,
// Wind Tunnel and AI brain all read/write. Reuses the simulation domain enums
// (Severity / IncidentType / ResourceType) and the planner→sim bridge types so
// an OpsIncident can be fed straight into the existing microsimulation.

import type { Severity, IncidentType, ResourceType } from "@/lib/sim/types";
import type { PlanScenario } from "@/lib/sim/planScenario";
import type { PlanSimResult } from "@/lib/sim/strategySimulator";
import type { TrafficPlanOutput, MapplsContext } from "@/lib/types";

// Re-export the simulation domain enums so ops modules import them from one place.
export type { Severity, IncidentType, ResourceType } from "@/lib/sim/types";

// --- Incidents -------------------------------------------------------------

export type IncidentStatus =
  | "detected"
  | "verified"
  | "responding"
  | "managed"
  | "clearing"
  | "closed";

export const INCIDENT_STATUS_ORDER: IncidentStatus[] = [
  "detected",
  "verified",
  "responding",
  "managed",
  "clearing",
  "closed",
];

export interface TimelineEntry {
  t: number; // ops clock ms
  label: string;
}

export interface IncidentAssessment {
  summary: string;
  severityCall: Severity;
  escalate: boolean;
  recommendedPlanId?: "A" | "B" | "C" | "D";
  predictedDelayMin: number;
  spilloverJunctions: number;
  historicalSimilarityPct: number; // 0..100
  source: "ai" | "rule";
}

export interface OpsIncident {
  id: string;
  type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  corridor: string;
  lat: number;
  lon: number;
  /** Present when the incident snaps inside the CBD twin → Wind Tunnel eligible. */
  edgeId?: string;
  scenario?: PlanScenario;
  detectedAt: number; // ops clock ms
  etaClearMin?: number; // remaining minutes until expected clearance
  predictedDurationMin: number;
  requiresClosure: boolean;
  assignedResourceIds: string[];
  taskIds: string[];
  deploymentIds: string[];
  timeline: TimelineEntry[];
  windTunnel?: PlanSimResult;
  /** Full-Bangalore traffic plan (same engine as /plan), cached after Run Wind Tunnel. */
  incidentPlan?: TrafficPlanOutput | null;
  /** Mappls isochrones/facilities accompanying the cached plan. */
  incidentPlanContext?: MapplsContext;
  aiAssessment?: IncidentAssessment;
  /** Heuristic escalation level driven by severity + queue growth. */
  escalation: "low" | "medium" | "high" | "critical";
  source: "seed" | "manual" | "copilot";
}

// --- Resources -------------------------------------------------------------

export type OpsResourceStatus = "available" | "enroute" | "onscene" | "returning";

export interface OpsResource {
  id: string;
  type: ResourceType;
  label: string;
  status: OpsResourceStatus;
  lat: number;
  lon: number;
  homeName: string;
  homeNode: string;
  assignedIncidentId?: string;
  etaMin?: number;
}

// --- Deployments -----------------------------------------------------------

export type DeploymentKind =
  | "diversion"
  | "barricade"
  | "signal_override"
  | "field_unit";

export type DeploymentStatus = "proposed" | "active" | "stood_down";

export interface Deployment {
  id: string;
  incidentId: string;
  kind: DeploymentKind;
  label: string;
  edgeIds?: string[];
  junctions?: string[];
  geometry?: number[][]; // [lon,lat] polyline for diversions
  lat?: number;
  lon?: number;
  status: DeploymentStatus;
  createdAt: number;
}

// --- Tasks / Workflow ------------------------------------------------------

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

export interface Task {
  id: string;
  incidentId?: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  assignee?: string;
  sourceRecommendation?: string;
  createdAt: number;
  completedAt?: number;
}

// --- AI brief --------------------------------------------------------------

export interface OpsRecommendation {
  id: string;
  incidentId?: string;
  action: string;
  rationale: string;
  priority: "high" | "med" | "low";
}

export interface OpsBrief {
  headline: string;
  situation: string;
  priorities: string[];
  recommendations: OpsRecommendation[];
  escalations: string[];
  source: "ai" | "rule";
  generatedAt: number;
}

// --- Metrics & top-level state --------------------------------------------

export interface OpsMetrics {
  activeIncidents: number;
  severeCount: number;
  resourcesCommitted: number;
  resourcesAvailable: number;
  resourceUtilizationPct: number;
  criticalCorridors: number;
  vehicleHoursSavedToday: number;
  avgResponseMin: number;
  activeDeployments: number;
  openTasks: number;
}

export interface OpsState {
  version: number;
  clockMs: number; // ops sim clock (NOT the microsim clock)
  running: boolean;
  incidents: OpsIncident[];
  resources: OpsResource[];
  deployments: Deployment[];
  tasks: Task[];
  metrics: OpsMetrics;
  brief?: OpsBrief;
  /** monotonically increasing id counter for new entities */
  seq: number;
}
