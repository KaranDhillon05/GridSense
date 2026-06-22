#!/usr/bin/env python3
"""Build a REAL Bengaluru road-network graph artifact from OpenStreetMap.

Replaces the 14-node hand-typed synthetic graph (build_road_graph.py) with a
topologically-correct, city-wide routable graph derived from OSM via the Overpass
API. This is the foundation for map-intelligence routing (real approaches,
diversions, emergency corridors, barricade cut-edges) — no hardcoded geometry.

Run OFFLINE (never at request time):  python build_osm_graph.py
Outputs: web/src/data/blr_road_graph.json  = { meta, nodes, edges, hospitals }

Design:
  • Query motorway..tertiary (+ _link) over Greater Bengaluru, chunked into a grid
    so each Overpass request stays small and reliable; ways deduped by id.
  • Intersection = an OSM node shared by >=2 ways (or a way endpoint). Ways are
    split at intersections into edges between consecutive intersections.
  • Edge attrs: length_m (haversine over the polyline), road_class, lanes, oneway
    (directed edges), base_capacity_vph = per-lane capacity x lanes, geometry
    (Douglas-Peucker-simplified, 5dp). Same GraphNode/GraphEdge shape as the web app.
  • hospitals: amenity=hospital centroids (for the reserved emergency corridor).
"""
from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "src" / "data" / "blr_road_graph.json"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Greater Bengaluru bounding box.
BBOX = {"min_lat": 12.80, "max_lat": 13.14, "min_lon": 77.45, "max_lon": 77.75}
GRID = 3  # split bbox into GRID x GRID tiles for reliable Overpass requests

HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"

# OSM highway -> our road_class (matches web/src/lib/roadGraph.ts GraphEdge).
CLASS_MAP = {
    "motorway": "arterial", "motorway_link": "arterial",
    "trunk": "arterial", "trunk_link": "arterial",
    "primary": "arterial", "primary_link": "arterial",
    "secondary": "sub_arterial", "secondary_link": "sub_arterial",
    "tertiary": "collector", "tertiary_link": "collector",
}
# Per-lane saturation capacity (vph) by class.
LANE_CAP = {"arterial": 1900, "sub_arterial": 1500, "collector": 1100, "local": 700}
DEFAULT_LANES = {"arterial": 2, "sub_arterial": 2, "collector": 1, "local": 1}

SIMPLIFY_TOL_M = 18.0  # Douglas-Peucker tolerance


def haversine_m(a_lat, a_lon, b_lat, b_lon):
    R = 6371000.0
    dlat = math.radians(b_lat - a_lat)
    dlon = math.radians(b_lon - a_lon)
    x = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def overpass(query: str) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for ep in OVERPASS_ENDPOINTS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    ep, data=data, headers={"User-Agent": "GridSense/1.0 (BTP traffic planning research)"}
                )
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.load(r)
            except Exception as ex:  # noqa: BLE001
                last = ex
                print(f"  overpass {ep} attempt {attempt+1} failed: {ex}")
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"All Overpass endpoints failed: {last}")


def fetch_ways():
    """Fetch road ways across the bbox grid, deduped by way id."""
    ways: dict[int, dict] = {}
    dlat = (BBOX["max_lat"] - BBOX["min_lat"]) / GRID
    dlon = (BBOX["max_lon"] - BBOX["min_lon"]) / GRID
    for i in range(GRID):
        for j in range(GRID):
            s = BBOX["min_lat"] + i * dlat
            n = s + dlat
            w = BBOX["min_lon"] + j * dlon
            e = w + dlon
            q = (f'[out:json][timeout:180];way["highway"~"^({HIGHWAYS})$"]'
                 f'({s:.5f},{w:.5f},{n:.5f},{e:.5f});out geom;')
            print(f"tile {i*GRID+j+1}/{GRID*GRID} bbox=({s:.3f},{w:.3f},{n:.3f},{e:.3f})")
            res = overpass(q)
            for el in res.get("elements", []):
                if el.get("type") == "way" and "geometry" in el and "nodes" in el:
                    ways[el["id"]] = el
            print(f"  cumulative ways: {len(ways)}")
            time.sleep(2)
    return list(ways.values())


def fetch_hospitals():
    s, w, n, e = BBOX["min_lat"], BBOX["min_lon"], BBOX["max_lat"], BBOX["max_lon"]
    q = (f'[out:json][timeout:120];('
         f'node["amenity"="hospital"]({s},{w},{n},{e});'
         f'way["amenity"="hospital"]({s},{w},{n},{e}););out center;')
    res = overpass(q)
    out = []
    for el in res.get("elements", []):
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        name = (el.get("tags") or {}).get("name")
        if lat and lon and name:
            out.append({"id": f"hosp_{el['id']}", "name": name,
                        "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def _perp_dist_m(p, a, b):
    """Perpendicular distance (m) of point p from segment a-b, in local planar approx."""
    mlat = 111320.0
    mlon = 111320.0 * math.cos(math.radians(a[0]))
    ax, ay = a[1] * mlon, a[0] * mlat
    bx, by = b[1] * mlon, b[0] * mlat
    px, py = p[1] * mlon, p[0] * mlat
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / seg2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(coords, tol=SIMPLIFY_TOL_M):
    """Douglas-Peucker on [[lat,lon],...]; keeps endpoints."""
    if len(coords) < 3:
        return coords
    dmax, idx = 0.0, 0
    for i in range(1, len(coords) - 1):
        d = _perp_dist_m(coords[i], coords[0], coords[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = simplify(coords[:idx + 1], tol)
        right = simplify(coords[idx:], tol)
        return left[:-1] + right
    return [coords[0], coords[-1]]


def parse_lanes(tags, road_class):
    raw = tags.get("lanes")
    try:
        if raw:
            return max(1, int(float(str(raw).split(";")[0])))
    except (ValueError, TypeError):
        pass
    return DEFAULT_LANES[road_class]


def build():
    ways = fetch_ways()
    print(f"Fetched {len(ways)} unique road ways. Detecting intersections…")

    # Count node usage across ways -> intersections are nodes used by >=2 ways
    # (plus every way's own endpoints).
    node_use: dict[int, int] = {}
    node_ll: dict[int, tuple] = {}
    for w in ways:
        for nid, g in zip(w["nodes"], w["geometry"]):
            node_use[nid] = node_use.get(nid, 0) + 1
            node_ll[nid] = (g["lat"], g["lon"])

    nodes_out: dict[str, dict] = {}
    edges_out: list[dict] = []
    eid = 0

    def node_id(osm_nid):
        key = f"n{osm_nid}"
        if key not in nodes_out:
            lat, lon = node_ll[osm_nid]
            nodes_out[key] = {"id": key, "lat": round(lat, 5), "lon": round(lon, 5)}
        return key

    for w in ways:
        tags = w.get("tags", {})
        hw = tags.get("highway")
        road_class = CLASS_MAP.get(hw, "collector")
        lanes = parse_lanes(tags, road_class)
        cap = LANE_CAP[road_class] * lanes
        name = tags.get("name") or tags.get("ref") or f"{road_class.replace('_', ' ')} road"
        oneway = str(tags.get("oneway", "")).lower() in ("yes", "true", "1") or hw in (
            "motorway", "motorway_link", "trunk_link", "primary_link")
        allows_heavy = road_class != "local"

        nids = w["nodes"]
        geom = w["geometry"]  # list of {lat,lon}, aligned with nids
        # Split the way at intersection nodes into segments between intersections.
        seg_start = 0
        for k in range(1, len(nids)):
            is_split = (k == len(nids) - 1) or node_use.get(nids[k], 0) >= 2
            if not is_split:
                continue
            sub_n = nids[seg_start:k + 1]
            sub_g = geom[seg_start:k + 1]
            seg_start = k
            if len(sub_n) < 2:
                continue
            a_key = node_id(sub_n[0])
            b_key = node_id(sub_n[-1])
            if a_key == b_key:
                continue
            coords = [[g["lat"], g["lon"]] for g in sub_g]
            length_m = sum(
                haversine_m(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
                for i in range(1, len(coords))
            )
            if length_m < 1:
                continue
            simp = simplify(coords)
            # geometry stored as [lon,lat] to match GraphEdge in the web app
            geo_lonlat = [[round(c[1], 5), round(c[0], 5)] for c in simp]

            def mk(_a, _b, _geo, suffix=""):
                nonlocal eid
                eid += 1
                return {
                    "id": f"e{eid}{suffix}",
                    "from": _a, "to": _b,
                    "name": name,
                    "length_m": round(length_m),
                    "lanes": lanes,
                    "road_class": road_class,
                    "base_capacity_vph": cap,
                    "allows_heavy_vehicle": allows_heavy,
                    "geometry": _geo,
                }

            edges_out.append(mk(a_key, b_key, geo_lonlat))
            if not oneway:
                edges_out.append(mk(b_key, a_key, list(reversed(geo_lonlat))))

    hospitals = fetch_hospitals()
    artifact = {
        "meta": {
            "source": "openstreetmap_overpass",
            "bbox": BBOX,
            "highways": HIGHWAYS,
            "node_count": len(nodes_out),
            "edge_count": len(edges_out),
            "hospital_count": len(hospitals),
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "nodes": list(nodes_out.values()),
        "edges": edges_out,
        "hospitals": hospitals,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(artifact, separators=(",", ":")))
    size_mb = OUT.stat().st_size / 1e6
    print(f"\nWrote {OUT}")
    print(f"  nodes={len(nodes_out)}  edges={len(edges_out)}  hospitals={len(hospitals)}  size={size_mb:.1f} MB")


if __name__ == "__main__":
    build()
