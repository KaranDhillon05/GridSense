"""Build a SUMO network (blr_cbd.net.xml) from the CBD crop of sim_network_real.json.

Writes custom .nod.xml + .edg.xml in the engine's flat-earth metre frame, then
runs netconvert. Skips cleanly (exit 0) if SUMO isn't installed.

    python gridsense/ml/sumo/build_sumo_net.py
"""

import subprocess
import sys
import xml.etree.ElementTree as ET

from common import OUT_DIR, ROAD, load_cbd_crop, projector, sumo_bin


def _indent_write(root, path):
    ET.indent(root)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def main():
    netconvert = sumo_bin("netconvert")
    if not netconvert:
        print("[build_sumo_net] SUMO not installed — skipping (using committed ground truth).")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    nodes, edges = load_cbd_crop()
    proj = projector()
    print(f"[build_sumo_net] CBD crop: {len(nodes)} nodes, {len(edges)} edges")

    # --- nodes ---
    nroot = ET.Element("nodes")
    for n in nodes:
        x, y = proj(n["lat"], n["lon"])
        ET.SubElement(
            nroot, "node",
            id=n["id"], x=f"{x:.2f}", y=f"{y:.2f}",
            type="traffic_light" if n.get("signalized") else "priority",
        )
    nod_path = OUT_DIR / "blr_cbd.nod.xml"
    _indent_write(nroot, nod_path)

    # --- edges (already directed) ---
    eroot = ET.Element("edges")
    for e in edges:
        speed, prio = ROAD.get(e["road_class"], ROAD["local"])
        shape = " ".join(
            f"{proj(lat, lon)[0]:.2f},{proj(lat, lon)[1]:.2f}"
            for lon, lat in e["geometry"]
        )
        ET.SubElement(
            eroot, "edge",
            id=e["id"], **{"from": e["from"]}, to=e["to"],
            numLanes=str(max(1, int(e["lanes"]))),
            speed=f"{speed:.1f}", priority=str(prio), shape=shape,
        )
    edg_path = OUT_DIR / "blr_cbd.edg.xml"
    _indent_write(eroot, edg_path)

    net_path = OUT_DIR / "blr_cbd.net.xml"
    cmd = [
        netconvert,
        "--node-files", str(nod_path),
        "--edge-files", str(edg_path),
        "--output-file", str(net_path),
        "--tls.guess", "false",          # keep our explicit signalized nodes
        "--no-turnarounds", "true",
        "--junctions.corner-detail", "5",
        "--offset.disable-normalization", "true",
    ]
    print("[build_sumo_net] running netconvert…")
    res = subprocess.run(cmd, capture_output=True, text=True)
    # netconvert warns liberally on cropped fringes; only fail on a real error.
    warns = [l for l in res.stderr.splitlines() if l.strip()]
    if res.returncode != 0:
        print(res.stderr)
        print("[build_sumo_net] netconvert FAILED")
        return 1
    print(f"[build_sumo_net] wrote {net_path.name} ({len(warns)} netconvert notices)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
