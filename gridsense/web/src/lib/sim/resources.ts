// Resource catalog, depots and dispatch helpers. Mobile resources (officers,
// tow, ambulance, fire, recovery, maintenance) travel from a depot to the
// incident as routed vehicles and apply an effect on arrival (faster clearance,
// manual signal control, etc.). Static resources (barricades, cones, signs,
// portable signals) are placed at the incident immediately.

import type { ResourceType, VehicleType } from "./types";

export interface ResourceMeta {
  label: string;
  mobile: boolean;
  vehicleType?: VehicleType;
  /** multiplier on incident clearance rate while on scene (per unit) */
  clearanceBoost: number;
  speedMs: number;
}

export const RESOURCE_META: Record<ResourceType, ResourceMeta> = {
  officer: { label: "Officer", mobile: true, vehicleType: "police", clearanceBoost: 0.15, speedMs: 12 },
  supervisor: { label: "Supervisor", mobile: true, vehicleType: "police", clearanceBoost: 0.1, speedMs: 12 },
  rapid_response: { label: "Rapid Response Unit", mobile: true, vehicleType: "police", clearanceBoost: 0.25, speedMs: 14 },
  tow_truck: { label: "Tow Truck", mobile: true, vehicleType: "tow", clearanceBoost: 0.5, speedMs: 9 },
  recovery_van: { label: "Recovery Van", mobile: true, vehicleType: "tow", clearanceBoost: 0.45, speedMs: 9 },
  maintenance_crew: { label: "Maintenance Crew", mobile: true, vehicleType: "tow", clearanceBoost: 0.4, speedMs: 9 },
  ambulance: { label: "Ambulance", mobile: true, vehicleType: "ambulance", clearanceBoost: 0.2, speedMs: 14 },
  fire_engine: { label: "Fire Engine", mobile: true, vehicleType: "fire", clearanceBoost: 0.3, speedMs: 12 },
  barricade: { label: "Barricade", mobile: false, clearanceBoost: 0, speedMs: 0 },
  cones: { label: "Cones", mobile: false, clearanceBoost: 0, speedMs: 0 },
  diversion_sign: { label: "Diversion Sign", mobile: false, clearanceBoost: 0, speedMs: 0 },
  portable_signal: { label: "Portable Signal", mobile: false, clearanceBoost: 0, speedMs: 0 },
};

// Depots mapped onto network nodes (police control rooms, hospitals, fire, tow).
export const DEPOTS: Record<string, string[]> = {
  police: ["mg_central", "richmond_circ", "infantry_rd"],
  hospital: ["kasturba_mayo", "shivajinagar"], // ambulance staging
  fire: ["shivajinagar"],
  tow: ["kbus_majestic", "hosur_feeder"],
  maintenance: ["lalbagh_feed"],
};

export function depotFor(type: ResourceType): string {
  const m = RESOURCE_META[type];
  if (!m.mobile) return "";
  if (type === "ambulance") return DEPOTS.hospital[0];
  if (type === "fire_engine") return DEPOTS.fire[0];
  if (type === "tow_truck" || type === "recovery_van") return DEPOTS.tow[Math.floor(Math.random() * DEPOTS.tow.length)];
  if (type === "maintenance_crew") return DEPOTS.maintenance[0];
  return DEPOTS.police[Math.floor(Math.random() * DEPOTS.police.length)];
}

// Total fleet available (resource shortage edge-case emerges when exceeded).
export const FLEET_CAPACITY: Record<ResourceType, number> = {
  officer: 24,
  supervisor: 6,
  rapid_response: 4,
  tow_truck: 4,
  recovery_van: 3,
  maintenance_crew: 3,
  ambulance: 4,
  fire_engine: 3,
  barricade: 60,
  cones: 120,
  diversion_sign: 30,
  portable_signal: 4,
};
