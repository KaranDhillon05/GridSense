"""
GridSense — Resource recommendation engine (pure Python).

Maps a forecasted impact (score + tier + duration + closure + cause) into a
concrete deployment plan: manpower, barricading, and diversion. The logic is a
transparent rules-from-data engine so officers can see *why* each number is what
it is. Imported by the API; no heavy deps.
"""
from __future__ import annotations

import math


# Cause-specific barricade/equipment hints (operational knowledge encoded once).
CAUSE_EQUIPMENT = {
    "construction": ["Lane-separator cones", "Caution boards", "Lighted barriers"],
    "water_logging": ["Pump units", "Warning signage", "Lighted barriers"],
    "pot_holes": ["Caution boards", "Cones around pit"],
    "tree_fall": ["Tree-cutting crew", "Recovery vehicle"],
    "accident": ["Recovery crane", "Medical standby", "Cones"],
    "vehicle_breakdown": ["Tow vehicle", "Cones"],
    "public_event": ["Crowd barricades", "PA system", "Watch towers"],
    "procession": ["Mobile barricades", "Escort vehicles"],
    "protest": ["Crowd barricades", "Reserve force standby"],
    "vip_movement": ["Pilot vehicles", "Spot barricades", "Sniffer check"],
}


def _tier_base_manpower(tier: str) -> int:
    return {"Severe": 12, "High": 7, "Moderate": 4, "Low": 2}.get(tier, 2)


def recommend(
    *,
    tier: str,
    impact_score: float,
    expected_duration_min: float,
    requires_road_closure: bool,
    cause: str,
    corridor: str,
    is_planned: bool,
    is_peak: bool,
    affected_junctions: int = 1,
) -> dict:
    # --- Manpower ---
    base = _tier_base_manpower(tier)
    manpower = base
    manpower += max(0, affected_junctions - 1) * 2          # +2 per extra junction
    if requires_road_closure:
        manpower += 4                                        # closures need diversion staff
    if is_peak:
        manpower = math.ceil(manpower * 1.3)                 # peak-hour surge
    if corridor != "Non-corridor":
        manpower += 2                                        # arterial corridors get extra
    long_event = expected_duration_min > 240
    shifts = 2 if long_event else 1                          # >4h needs a relief shift
    officers = {
        "head_constables": max(1, manpower // 4),
        "constables": manpower,
        "wardens": 2 if requires_road_closure else 1,
        "shifts": shifts,
        "total_deployment": manpower * shifts + max(1, manpower // 4),
    }

    # --- Barricading ---
    barricades = 0
    if requires_road_closure:
        barricades = 4 + affected_junctions * 2
    elif tier in ("Severe", "High"):
        barricades = 2 + affected_junctions
    elif tier == "Moderate":
        barricades = affected_junctions
    equipment = CAUSE_EQUIPMENT.get(cause, ["Cones", "Caution boards"])
    barricading = {
        "barricade_units": barricades,
        "placement": "Both approaches + diversion points" if requires_road_closure
                     else "Affected lane taper",
        "equipment": equipment,
    }

    # --- Diversion (route geometry is filled by the mock MapmyIndia client in the API) ---
    diversion_needed = requires_road_closure or tier == "Severe"
    diversion = {
        "needed": diversion_needed,
        "strategy": (
            "Full diversion to parallel arterial; signal-time adjustment at feeder junctions"
            if diversion_needed else
            "No diversion — lane management sufficient"
        ),
        "advisory_lead_time_min": 60 if is_planned else 0,
    }

    # --- Narrative + confidence ---
    confidence = "High" if expected_duration_min and corridor != "Non-corridor" else "Medium"
    narrative = _narrative(tier, cause, manpower, shifts, barricades, diversion_needed,
                           expected_duration_min, requires_road_closure)

    return {
        "manpower": officers,
        "barricading": barricading,
        "diversion": diversion,
        "confidence": confidence,
        "narrative": narrative,
    }


def _narrative(tier, cause, manpower, shifts, barricades, diversion, dur, closure):
    parts = [f"{tier} impact event ({cause.replace('_',' ')})."]
    parts.append(f"Deploy ~{manpower} field personnel"
                 + (f" across {shifts} shifts" if shifts > 1 else "") + ".")
    if barricades:
        parts.append(f"Set up {barricades} barricade units.")
    if diversion:
        parts.append("Activate a diversion to the parallel arterial.")
    if closure:
        parts.append("Pre-position recovery and signage for the road closure.")
    if dur:
        hrs = dur / 60
        parts.append(f"Plan for ~{hrs:.1f}h of operations.")
    return " ".join(parts)
