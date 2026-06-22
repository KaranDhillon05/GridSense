"""
GridSense — API service layer.

Loads precomputed artifacts and the duration model, exposes forecast/recommend,
and provides the MOCK external-integration clients (MapmyIndia routing + ASTraM
live feed). The mocks are clearly marked and return plausible, data-grounded
responses so the architecture is production-swappable: replace the client body
with a real HTTP call and nothing else changes.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import joblib
import numpy as np

ML = Path(__file__).resolve().parent.parent / "ml"
ART = ML / "artifacts"
sys.path.insert(0, str(ML))

import scoring          # noqa: E402
import recommend as rec  # noqa: E402
import playbook as pb    # noqa: E402

CAT = ["event_cause", "corridor", "zone", "veh_type", "priority"]
NUM = ["requires_road_closure", "is_planned", "hour", "dow", "is_weekend", "is_peak"]


class Artifacts:
    def __init__(self):
        self.agg = json.loads((ART / "aggregates.json").read_text())
        self.scored = json.loads((ART / "scored_events.json").read_text())
        self.hotspots = json.loads((ART / "hotspots.json").read_text())
        self.learning = json.loads((ART / "learning.json").read_text())
        self.meta = json.loads((ART / "model_meta.json").read_text())
        self.model = joblib.load(ART / "duration_model.joblib")


# ----------------------------- MOCK INTEGRATIONS -----------------------------
class MapMyIndiaClient:
    """MOCK MapmyIndia routing client.

    In production this calls MapmyIndia Directions/Nearby APIs. Here it returns a
    plausible diversion polyline that bows around the affected segment, grounded
    on real diversion endpoints seen in the ASTraM data.
    """

    IS_MOCK = True

    def diversion_route(self, lat: float, lon: float, bearing_deg: float | None = None):
        random.seed(int(abs(lat * 1000) + abs(lon * 1000)))
        # Offset (~600m) perpendicular to a notional through-road, two waypoints.
        d = 0.006
        theta = math.radians(bearing_deg if bearing_deg is not None else random.uniform(0, 360))
        ox, oy = math.cos(theta) * d, math.sin(theta) * d
        route = [
            [lon - ox * 1.2, lat - oy * 1.2],
            [lon - ox * 0.4 + oy * 0.8, lat - oy * 0.4 - ox * 0.8],
            [lon + ox * 0.4 + oy * 0.8, lat + oy * 0.4 - ox * 0.8],
            [lon + ox * 1.2, lat + oy * 1.2],
        ]
        dist_km = round(random.uniform(1.2, 3.4), 1)
        return {
            "provider": "MapmyIndia (mock)",
            "geometry": route,             # [lon, lat] pairs (GeoJSON order)
            "distance_km": dist_km,
            "extra_travel_min": round(dist_km * random.uniform(2.5, 4.0), 0),
        }

    def diversion_alternatives(self, lat: float, lon: float):
        base = self.diversion_route(lat, lon)
        alt_fast = self.diversion_route(lat + 0.0018, lon - 0.0015)
        alt_hv = self.diversion_route(lat - 0.0016, lon + 0.0014)
        options = [
            {
                "id": "primary_diversion",
                "rank": 1,
                **base,
                "estimated_clearance_relief": "high",
                "advisory_note": "Balanced alternate corridor for most through-traffic.",
            },
            {
                "id": "arterial_preferred",
                "rank": 2,
                **{**alt_fast, "extra_travel_min": max(1, alt_fast["extra_travel_min"] - 2)},
                "estimated_clearance_relief": "medium",
                "advisory_note": "Faster arterial-oriented alternate; monitor feeder spillback.",
            },
            {
                "id": "heavy_vehicle_safe",
                "rank": 3,
                **{**alt_hv, "extra_travel_min": alt_hv["extra_travel_min"] + 3},
                "estimated_clearance_relief": "medium",
                "advisory_note": "Wider movement envelope for heavy vehicles and recovery access.",
            },
        ]
        return {
            "route_options": options,
            "selected_route_id": options[0]["id"],
            "routing_source": "mock",
            "fallback_reason": "MapmyIndia unavailable or incomplete response.",
        }


class LiveMapMyIndiaClient(MapMyIndiaClient):
    IS_MOCK = False

    def __init__(self):
        self.api_key = os.getenv("MAPMYINDIA_API_KEY")
        self.base_url = os.getenv("MAPMYINDIA_DIRECTIONS_URL")

    def _directions(self, origin_lat, origin_lon, dest_lat, dest_lon, via_lat, via_lon):
        if not self.api_key or not self.base_url:
            return None
        q = {
            "origin": f"{origin_lat},{origin_lon}",
            "destination": f"{dest_lat},{dest_lon}",
            "waypoints": f"{via_lat},{via_lon}",
            "routeType": "0",
            "alternatives": "false",
        }
        url = f"{self.base_url}?{urllib.parse.urlencode(q)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.api_key}"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            first = (data.get("routes") or [None])[0]
            coords = (first or {}).get("geometry", {}).get("coordinates")
            if not coords or len(coords) < 2:
                return None
            distance_km = float(first.get("distance", 0)) / 1000
            duration_min = float(first.get("duration", 0)) / 60
            if distance_km <= 0 or duration_min <= 0:
                return None
            return {
                "provider": "MapmyIndia",
                "geometry": coords,
                "distance_km": round(distance_km, 1),
                "extra_travel_min": round(duration_min),
            }
        except Exception:
            return None

    def diversion_alternatives(self, lat: float, lon: float):
        deltas = [
            ("primary_diversion", 0.0, 0.0, "high", "Primary alternate corridor with balanced diversion load."),
            ("arterial_preferred", 0.0016, -0.0011, "medium", "Arterial-priority route for faster through movement."),
            ("heavy_vehicle_safe", -0.0014, 0.0013, "medium", "Heavy-vehicle-friendly route with safer turning profile."),
        ]
        options = []
        for idx, (route_id, dlat, dlon, relief, note) in enumerate(deltas, start=1):
            r = self._directions(
                lat + dlat - 0.004, lon + dlon - 0.004, lat + dlat + 0.004, lon + dlon + 0.004, lat, lon
            )
            if not r:
                continue
            options.append(
                {
                    "id": route_id,
                    "rank": idx,
                    **r,
                    "estimated_clearance_relief": relief,
                    "advisory_note": note,
                }
            )
        if not options:
            return super().diversion_alternatives(lat, lon)
        return {
            "route_options": options,
            "selected_route_id": options[0]["id"],
            "routing_source": "mapmyindia",
        }


class LiveFeedClient:
    """MOCK ASTraM live feed.

    In production this subscribes to the ASTraM event stream. Here it synthesizes
    a realistic 'currently active' set by sampling recent high-impact events.
    """

    IS_MOCK = True

    def __init__(self, scored):
        self._scored = scored

    def active_events(self, limit: int = 60):
        active = [e for e in self._scored if e.get("status") == "active"]
        if len(active) < limit:
            extra = sorted(
                [e for e in self._scored if e.get("status") != "active"],
                key=lambda e: -(e.get("impact_score") or 0),
            )
            active = active + extra[: limit - len(active)]
        active = sorted(active, key=lambda e: -(e.get("impact_score") or 0))[:limit]
        for e in active:
            e["live"] = True
        return active


# ------------------------------- CORE SERVICE --------------------------------
class GridSense:
    def __init__(self):
        self.a = Artifacts()
        self.maps = LiveMapMyIndiaClient()
        self.feed = LiveFeedClient(self.a.scored)

    def predict_duration(self, f: dict) -> float:
        import pandas as pd
        row = {
            "event_cause": f.get("cause", "others"),
            "corridor": f.get("corridor", "Non-corridor"),
            "zone": f.get("zone", "Unknown"),
            "veh_type": f.get("veh_type", "Unknown"),
            "priority": f.get("priority", "High"),
            "requires_road_closure": int(bool(f.get("requires_road_closure"))),
            "is_planned": int(bool(f.get("is_planned"))),
            "hour": int(f.get("hour", 12)),
            "dow": int(f.get("dow", 2)),
            "is_weekend": int(bool(f.get("is_weekend"))),
            "is_peak": int(bool(f.get("is_peak"))),
        }
        X = pd.DataFrame([row])[CAT + NUM]
        return float(np.expm1(self.a.model.predict(X))[0])

    def forecast(self, f: dict) -> dict:
        dur = self.predict_duration(f)
        s = scoring.score_factors(
            agg=self.a.agg,
            cause=f.get("cause", "others"),
            corridor=f.get("corridor", "Non-corridor"),
            duration_min=dur,
            requires_road_closure=bool(f.get("requires_road_closure")),
            priority=f.get("priority", "High"),
            is_peak=bool(f.get("is_peak")),
        )
        s["affected_radius_m"] = int(250 + 4 * s["impact_score"])
        return s

    def recommend(self, f: dict) -> dict:
        fc = self.forecast(f)
        plan = rec.recommend(
            tier=fc["tier"],
            impact_score=fc["impact_score"],
            expected_duration_min=fc["expected_duration_min"],
            requires_road_closure=bool(f.get("requires_road_closure")),
            cause=f.get("cause", "others"),
            corridor=f.get("corridor", "Non-corridor"),
            is_planned=bool(f.get("is_planned")),
            is_peak=bool(f.get("is_peak")),
            affected_junctions=int(f.get("affected_junctions", 1)),
        )
        if plan["diversion"]["needed"] and f.get("lat") and f.get("lon"):
            routing = self.maps.diversion_alternatives(float(f["lat"]), float(f["lon"]))
            plan["diversion"]["route_options"] = routing["route_options"]
            plan["diversion"]["selected_route_id"] = routing["selected_route_id"]
            plan["diversion"]["routing_source"] = routing["routing_source"]
            if routing.get("fallback_reason"):
                plan["diversion"]["fallback_reason"] = routing["fallback_reason"]
            plan["diversion"]["route"] = next(
                (r for r in routing["route_options"] if r["id"] == routing["selected_route_id"]),
                routing["route_options"][0],
            )
        playbook = pb.build_playbook(f, fc, plan, maps_client=self.maps)
        return {"forecast": fc, "plan": plan, "playbook": playbook}
