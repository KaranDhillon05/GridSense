import type { TripDemandProfile } from "@/lib/tripDemand";
import type { TrafficRoute } from "@/lib/types";

export type DispersalScenario = "nominal" | "one_primary_closed" | "rain_slowdown_20pct";

export type DispersalResult = {
  scenario: DispersalScenario;
  time_to_disperse_p50_min: number;
  time_to_disperse_p90_min: number;
  peak_queue_delay_min: number;
  routes_used: number;
};

function simulateScenario(
  demand: TripDemandProfile,
  outboundRoutes: TrafficRoute[],
  scenario: DispersalScenario
): DispersalResult {
  let routes = outboundRoutes.filter((r) => r.direction === "outbound");
  if (scenario === "one_primary_closed" && routes.length > 1) {
    routes = routes.slice(1);
  }
  const slowdown = scenario === "rain_slowdown_20pct" ? 1.2 : 1;
  const totalVehicles = demand.total_vehicle_trips;
  const totalCapacityPerHour = routes.reduce((s, r) => s + r.capacity_vph, 0) || 1;
  const peakDepartureVph = demand.peak_departure_vph;
  const overload = Math.max(0, peakDepartureVph / totalCapacityPerHour - 0.85);

  const baseDispersalMin = (totalVehicles / totalCapacityPerHour) * 60 * slowdown;
  const queueDelay = overload * 18;

  return {
    scenario,
    time_to_disperse_p50_min: Math.round(baseDispersalMin * 0.75 + queueDelay),
    time_to_disperse_p90_min: Math.round(baseDispersalMin * 1.15 + queueDelay * 1.6),
    peak_queue_delay_min: Math.round(queueDelay * 10) / 10,
    routes_used: routes.length,
  };
}

export function runDispersalScenarios(
  demand: TripDemandProfile,
  outboundRoutes: TrafficRoute[]
): DispersalResult[] {
  const scenarios: DispersalScenario[] = [
    "nominal",
    "one_primary_closed",
    "rain_slowdown_20pct",
  ];
  return scenarios.map((s) => simulateScenario(demand, outboundRoutes, s));
}
