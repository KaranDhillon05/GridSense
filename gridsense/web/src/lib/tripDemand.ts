import type { EventInput } from "@/lib/gridsense";
import type { EventType } from "@/lib/types";

export type TripDemandProfile = {
  total_vehicle_trips: number;
  peak_arrival_vph: number;
  peak_departure_vph: number;
  arrival_curve: number[];
  departure_curve: number[];
  mode_split: {
    private_car: number;
    taxi_ridehail: number;
    bus_metro: number;
    walk: number;
  };
};

const OCCUPANCY: Record<string, number> = {
  sports_match: 2.8,
  concert_festival: 2.2,
  public_gathering: 2.5,
  political_rally: 2.0,
  religious_procession: 1.8,
  marathon_road_race: 1.5,
  vip_movement: 1.5,
  construction_road_closure: 2.0,
};

const WALK_SHARE: Record<string, number> = {
  sports_match: 0.15,
  concert_festival: 0.12,
  public_gathering: 0.2,
  political_rally: 0.25,
  religious_procession: 0.35,
  marathon_road_race: 0.4,
  vip_movement: 0.05,
  construction_road_closure: 0.1,
};

function defaultCurve(len: number, peakIdx: number, sharpness: number): number[] {
  const raw = Array.from({ length: len }, (_, i) =>
    Math.exp(-((i - peakIdx) ** 2) / (2 * sharpness ** 2))
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}

export function buildTripDemand(input: EventInput): TripDemandProfile {
  const attendance = input.expected_attendance ?? 1200;
  const eventType = (input.event_type ?? "public_gathering") as EventType;
  const walk = input.public_transport_involved
    ? (WALK_SHARE[eventType] ?? 0.15) + 0.08
    : WALK_SHARE[eventType] ?? 0.15;
  const roadShare = 1 - walk;
  const occupancy = OCCUPANCY[eventType] ?? 2.5;
  const totalVehicleTrips = Math.round((attendance * roadShare) / occupancy);

  // 12 buckets: arrival T-120..T0 (15 min), departure T0..T+90
  const arrivalCurve = defaultCurve(8, 5, 1.8);
  const departureCurve = defaultCurve(6, 1, 1.2);

  const arrivalPerBucket = arrivalCurve.map((p) => p * totalVehicleTrips);
  const departurePerBucket = departureCurve.map((p) => p * totalVehicleTrips);

  const peakArrivalVph = Math.round(Math.max(...arrivalPerBucket) * 4);
  const peakDepartureVph = Math.round(Math.max(...departurePerBucket) * 4);

  return {
    total_vehicle_trips: totalVehicleTrips,
    peak_arrival_vph: peakArrivalVph,
    peak_departure_vph: peakDepartureVph,
    arrival_curve: arrivalCurve,
    departure_curve: departureCurve,
    mode_split: {
      private_car: 0.55,
      taxi_ridehail: roadShare * 0.25,
      bus_metro: input.public_transport_involved ? 0.2 : 0.08,
      walk,
    },
  };
}
