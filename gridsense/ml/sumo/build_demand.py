"""Generate SUMO demand (blr_cbd.rou.xml) matching the TS engine's demand.

OD = trips between CBD source nodes; rate = SPAWN_PER_MIN; vType mix + lengths +
IDM params mirror demand.ts / carFollowing.ts. Trips are routed with duarouter
over the built network. Skips cleanly if SUMO is absent.

    python gridsense/ml/sumo/build_demand.py
"""

import random
import subprocess
import sys
import xml.etree.ElementTree as ET

import sumolib  # type: ignore

from common import (
    IDM, OUT_DIR, SEED, SPAWN_PER_MIN, VTYPES, WARMUP_S, WINDOW_S,
    load_cbd_crop, sumo_bin,
)


def main():
    duarouter = sumo_bin("duarouter")
    net_path = OUT_DIR / "blr_cbd.net.xml"
    if not duarouter or not net_path.exists():
        print("[build_demand] SUMO/net missing — skipping (using committed ground truth).")
        return 0

    net = sumolib.net.readNet(str(net_path))
    nodes, edges = load_cbd_crop()
    # Source node -> a SUMO edge departing it (vehicles depart on edges).
    out_edge = {}
    for e in edges:
        out_edge.setdefault(e["from"], e["id"])
    src = [n["id"] for n in nodes if n.get("kind") == "source" and n["id"] in out_edge]
    # Valid edge ids present in the built net (some fringe edges may be dropped).
    net_edges = {e.getID() for e in net.getEdges()}
    src_edges = [out_edge[s] for s in src if out_edge[s] in net_edges]
    sink_edges = [e["id"] for e in edges if e["id"] in net_edges]
    if len(src_edges) < 2 or not sink_edges:
        print("[build_demand] too few routable sources — skipping.")
        return 0

    rng = random.Random(SEED)
    total_s = WARMUP_S + WINDOW_S
    n_veh = int(SPAWN_PER_MIN / 60 * total_s)

    root = ET.Element("routes")
    for tid, _share, length, vmax in VTYPES:
        ET.SubElement(
            root, "vType", id=tid, length=f"{length}", maxSpeed=f"{vmax}",
            carFollowModel="IDM", accel=str(IDM["accel"]), decel=str(IDM["decel"]),
            tau=str(IDM["tau"]), minGap=str(IDM["minGap"]),
        )
    # cumulative shares for typed sampling
    cum, acc = [], 0.0
    for tid, share, *_ in VTYPES:
        acc += share
        cum.append((acc, tid))

    def pick_type():
        r = rng.random()
        for thresh, tid in cum:
            if r <= thresh:
                return tid
        return cum[-1][1]

    trips = []
    for i in range(n_veh):
        frm = rng.choice(src_edges)
        to = rng.choice(sink_edges)
        if to == frm:
            continue
        depart = rng.uniform(0, total_s)
        trips.append((depart, i, frm, to, pick_type()))
    trips.sort()
    for depart, i, frm, to, tid in trips:
        ET.SubElement(
            root, "trip", id=f"v{i}", type=tid, depart=f"{depart:.1f}",
            **{"from": frm}, to=to, departLane="best", departSpeed="max",
        )

    trips_path = OUT_DIR / "blr_cbd.trips.xml"
    ET.indent(root)
    ET.ElementTree(root).write(trips_path, encoding="utf-8", xml_declaration=True)

    rou_path = OUT_DIR / "blr_cbd.rou.xml"
    cmd = [
        duarouter, "-n", str(net_path), "--route-files", str(trips_path),
        "-o", str(rou_path), "--ignore-errors", "true",
        "--no-step-log", "true", "--seed", str(SEED),
    ]
    print(f"[build_demand] routing {len(trips)} trips with duarouter…")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr)
        print("[build_demand] duarouter FAILED")
        return 1
    print(f"[build_demand] wrote {rou_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
