"""
GridSense — Operational Playbook generator (Python mirror of web/src/lib/playbook.ts).

Turns a forecast + the resource recommendation into 3-5 candidate management
strategies, one recommended strategy with a "why", a corridor/junction-aware
advisory, a resource plan, and a before/during/after checklist.

Corridor-aware operations planning, NOT navigation: diversion output is a
*candidate alternate movement corridor*, never a "fastest route". Kept faithful
to the TypeScript generator that the deployed app uses.
"""
from __future__ import annotations

from recommend import CAUSE_EQUIPMENT

# --- Strategy catalog ------------------------------------------------------
CATALOG = {
    "full_diversion": {
        "id": "full_diversion", "name": "Full Diversion", "type": "diversion-heavy",
        "use_when": "Unsafe work zone or full closure required",
        "reduction": "high", "resource": "high", "barricade": "high",
        "comms": "urgent", "complexity": "medium",
        "reasoning": ["Closure blocks through movement", "Through traffic must be re-routed"],
        "actions": [
            "Close the affected stretch with hard barricades",
            "Deploy officers at upstream junctions to turn traffic early",
            "Activate the candidate alternate movement corridor",
            "Publish a public diversion advisory",
        ],
    },
    "partial_flow": {
        "id": "partial_flow", "name": "Partial Flow Management", "type": "flow-management",
        "use_when": "One side passable; keep limited movement with lane tapers",
        "reduction": "medium", "resource": "medium", "barricade": "medium",
        "comms": "medium", "complexity": "medium",
        "reasoning": ["Partial carriageway remains usable", "Avoids a full closure"],
        "actions": [
            "Taper the affected lane and channel traffic to open lanes",
            "Post officers to meter flow through the pinch point",
            "Pre-position recovery so the lane can reopen fast",
        ],
    },
    "peak_hour_restriction": {
        "id": "peak_hour_restriction", "name": "Peak-Hour Restriction", "type": "time-restriction",
        "use_when": "Planned, long-duration work that can avoid peak windows",
        "reduction": "medium", "resource": "low", "barricade": "low",
        "comms": "urgent", "complexity": "low",
        "reasoning": ["Disruption is planned and long-running",
                      "Shifting work out of peak windows cuts congestion impact"],
        "actions": [
            "Restrict heavy work to off-peak hours",
            "Publish the work-window schedule in advance",
            "Stage barricades for rapid peak-hour removal",
        ],
    },
    "rapid_clearance": {
        "id": "rapid_clearance", "name": "Rapid Clearance", "type": "clearance",
        "use_when": "Breakdown/obstruction — fastest path is to clear it",
        "reduction": "high", "resource": "medium", "barricade": "low",
        "comms": "low", "complexity": "low",
        "reasoning": ["Obstruction is the root cause of the slowdown",
                      "Clearing it restores normal flow fastest"],
        "actions": [
            "Dispatch the field clearance / recovery team immediately",
            "Hold one officer to manage flow around the obstruction",
            "Reopen and stand down once cleared",
        ],
    },
    "heavy_vehicle_diversion": {
        "id": "heavy_vehicle_diversion", "name": "Heavy-Vehicle Diversion",
        "type": "vehicle-restriction",
        "use_when": "Heavy vehicle involved or blocking; cars can still pass",
        "reduction": "medium", "resource": "medium", "barricade": "medium",
        "comms": "medium", "complexity": "medium",
        "reasoning": ["Heavy vehicle is the main constraint",
                      "Restricting heavy traffic keeps lighter flow moving"],
        "actions": [
            "Divert heavy vehicles to the alternate corridor upstream",
            "Allow light vehicles through under officer control",
            "Coordinate recovery for the blocking vehicle",
        ],
    },
    "public_advisory_first": {
        "id": "public_advisory_first", "name": "Public Advisory First", "type": "communication",
        "use_when": "Planned/known event — demand can be reduced before it builds",
        "reduction": "medium", "resource": "low", "barricade": "low",
        "comms": "urgent", "complexity": "low",
        "reasoning": ["Event is known ahead of time",
                      "Early advisory shifts demand away from the corridor"],
        "actions": [
            "Issue an advance public advisory across channels",
            "Suggest the candidate alternate movement corridor",
            "Coordinate with event organisers on timing",
        ],
    },
    "junction_protection": {
        "id": "junction_protection", "name": "Junction Protection", "type": "junction-control",
        "use_when": "Risk of upstream junctions locking up / spillback",
        "reduction": "medium", "resource": "medium", "barricade": "low",
        "comms": "low", "complexity": "medium",
        "reasoning": ["Spillback can gridlock upstream junctions",
                      "Protecting key junctions preserves network flow"],
        "actions": [
            "Man the upstream control junctions",
            "Hold/adjust signal timing to prevent box-blocking",
            "Keep feeder junctions clear for the alternate corridor",
        ],
    },
}

HEAVY = {"heavy_vehicle", "truck", "lcv", "bmtc_bus", "ksrtc_bus", "private_bus"}
DIVERSION_TYPES = {"diversion-heavy", "vehicle-restriction"}


def _dedupe(xs):
    seen, out = set(), []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _select(inp: dict, fc: dict):
    closure = bool(inp.get("requires_road_closure"))
    tier = fc["tier"]
    sensitive = inp.get("corridor", "Non-corridor") != "Non-corridor"
    long = fc["expected_duration_min"] > 240
    cause = inp.get("cause", "others")
    heavy = inp.get("veh_type") in HEAVY
    planned = bool(inp.get("is_planned"))

    ids, why = [], []
    add = lambda i: ids.append(i) if i not in ids else None

    if closure:
        recommended = "full_diversion"
        add("full_diversion"); add("junction_protection"); add("public_advisory_first")
        if planned:
            add("peak_hour_restriction")
        why.append("Road closure required")
        if tier in ("Severe", "High"):
            why.append(f"{tier} forecast impact")
        if sensitive:
            why.append("High corridor sensitivity")
        if long:
            why.append("Long-duration disruption during operating hours")
    elif cause in ("vehicle_breakdown", "accident") and not closure:
        recommended = "rapid_clearance"
        add("rapid_clearance"); add("partial_flow"); add("junction_protection")
        why.append("Obstruction with carriageway still partly usable")
        if heavy:
            add("heavy_vehicle_diversion")
            why.append("Heavy vehicle involved")
    elif planned and cause in ("public_event", "construction") and long:
        recommended = "peak_hour_restriction" if cause == "construction" else "public_advisory_first"
        add("public_advisory_first"); add("peak_hour_restriction")
        add("full_diversion" if closure else "partial_flow"); add("junction_protection")
        why.append("Planned, long-duration disruption during operating hours")
        if sensitive:
            why.append("High corridor sensitivity")
    elif cause in ("water_logging", "tree_fall", "pot_holes", "road_conditions"):
        recommended = "full_diversion" if closure else "rapid_clearance"
        if closure:
            add("full_diversion")
        add("rapid_clearance"); add("partial_flow"); add("public_advisory_first")
        why.append(f"Road-condition hazard ({cause.replace('_', ' ')})")
    else:
        recommended = "junction_protection" if sensitive else "partial_flow"
        add("partial_flow"); add("junction_protection"); add("public_advisory_first")
        why.append("Localised congestion / general slowdown")

    if heavy and "heavy_vehicle_diversion" not in ids:
        add("heavy_vehicle_diversion")

    for filler in ("public_advisory_first", "junction_protection", "partial_flow"):
        if len(ids) >= 3:
            break
        add(filler)

    ids = ids[:5]
    if recommended not in ids:
        ids[0] = recommended
    if inp.get("is_peak"):
        why.append("Peak-hour timing amplifies impact")
    return ids, recommended, _dedupe(why)[:5]


def _materialize(sid: str, recommended: str, inp: dict, fc: dict) -> dict:
    t = CATALOG[sid]
    reasoning = list(t["reasoning"])
    if fc["expected_duration_min"] > 240:
        reasoning.append("Long expected duration")
    if inp.get("corridor", "Non-corridor") != "Non-corridor":
        reasoning.append(f"Sensitive corridor ({inp['corridor']})")
    actions = list(t["actions"])
    junctions = int(inp.get("affected_junctions", 1))
    if junctions > 1:
        actions.append(f"Cover all {junctions} affected junctions")
    confidence = "high" if fc["expected_duration_min"] and inp.get("corridor", "Non-corridor") != "Non-corridor" else "medium"
    return {
        "id": t["id"], "name": t["name"], "type": t["type"],
        "recommended": sid == recommended, "use_when": t["use_when"],
        "expected_congestion_reduction": t["reduction"],
        "resource_demand": t["resource"], "barricade_demand": t["barricade"],
        "public_communication_need": t["comms"], "operational_complexity": t["complexity"],
        "confidence": confidence,
        "reasoning": _dedupe(reasoning)[:4], "actions": actions[:5],
    }


def _resource_plan(plan: dict, inp: dict) -> dict:
    total = plan["manpower"]["total_deployment"]
    bars = plan["barricading"]["barricade_units"]
    lo = lambda n, d: max(0, n - d)
    return {
        "officers_range": f"{lo(total, 2)}-{total + 4}",
        "barricades_range": f"{lo(bars, 1)}-{bars + 2}" if bars else "0-2",
        "shifts": plan["manpower"]["shifts"],
        "wardens": plan["manpower"]["wardens"],
        "head_constables": plan["manpower"]["head_constables"],
        "constables": plan["manpower"]["constables"],
        "special_units": CAUSE_EQUIPMENT.get(inp.get("cause", "others"), ["Cones", "Caution boards"]),
        "confidence": plan["confidence"],
        "narrative": plan["narrative"],
    }


def _advisory(inp: dict, rec: dict, maps_client=None) -> dict:
    diversion = rec["type"] in DIVERSION_TYPES
    labels = ["upstream feeder junction", "downstream feeder junction",
              "parallel-corridor entry", "event-side junction"]
    n = max(1, int(inp.get("affected_junctions", 1)))
    control_points = labels[:n]
    if inp.get("junction"):
        control_points = [f"{inp['junction']} (event junction)"] + control_points

    advisory = {
        "control_style": ("Full closure" if inp.get("requires_road_closure")
                          else "Partial flow management" if rec["type"] == "flow-management"
                          else "Clearance + flow control" if rec["type"] == "clearance"
                          else "Managed flow"),
        "impacted_corridor": inp.get("corridor", "Non-corridor"),
        "candidate_alternates": (["parallel arterial corridor", "upstream feeder route"]
                                 if diversion else ["lane-level management on-corridor"]),
        "control_points": control_points,
        "public_note": ("Avoid the affected stretch and use the suggested alternate movement corridor."
                        if diversion else
                        "Expect slow movement on the affected stretch; follow officer direction."),
    }
    if diversion and inp.get("lat") is not None and inp.get("lon") is not None and maps_client:
        advisory["route"] = maps_client.diversion_route(float(inp["lat"]), float(inp["lon"]))
    return advisory


def _checklist(inp: dict, rec: dict) -> dict:
    closure = bool(inp.get("requires_road_closure"))
    planned = bool(inp.get("is_planned"))
    diversion = rec["type"] in DIVERSION_TYPES

    before = [
        "Confirm event location, extent and expected window",
        "Brief field officers on the recommended strategy",
        "Publish public advisory ahead of the event" if planned else "Alert nearest patrol to the live event",
        "Stage barricades and equipment at control points",
    ]
    if diversion:
        before.append("Pre-survey the candidate alternate movement corridor")
    if closure:
        before.append("Position recovery/clearance units before closing")

    during = [
        "Deploy officers to all control points",
        "Monitor upstream junctions for spillback",
        "Direct through-traffic onto the alternate corridor" if diversion
        else "Meter flow through the affected stretch",
        "Update public advisory if the situation changes",
    ]
    after = [
        "Reopen lanes and remove barricades",
        "Stand down field units in stages",
        "Log actual clearance time and resources used",
        "Feed the outcome into post-event learning for calibration",
    ]
    return {"before": before, "during": during, "after": after}


def build_playbook(inp: dict, fc: dict, plan: dict, maps_client=None) -> dict:
    ids, recommended, why = _select(inp, fc)
    strategies = [_materialize(i, recommended, inp, fc) for i in ids]
    rec = next((s for s in strategies if s["recommended"]), strategies[0])
    return {
        "recommended_strategy_id": rec["id"],
        "why": why,
        "strategies": strategies,
        "resource_plan": _resource_plan(plan, inp),
        "advisory": _advisory(inp, rec, maps_client),
        "checklist": _checklist(inp, rec),
    }
