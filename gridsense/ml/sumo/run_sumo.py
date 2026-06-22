"""Run SUMO headless on the CBD network + demand, parse tripinfo/edgedata into
ground_truth_cbd.json (committed). Skips cleanly if SUMO is absent — the existing
ground truth then stays the calibration reference.

    python gridsense/ml/sumo/run_sumo.py
"""

import json
import subprocess
import sys
import xml.etree.ElementTree as ET

from common import (
    HERE, OUT_DIR, SEED, SIM_STEP, SPAWN_PER_MIN, WARMUP_S, WINDOW_S,
    sumo_bin,
)

GROUND_TRUTH = HERE / "ground_truth_cbd.json"


def write_edgedata_add():
    """Additional file: aggregate edge stats over the measurement window only."""
    add = OUT_DIR / "edgedata.add.xml"
    root = ET.Element("additional")
    ET.SubElement(
        root, "edgeData", id="cbd", file="edgedata.xml",
        begin=str(WARMUP_S), end=str(WARMUP_S + WINDOW_S),
        excludeEmpty="true",
    )
    ET.indent(root)
    ET.ElementTree(root).write(add, encoding="utf-8", xml_declaration=True)
    return add


def parse(tripinfo_path, edgedata_path):
    # --- per-trip (only trips that depart within the window) ---
    travel, loss, wait, count = 0.0, 0.0, 0.0, 0
    arrived = 0
    for ti in ET.parse(tripinfo_path).getroot().findall("tripinfo"):
        depart = float(ti.get("depart", 0))
        if depart < WARMUP_S:
            continue
        travel += float(ti.get("duration", 0))
        loss += float(ti.get("timeLoss", 0))
        wait += float(ti.get("waitingTime", 0))
        count += 1
        arrived += 1
    win_min = WINDOW_S / 60.0
    net = {
        "meanTravelTimeMin": round(travel / count / 60, 3) if count else 0,
        "totalDelayVehMin": round(loss / 60, 3),
        "throughputPerMin": round(arrived / win_min, 2),
        "meanWaitMin": round(wait / count / 60, 3) if count else 0,
        "tripCount": count,
    }

    # --- per-edge speeds + queues from edgeData ---
    per_edge = {}
    speeds, max_q = [], 0.0
    root = ET.parse(edgedata_path).getroot()
    for interval in root.findall("interval"):
        for e in interval.findall("edge"):
            eid = e.get("id")
            spd = float(e.get("speed", 0))            # m/s
            occ = float(e.get("occupancy", 0))         # %
            wt = float(e.get("waitingTime", 0))
            speeds.append(spd)
            per_edge[eid] = {
                "speedKmh": round(spd * 3.6, 2),
                "occupancyPct": round(occ, 2),
                "waitingTime": round(wt, 1),
            }
            # rough queue proxy: occupancy * edge length (length unknown here → occ)
            max_q = max(max_q, occ)
    net["meanSpeedKmh"] = round(sum(speeds) / len(speeds) * 3.6, 2) if speeds else 0
    net["maxOccupancyPct"] = round(max_q, 2)
    return net, per_edge


def main():
    sumo = sumo_bin("sumo")
    net_path = OUT_DIR / "blr_cbd.net.xml"
    rou_path = OUT_DIR / "blr_cbd.rou.xml"
    if not sumo or not net_path.exists() or not rou_path.exists():
        print("[run_sumo] SUMO/inputs missing — skipping; committed ground truth stays the reference.")
        return 0

    add = write_edgedata_add()
    tripinfo = OUT_DIR / "tripinfo.xml"
    cmd = [
        sumo, "-n", str(net_path), "-r", str(rou_path),
        "--additional-files", str(add),
        "--tripinfo-output", str(tripinfo),
        "--step-length", str(SIM_STEP),
        "--begin", "0", "--end", str(WARMUP_S + WINDOW_S),
        "--seed", str(SEED), "--no-step-log", "true",
        "--time-to-teleport", "120", "--ignore-route-errors", "true",
    ]
    print("[run_sumo] running SUMO headless…")
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=str(OUT_DIR))
    if res.returncode != 0:
        print(res.stderr[-2000:])
        print("[run_sumo] SUMO FAILED")
        return 1

    net, per_edge = parse(tripinfo, OUT_DIR / "edgedata.xml")
    out = {
        "meta": {
            "source": "SUMO ground truth (CBD crop of sim_network_real.json)",
            "bbox": {"min_lat": 12.965, "max_lat": 12.985, "min_lon": 77.595, "max_lon": 77.615},
            "seed": SEED, "spawnPerMin": SPAWN_PER_MIN,
            "warmupS": WARMUP_S, "windowS": WINDOW_S, "stepLength": SIM_STEP,
            "sumoVersion": "1.27.0",
        },
        "network": net,
        "perEdge": per_edge,
    }
    GROUND_TRUTH.write_text(json.dumps(out, indent=2))
    print(f"[run_sumo] wrote {GROUND_TRUTH.name}")
    print(f"[run_sumo] network: {json.dumps(net)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
