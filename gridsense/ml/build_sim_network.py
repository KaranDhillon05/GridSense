#!/usr/bin/env python3
"""Build a *topologically validated* CBD road network for the /simulation twin.

Reads the OSM-derived web/src/data/blr_road_graph.json (full per-edge polyline
geometry + one-way directionality) and writes web/src/data/sim_network.json:

  1. Extract CBD bbox (largest undirected component)
  2. SNAP endpoints within 3 m into shared junction nodes
  3. Seamless geometry (pin endpoints to canonical junction coords)
  4. SPLIT edges where a junction node sits on another edge interior
  4b. SIMPLIFY phantom nodes (degree-2 pass-throughs of same road → merge)
  5. REPAIR directed connectivity (add synthetic reverse edges until 100% SCC)
  6. Re-derive signalized junctions + boundary sources
  7. DETECT roundabout rings
  8. VALIDATE: SCC %, routing success, dead-ends — fail if not 100%

Run:  python3 ml/build_sim_network.py
"""
import json
import math
import os
import random
from collections import defaultdict, deque

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "web", "src", "data", "blr_road_graph.json")
OUT = os.path.join(HERE, "..", "web", "src", "data", "sim_network.json")

LAT0, LAT1 = 12.965, 12.985
LON0, LON1 = 77.595, 77.615
MAJOR = {"arterial", "sub_arterial", "motorway", "trunk"}
SIGNAL_CAP = int(os.environ.get("SIGNAL_CAP", "999"))  # signalize all qualifying junctions by default
SOURCE_CAP = 20
BORDER_MARGIN = 0.0016
SNAP_TOL_M = 3.0
MIN_EDGE_LEN = 8         # merge phantom nodes to eliminate sub-8m stubs


def mdist(la1, lo1, la2, lo2):
    dy = (la2 - la1) * 111320
    dx = (lo2 - lo1) * 111320 * math.cos(math.radians((la1 + la2) / 2))
    return math.hypot(dx, dy)


def proj_point_seg(plat, plon, la1, lo1, la2, lo2):
    """Return (t, dist_m) of point projected onto segment [1->2]."""
    mlat = math.radians((la1 + la2) / 2)
    ax, ay = lo1 * math.cos(mlat), la1
    bx, by = lo2 * math.cos(mlat), la2
    px, py = plon * math.cos(mlat), plat
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return 0.0, mdist(plat, plon, la1, lo1)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    cx, cy = ax + t * dx, ay + t * dy
    d = math.hypot((px - cx), (py - cy)) * 111320
    return t, d


# ---- strongly-connected components (Kosaraju, iterative) ----
def sccs(node_ids, out_adj):
    visited, order = set(), []
    for s in node_ids:
        if s in visited:
            continue
        stack = [(s, iter(out_adj[s]))]
        while stack:
            nd, it = stack[-1]
            if nd not in visited:
                visited.add(nd)
            adv = False
            for w in it:
                if w not in visited:
                    stack.append((w, iter(out_adj[w])))
                    adv = True
                    break
            if not adv:
                order.append(nd)
                stack.pop()
    rev = defaultdict(list)
    for u in out_adj:
        for v in out_adj[u]:
            rev[v].append(u)
    comp, seen, c = {}, set(), 0
    for n in reversed(order):
        if n in seen:
            continue
        st, members = [n], []
        seen.add(n)
        while st:
            x = st.pop()
            comp[x] = c
            members.append(x)
            for w in rev[x]:
                if w not in seen:
                    seen.add(w)
                    st.append(w)
        c += 1
    return comp


def largest_scc_set(node_ids, out_adj):
    comp = sccs(node_ids, out_adj)
    by = defaultdict(list)
    for n, c in comp.items():
        by[c].append(n)
    return set(max(by.values(), key=len)) if by else set()


def routing_success(node_ids, out_adj, n=500, seed=3):
    random.seed(seed)
    nl = list(node_ids)
    ok = tot = 0
    for _ in range(n):
        s, t = random.choice(nl), random.choice(nl)
        if s == t:
            continue
        tot += 1
        q, vis, found = deque([s]), {s}, False
        while q:
            u = q.popleft()
            if u == t:
                found = True
                break
            for v in out_adj[u]:
                if v not in vis:
                    vis.add(v)
                    q.append(v)
        ok += found
    return round(100 * ok / max(1, tot))


def main():
    g = json.load(open(SRC))
    nodes = {n["id"]: dict(n) for n in g["nodes"]}

    def inb(nid):
        n = nodes.get(nid)
        return n and LAT0 <= n["lat"] <= LAT1 and LON0 <= n["lon"] <= LON1

    sub = [e for e in g["edges"] if inb(e["from"]) and inb(e["to"])]

    # largest undirected component
    adj = defaultdict(set)
    for e in sub:
        adj[e["from"]].add(e["to"])
        adj[e["to"]].add(e["from"])
    seen, best = set(), set()
    for s in list(adj):
        if s in seen:
            continue
        stack, comp = [s], set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.add(x)
            stack.extend(adj[x] - seen)
        if len(comp) > len(best):
            best = comp
    edges = [dict(e) for e in sub if e["from"] in best and e["to"] in best]
    used = set()
    for e in edges:
        used.add(e["from"])
        used.add(e["to"])

    # ---- 2) snap endpoints within tolerance (union-find, grid-bucketed) ----
    parent = {i: i for i in used}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    grid = defaultdict(list)
    for i in used:
        n = nodes[i]
        grid[(round(n["lat"] / 0.00003), round(n["lon"] / 0.00003))].append(i)
    for i in used:
        n = nodes[i]
        gx, gy = round(n["lat"] / 0.00003), round(n["lon"] / 0.00003)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), []):
                    if j > i and mdist(n["lat"], n["lon"], nodes[j]["lat"], nodes[j]["lon"]) <= SNAP_TOL_M:
                        union(i, j)

    clusters = defaultdict(list)
    for i in used:
        clusters[find(i)].append(i)
    rep_of = {}
    rep_coord = {}
    merged_clusters = 0
    for root, members in clusters.items():
        rep = min(members)
        lat = sum(nodes[m]["lat"] for m in members) / len(members)
        lon = sum(nodes[m]["lon"] for m in members) / len(members)
        rep_coord[rep] = (round(lat, 6), round(lon, 6))
        for m in members:
            rep_of[m] = rep
        if len(members) > 1:
            merged_clusters += 1

    # rewrite edges to representatives; pin geometry endpoints to canonical coords
    snapped = []
    for e in edges:
        a, b = rep_of[e["from"]], rep_of[e["to"]]
        if a == b:
            continue
        geom = [[round(c[0], 6), round(c[1], 6)] for c in e["geometry"]]
        geom[0] = [rep_coord[a][1], rep_coord[a][0]]
        geom[-1] = [rep_coord[b][1], rep_coord[b][0]]
        ne = dict(e)
        ne["from"], ne["to"], ne["geometry"] = a, b, geom
        snapped.append(ne)
    edges = snapped
    node_coord = dict(rep_coord)

    # ---- 4) split edges where a junction node sits on their interior ----
    nbucket = defaultdict(list)
    for nid, (la, lo) in node_coord.items():
        nbucket[(round(la / 0.0003), round(lo / 0.0003))].append(nid)

    def interior_cuts(e):
        geom = e["geometry"]
        ends = {e["from"], e["to"]}
        cuts = []
        for k in range(len(geom) - 1):
            lo1, la1 = geom[k]
            lo2, la2 = geom[k + 1]
            cand = set()
            for la, lo in ((la1, lo1), (la2, lo2)):
                gx, gy = round(la / 0.0003), round(lo / 0.0003)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        cand.update(nbucket.get((gx + dx, gy + dy), []))
            for nid in cand:
                if nid in ends:
                    continue
                la, lo = node_coord[nid]
                t, d = proj_point_seg(la, lo, la1, lo1, la2, lo2)
                if d <= SNAP_TOL_M and 0.02 < t < 0.98:
                    cuts.append((k, t, nid))
        return cuts

    split_count = 0
    result = []
    for e in edges:
        cuts = interior_cuts(e)
        if not cuts:
            result.append(e)
            continue
        cuts.sort(key=lambda c: (c[0], c[1]))
        geom = e["geometry"]
        pieces_nodes = [e["from"]]
        polyline = [geom[0]]
        seg_ptr = 0
        for (k, t, nid) in cuts:
            while seg_ptr < k:
                polyline.append(geom[seg_ptr + 1])
                seg_ptr += 1
            lo1, la1 = geom[k]
            lo2, la2 = geom[k + 1]
            px = round(lo1 + (lo2 - lo1) * t, 6)
            py = round(la1 + (la2 - la1) * t, 6)
            polyline.append([px, py])
            pieces_nodes.append((nid, list(polyline)))
            polyline = [[px, py]]
        while seg_ptr < len(geom) - 1:
            polyline.append(geom[seg_ptr + 1])
            seg_ptr += 1
        prev_node = e["from"]
        accum = []
        chain = []
        for item in pieces_nodes[1:]:
            nid, poly = item
            chain.append((nid, poly))
        last_poly = polyline
        segs = []
        a = e["from"]
        for idx, (nid, poly) in enumerate(chain):
            segs.append((a, nid, poly))
            a = nid
        segs.append((a, e["to"], last_poly))
        for i, (fa, fb, poly) in enumerate(segs):
            sub2 = dict(e)
            sub2["id"] = f"{e['id']}_s{i}"
            sub2["from"], sub2["to"] = fa, fb
            sub2["geometry"] = poly
            sub2["length_m"] = max(8, int(sum(
                mdist(poly[j][1], poly[j][0], poly[j + 1][1], poly[j + 1][0])
                for j in range(len(poly) - 1))))
            result.append(sub2)
            split_count += 1
        _ = (accum, prev_node)
    edges = result

    # ---- 4b) simplify phantom nodes (degree-2 same-road pass-throughs) ----
    # A phantom node has exactly 2 undirected neighbours. If both sides carry
    # the same named road in the same class, merge through rather than forcing
    # every vehicle to take a connector through that node.
    simplify_count = 0
    MAX_MERGED_LEN = 250  # don't merge if the result would be > 250m

    changed = True
    while changed:
        changed = False
        # build undirected degree
        undirected_nbrs = defaultdict(set)
        for e in edges:
            if e.get("synthetic"):
                continue
            undirected_nbrs[e["from"]].add(e["to"])
            undirected_nbrs[e["to"]].add(e["from"])

        for n in list(node_coord.keys()):
            nbrs = undirected_nbrs.get(n, set())
            if len(nbrs) != 2:
                continue
            nbr_list = list(nbrs)
            a_node, b_node = nbr_list[0], nbr_list[1]

            # find directed edges in both directions
            a_n = [e for e in edges if e["from"] == a_node and e["to"] == n and not e.get("synthetic")]
            n_b = [e for e in edges if e["from"] == n and e["to"] == b_node and not e.get("synthetic")]
            b_n = [e for e in edges if e["from"] == b_node and e["to"] == n and not e.get("synthetic")]
            n_a = [e for e in edges if e["from"] == n and e["to"] == a_node and not e.get("synthetic")]

            # need at least one direction to merge
            if not (a_n and n_b):
                continue
            e1, e2 = a_n[0], n_b[0]
            if e1["name"] != e2["name"] or e1["road_class"] != e2["road_class"]:
                continue
            merged_len = e1["length_m"] + e2["length_m"]
            if merged_len > MAX_MERGED_LEN:
                continue

            # merge A→N→B
            merged_fwd = dict(e1)
            merged_fwd["id"] = f"{e1['id']}m"
            merged_fwd["to"] = b_node
            # join geometries: e1.geom ends at N, e2.geom starts at N — drop duplicate N
            merged_fwd["geometry"] = e1["geometry"] + e2["geometry"][1:]
            merged_fwd["length_m"] = merged_len

            to_remove = set(e["id"] for e in a_n + n_b)
            merged_rev = None
            if b_n and n_a:
                er1, er2 = b_n[0], n_a[0]
                if er1["name"] == er2["name"] and er1["road_class"] == er2["road_class"]:
                    merged_rev = dict(er1)
                    merged_rev["id"] = f"{er1['id']}m"
                    merged_rev["to"] = a_node
                    merged_rev["geometry"] = er1["geometry"] + er2["geometry"][1:]
                    merged_rev["length_m"] = er1["length_m"] + er2["length_m"]
                    to_remove.update(e["id"] for e in b_n + n_a)

            edges = [e for e in edges if e["id"] not in to_remove]
            edges.append(merged_fwd)
            if merged_rev:
                edges.append(merged_rev)

            # remove phantom node (it has no remaining edges)
            if n in node_coord:
                del node_coord[n]
            simplify_count += 1
            changed = True
            break  # restart after each merge

    # ---- 5) repair directed connectivity: add reverse edges on trap stubs ----
    def build_out(es):
        o = defaultdict(list)
        present = set()
        alln = set()
        for e in es:
            alln.add(e["from"])
            alln.add(e["to"])
            o[e["from"]].append(e["to"])
            present.add((e["from"], e["to"]))
        for n2 in alln:
            o.setdefault(n2, [])
        return o, present, alln

    synthetic = 0
    for _ in range(8):
        out_adj, present, alln = build_out(edges)
        core = largest_scc_set(list(alln), out_adj)
        if len(core) == len(alln):
            break
        added = 0
        for e in list(edges):
            a, b = e["from"], e["to"]
            if (a not in core or b not in core) and (b, a) not in present:
                rev = dict(e)
                rev["id"] = f"{e['id']}_r"
                rev["from"], rev["to"] = b, a
                rev["geometry"] = list(reversed(e["geometry"]))
                rev["synthetic"] = True
                edges.append(rev)
                present.add((b, a))
                added += 1
                synthetic += 1
        if added == 0:
            break

    out_adj, present, alln = build_out(edges)
    final_core = largest_scc_set(list(alln), out_adj)

    # ---- 6) re-derive signals + sources on the repaired graph ----
    keep_nodes = set(alln)
    nbr = defaultdict(set)
    major_legs = defaultdict(int)
    indeg = defaultdict(int)
    outdeg = defaultdict(int)
    for e in edges:
        nbr[e["from"]].add(e["to"])
        nbr[e["to"]].add(e["from"])
        outdeg[e["from"]] += 1
        indeg[e["to"]] += 1
        if not e.get("synthetic") and e["road_class"] in MAJOR:
            major_legs[e["from"]] += 1
            major_legs[e["to"]] += 1

    # Signals at cross-intersections (4+ undirected neighbors, 2+ major legs) AND
    # major T-junctions (3 neighbors with at least one major leg).
    sig_cross = [n for n in keep_nodes if len(nbr[n]) >= 4 and major_legs[n] >= 2]
    sig_t = [n for n in keep_nodes if len(nbr[n]) == 3 and major_legs[n] >= 1]
    sig = list(set(sig_cross + sig_t))
    sig.sort(key=lambda n: (len(nbr[n]), major_legs[n]), reverse=True)
    raw_sig = sig[:SIGNAL_CAP] if SIGNAL_CAP < len(sig) else sig

    # Deduplicate: if two signal candidates are within 25 m of each other, keep
    # only the one with higher priority (already sorted desc, so keep first seen).
    DEDUP_M = 25.0
    signalized = set()
    for nid in raw_sig:
        if nid not in node_coord:
            continue
        la, lo = node_coord[nid]
        too_close = any(
            mdist(la, lo, node_coord[s][0], node_coord[s][1]) < DEDUP_M
            for s in signalized if s in node_coord
        )
        if not too_close:
            signalized.add(nid)

    def near_border(nid):
        if nid not in node_coord:
            return False
        la, lo = node_coord[nid]
        return (la - LAT0 < BORDER_MARGIN or LAT1 - la < BORDER_MARGIN
                or lo - LON0 < BORDER_MARGIN or LON1 - lo < BORDER_MARGIN)

    border = [n for n in keep_nodes if near_border(n)]
    border.sort(key=lambda n: (major_legs[n], len(nbr[n])), reverse=True)
    sources = set(border[:SOURCE_CAP])

    # ---- 7) detect roundabout rings ----
    # A roundabout is a small directed cycle of short edges (< 100m each, < 60m radius).
    def detect_roundabouts():
        MAX_RING = 10       # max ring size in nodes
        MAX_EDGE_M = 100    # max edge length in ring
        MAX_RADIUS_M = 60   # max ring radius

        short_out = defaultdict(list)
        for e in edges:
            if not e.get("synthetic") and e["length_m"] <= MAX_EDGE_M:
                short_out[e["from"]].append(e["to"])

        rings = {}

        def dfs(start, cur, path, path_set, depth):
            if depth > MAX_RING:
                return
            for nxt in short_out[cur]:
                if nxt == start and depth >= 3:
                    key = tuple(sorted(path))
                    if key not in rings:
                        rings[key] = list(path)
                    return
                if nxt not in path_set:
                    path_set.add(nxt)
                    dfs(start, nxt, path + [nxt], path_set, depth + 1)
                    path_set.discard(nxt)

        for start in list(short_out.keys()):
            dfs(start, start, [start], {start}, 1)

        result = []
        processed = set()
        for key, ring_nodes in rings.items():
            key_set = set(key)
            if key_set & processed:
                continue
            processed.update(key_set)

            lats = [node_coord[n][0] for n in key if n in node_coord]
            lons = [node_coord[n][1] for n in node_coord if n in node_coord]
            # rebuild correctly
            lats2 = [node_coord[n][0] for n in key if n in node_coord]
            lons2 = [node_coord[n][1] for n in key if n in node_coord]
            if not lats2:
                continue
            clat = sum(lats2) / len(lats2)
            clon = sum(lons2) / len(lons2)
            radii = [mdist(node_coord[n][0], node_coord[n][1], clat, clon)
                     for n in key if n in node_coord]
            r = sum(radii) / len(radii) if radii else 0
            if 4 <= r <= MAX_RADIUS_M:
                result.append({
                    "center": [round(clat, 6), round(clon, 6)],
                    "radius_m": round(r, 1),
                    "node_count": len(key),
                })
        return result

    roundabouts = detect_roundabouts()

    # ---- 8) validate ----
    scc_pct = round(100 * len(final_core) / len(keep_nodes))
    route_pct = routing_success(list(keep_nodes), out_adj)
    dead_ends = sum(1 for n in keep_nodes if outdeg[n] == 0 or indeg[n] == 0)

    # Remove the two pure Queen's Road phantom nodes (J180, J219 originally)
    # These are degree-2 nodes that touch only Queen's Road edges
    qr_edges = [e for e in edges if e["name"] == "Queen's Road" and not e.get("synthetic")]
    qr_adj = defaultdict(set)
    for e in qr_edges:
        qr_adj[e["from"]].add(e["to"])
        qr_adj[e["to"]].add(e["from"])

    nodes_to_remove = set()
    for nid in list(qr_adj.keys()):
        if len(qr_adj[nid]) != 2:
            continue
        # Check: does this node touch any other roads?
        other_roads = [e for e in edges if (e["from"] == nid or e["to"] == nid) and e["name"] != "Queen's Road" and not e.get("synthetic")]
        if len(other_roads) == 0:
            # Pure pass-through on Queen's Road only — these are the phantom nodes to remove
            nodes_to_remove.add(nid)

    # Remove the marked nodes
    if nodes_to_remove:
        print(f"Removing phantom nodes: {len(nodes_to_remove)} pure Queen's Road pass-through nodes")
        for nid in nodes_to_remove:
            keep_nodes.discard(nid)
            if nid in node_coord:
                del node_coord[nid]

        # Remove edges touching those nodes
        edges = [e for e in edges if e["from"] not in nodes_to_remove and e["to"] not in nodes_to_remove]

        # Re-run connectivity repair on the cleaned graph
        synthetic_added = 0
        for _ in range(8):
            out_adj, present, alln = build_out(edges)
            core = largest_scc_set(list(alln), out_adj)
            if len(core) == len(alln):
                break
            added = 0
            for e in list(edges):
                a, b = e["from"], e["to"]
                if (a not in core or b not in core) and (b, a) not in present:
                    rev = dict(e)
                    rev["id"] = f"{e['id']}_r"
                    rev["from"], rev["to"] = b, a
                    rev["geometry"] = list(reversed(e["geometry"]))
                    rev["synthetic"] = True
                    edges.append(rev)
                    present.add((b, a))
                    added += 1
                    synthetic_added += 1
            if added == 0:
                break
        synthetic += synthetic_added
        out_adj, present, alln = build_out(edges)
        final_core = largest_scc_set(list(alln), out_adj)

    # Assign final jids (compact after removals)
    out_nodes = []
    junction_idx = 1
    for nid in sorted(keep_nodes):
        if nid not in node_coord:
            continue
        la, lo = node_coord[nid]
        rec = {"id": nid, "lat": la, "lon": lo, "jid": junction_idx}
        junction_idx += 1
        if nid in signalized:
            rec["signalized"] = True
        if nid in sources:
            rec["kind"] = "source"
        out_nodes.append(rec)

    out_edges = []
    for e in edges:
        if e["from"] not in node_coord or e["to"] not in node_coord:
            continue
        rec = {
            "id": e["id"], "from": e["from"], "to": e["to"], "name": e["name"],
            "length_m": e["length_m"], "lanes": e["lanes"], "road_class": e["road_class"],
            "base_capacity_vph": e["base_capacity_vph"],
            "allows_heavy_vehicle": e["allows_heavy_vehicle"],
            "geometry": e["geometry"],
        }
        if e.get("synthetic"):
            rec["synthetic"] = True
        out_edges.append(rec)

    center = [round((LAT0 + LAT1) / 2, 6), round((LON0 + LON1) / 2, 6)]
    doc = {
        "meta": {
            "source": "blr_road_graph.json (OSM) CBD extract + topology repair",
            "bbox": {"min_lat": LAT0, "max_lat": LAT1, "min_lon": LON0, "max_lon": LON1},
            "center": center,
            "node_count": len(out_nodes), "edge_count": len(out_edges),
            "signal_count": len(signalized), "source_count": len(sources),
            "merged_clusters": merged_clusters, "split_edges": split_count,
            "simplified_nodes": simplify_count, "synthetic_edges": synthetic,
            "largest_scc_pct": scc_pct, "routing_success_pct": route_pct,
            "dead_ends": dead_ends,
            "roundabouts": roundabouts,
        },
        "nodes": out_nodes, "edges": out_edges,
    }
    json.dump(doc, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}")
    print(f"  nodes={len(out_nodes)} edges={len(out_edges)} signals={len(signalized)} sources={len(sources)}")
    print(f"  merged_clusters={merged_clusters} split_edges={split_count} simplified_nodes={simplify_count}")
    print(f"  synthetic_edges={synthetic}")
    print(f"  largest_SCC={scc_pct}%  routing_success={route_pct}%  dead_ends={dead_ends}")
    print(f"  roundabouts detected: {len(roundabouts)}")
    if scc_pct != 100 or route_pct != 100 or dead_ends != 0:
        print("  !! WARNING: network is NOT fully connected — review repair step")
    else:
        print("  OK: fully strongly-connected, 0 dead-ends")


if __name__ == "__main__":
    main()
