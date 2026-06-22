// Running network metrics for the command centre: delay (vehicle-minutes),
// vehicle-hours lost, mean speed, travel time, queues, utilization, throughput
// and a gridlock flag. Accumulated incrementally so the live and baseline sims
// report comparable "with vs without intervention" numbers.

import { VEHICLE_DESIRED_MS } from "./types";
import type { EdgeCongestion, Metrics, Vehicle } from "./types";

export class MetricsTracker {
  totalDelaySec = 0;
  arrivedCount = 0;
  arrivedTravelSec = 0;
  private arrivalTimes: number[] = []; // for rolling throughput

  /** Call once per step with the current dt (sim seconds). */
  accumulate(vehicles: Vehicle[], dt: number) {
    for (const v of vehicles) {
      if (v.arrived || v.isResource) continue;
      const v0 = VEHICLE_DESIRED_MS[v.type];
      const deficit = Math.max(0, (v0 - v.speed) / v0);
      this.totalDelaySec += deficit * dt;
    }
  }

  recordArrival(v: Vehicle, time: number) {
    this.arrivedCount++;
    this.arrivedTravelSec += time - v.spawnTime;
    this.arrivalTimes.push(time);
  }

  snapshot(
    time: number,
    vehicles: Vehicle[],
    congestion: EdgeCongestion[]
  ): Metrics {
    const demand = vehicles.filter((v) => !v.isResource && !v.arrived);
    const meanSpeed = demand.length
      ? demand.reduce((s, v) => s + v.speed, 0) / demand.length
      : 0;
    const maxQueueM = congestion.reduce((m, c) => Math.max(m, c.queueLength), 0);
    const congestedEdges = congestion.filter((c) => c.utilization > 0.7 || c.blocked).length;
    const netUtil = congestion.length
      ? congestion.reduce((s, c) => s + c.utilization, 0) / congestion.length
      : 0;

    // rolling throughput over the last 60 sim-seconds
    const cutoff = time - 60;
    this.arrivalTimes = this.arrivalTimes.filter((t) => t >= cutoff);
    const throughputPerMin = this.arrivalTimes.length;

    const gridlock = demand.length > 30 && meanSpeed < 1.2;

    return {
      simTime: time,
      activeVehicles: demand.length,
      arrived: this.arrivedCount,
      meanSpeedKmh: meanSpeed * 3.6,
      totalDelayVehMin: this.totalDelaySec / 60,
      vehicleHoursLost: this.totalDelaySec / 3600,
      meanTravelTimeMin: this.arrivedCount ? this.arrivedTravelSec / this.arrivedCount / 60 : 0,
      maxQueueM,
      networkUtilization: netUtil,
      throughputPerMin,
      congestedEdges,
      gridlock,
    };
  }
}
