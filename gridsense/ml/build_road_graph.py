#!/usr/bin/env python3
"""Build a venue-centric Bengaluru road graph artifact for GridSense traffic planning.

Produces web/src/data/road_graph.json with nodes/edges around CBD and Chinnaswamy.
Run: python build_road_graph.py
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "src" / "data" / "road_graph.json"

# Chinnaswamy / CBD core network (simplified OSM-style topology)
NODES = [
    {"id": "venue_chinnaswamy", "lat": 12.9788, "lon": 77.5996, "name": "Chinnaswamy Stadium"},
    {"id": "mg_trinity", "lat": 12.9765, "lon": 77.6018, "name": "Trinity Circle"},
    {"id": "mg_queens", "lat": 12.9738, "lon": 77.5985, "name": "Queens Circle"},
    {"id": "mg_cubbon_gate", "lat": 12.9762, "lon": 77.5958, "name": "Cubbon Park Gate"},
    {"id": "kasturba_mayo", "lat": 12.9745, "lon": 77.5925, "name": "Mayo Hall Junction"},
    {"id": "kasturba_south", "lat": 12.9688, "lon": 77.5912, "name": "Kasturba Road South"},
    {"id": "cubbon_east", "lat": 12.9802, "lon": 77.6045, "name": "Cubbon Road East"},
    {"id": "cubbon_west", "lat": 12.9795, "lon": 77.5938, "name": "Cubbon Road West"},
    {"id": "queens_west", "lat": 12.9718, "lon": 77.5948, "name": "Queens Road West"},
    {"id": "mg_north", "lat": 12.9825, "lon": 77.6002, "name": "MG Road North"},
    {"id": "irr_east", "lat": 12.9810, "lon": 77.6080, "name": "IRR East Feeder"},
    {"id": "irr_west", "lat": 12.9770, "lon": 77.5865, "name": "IRR West Feeder"},
    {"id": "hosur_feeder", "lat": 12.9650, "lon": 77.6010, "name": "Hosur Road Feeder"},
    {"id": "emergency_bay", "lat": 12.9778, "lon": 77.6008, "name": "Ambulance Staging"},
]

CAPACITY = {
    "arterial": 1800,
    "collector": 1200,
    "local": 600,
}


def edge(eid, fr, to, name, road_class, lanes=2, oneway=False):
    a = next(n for n in NODES if n["id"] == fr)
    b = next(n for n in NODES if n["id"] == to)
    dx = (b["lon"] - a["lon"]) * 111320 * 0.85
    dy = (b["lat"] - a["lat"]) * 111320
    length_m = round((dx * dx + dy * dy) ** 0.5)
    geom = [[a["lon"], a["lat"]], [b["lon"], b["lat"]]]
    cap = CAPACITY[road_class] * lanes
    edges = [{
        "id": eid,
        "from": fr,
        "to": to,
        "name": name,
        "length_m": max(length_m, 120),
        "lanes": lanes,
        "road_class": road_class,
        "base_capacity_vph": cap,
        "allows_heavy_vehicle": road_class != "local",
        "geometry": geom,
    }]
    if not oneway:
        edges.append({
            "id": f"{eid}_rev",
            "from": to,
            "to": fr,
            "name": name,
            "length_m": max(length_m, 120),
            "lanes": lanes,
            "road_class": road_class,
            "base_capacity_vph": cap,
            "allows_heavy_vehicle": road_class != "local",
            "geometry": list(reversed(geom)),
        })
    return edges


def main():
    edges = []
    edges += edge("e_mg_trinity_queens", "mg_trinity", "mg_queens", "MG Road", "arterial", 3)
    edges += edge("e_mg_queens_cubbon", "mg_queens", "mg_cubbon_gate", "MG Road", "arterial", 3)
    edges += edge("e_mg_cubbon_venue", "mg_cubbon_gate", "venue_chinnaswamy", "Stadium Approach", "collector", 2)
    edges += edge("e_cubbon_east_west", "cubbon_east", "cubbon_west", "Cubbon Road", "arterial", 2)
    edges += edge("e_cubbon_west_venue", "cubbon_west", "venue_chinnaswamy", "Cubbon Feeder", "collector", 2)
    edges += edge("e_cubbon_east_irr", "irr_east", "cubbon_east", "Cubbon East Link", "arterial", 2)
    edges += edge("e_kasturba_mayo_south", "kasturba_mayo", "kasturba_south", "Kasturba Road", "arterial", 2)
    edges += edge("e_kasturba_mayo_cubbon", "kasturba_mayo", "mg_cubbon_gate", "Kasturba Connector", "collector", 2)
    edges += edge("e_queens_west_queens", "queens_west", "mg_queens", "Queens Road", "collector", 2)
    edges += edge("e_queens_venue", "mg_queens", "venue_chinnaswamy", "Queens Stadium Link", "local", 1, oneway=True)
    edges += edge("e_mg_north_trinity", "mg_north", "mg_trinity", "MG Road North", "arterial", 3)
    edges += edge("e_irr_west_kasturba", "irr_west", "kasturba_mayo", "IRR West", "arterial", 2)
    edges += edge("e_hosur_queens", "hosur_feeder", "mg_queens", "Hosur Feeder", "arterial", 2)
    edges += edge("e_emergency_venue", "emergency_bay", "venue_chinnaswamy", "Emergency Access", "local", 1, oneway=True)
    edges += edge("e_emergency_mg", "mg_trinity", "emergency_bay", "Emergency MG Link", "local", 1, oneway=True)

    artifact = {
        "meta": {
            "source": "synthetic_osm_cbd_chinnaswamy",
            "bbox": {"min_lat": 12.964, "max_lat": 12.984, "min_lon": 77.585, "max_lon": 77.610},
            "node_count": len(NODES),
            "edge_count": len(edges),
        },
        "nodes": NODES,
        "edges": edges,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(artifact, indent=2))
    print(f"Wrote {OUT} ({len(NODES)} nodes, {len(edges)} edges)")


if __name__ == "__main__":
    main()
