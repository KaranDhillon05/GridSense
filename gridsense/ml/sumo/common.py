"""Shared helpers for the SUMO ground-truth pipeline (offline, dev-only).

The pipeline builds a SUMO network from a CBD crop of sim_network_real.json —
the network the realism engine actually runs (/map-sim). We deliberately build
from our cleaned graph (custom .nod/.edg) rather than raw OSM so SUMO and the TS
engine simulate the SAME network; residual error is then junction/signal
modeling, which is what calibration hunts.

Projection: the TS engine uses a flat-earth frame (metres). We reproduce it
exactly so edge lengths match — x = (lon-lon0)*111320*cos(lat0), y =
(lat-lat0)*111320 — with the crop's min corner as origin.

Graceful degradation: callers check sumo_bin(); if SUMO is absent they skip and
fall back to the committed ground_truth_cbd.json.
"""

import json
import math
import os
import shutil
from pathlib import Path

# CBD bbox — keep in sync with build_sim_network.py and scripts/cbd-crop.mjs.
BBOX = dict(min_lat=12.965, max_lat=12.985, min_lon=77.595, max_lon=77.615)

# Repo-relative paths.
HERE = Path(__file__).resolve().parent
REAL_NET = HERE.parent.parent / "web" / "public" / "sim_network_real.json"
OUT_DIR = HERE / "out"

# road_class -> (SUMO edge speed m/s, priority). Mirrors engine ROAD_PRIORITY +
# desiredSpeed road-class scaling intent.
ROAD = {
    "motorway": (22.0, 5),
    "arterial": (16.7, 4),
    "sub_arterial": (14.0, 3),
    "collector": (11.0, 2),
    "local": (8.3, 1),
}

# Vehicle mix (must match demand.ts MIX + types.ts lengths/desired speeds).
# (typeId, share, length_m, maxSpeed m/s)
VTYPES = [
    ("car", 0.56, 4.5, 16.7),
    ("auto", 0.26, 3.2, 12.0),
    ("bus", 0.10, 12.0, 11.0),
    ("truck", 0.08, 8.0, 11.0),
]

# IDM params shared with carFollowing.ts DEFAULT_IDM.
IDM = dict(accel=1.6, decel=2.2, tau=1.3, minGap=2.2)

SEED = 1337
SPAWN_PER_MIN = 30
WARMUP_S = 44          # 220 steps * 0.2 s
WINDOW_S = 600
SIM_STEP = 0.2


def in_bbox(lat, lon, b=BBOX):
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def sumo_bin(name):
    """Resolve a SUMO binary via sumolib/$SUMO_HOME/PATH, or None if unavailable."""
    try:
        import sumolib  # noqa
        p = sumolib.checkBinary(name)
        if p and (os.path.isabs(p) and os.path.exists(p) or shutil.which(p)):
            return p
    except Exception:
        pass
    return shutil.which(name)


def load_cbd_crop(b=BBOX):
    """Induced subgraph of sim_network_real.json inside the CBD bbox."""
    data = json.loads(REAL_NET.read_text())
    keep, nodes = set(), []
    for n in data["nodes"]:
        if in_bbox(n["lat"], n["lon"], b):
            keep.add(n["id"])
            nodes.append(n)
    edges = [e for e in data["edges"] if e["from"] in keep and e["to"] in keep]
    # ensure some sources for demand
    if not any(n.get("kind") == "source" for n in nodes):
        outdeg = {}
        for e in edges:
            outdeg[e["from"]] = outdeg.get(e["from"], 0) + 1
        for n in nodes:
            if outdeg.get(n["id"], 0) >= 1:
                n["kind"] = "source"
            if sum(1 for x in nodes if x.get("kind") == "source") >= 40:
                break
    return nodes, edges


def projector(b=BBOX):
    """Return f(lat, lon) -> (x, y) metres in the engine's flat-earth frame."""
    lat0, lon0 = b["min_lat"], b["min_lon"]
    m_per_lon = 111320.0 * math.cos(math.radians((b["min_lat"] + b["max_lat"]) / 2))

    def f(lat, lon):
        return ((lon - lon0) * m_per_lon, (lat - lat0) * 111320.0)

    return f
