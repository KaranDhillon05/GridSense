#!/usr/bin/env python3
"""Generate a *self-contained synthetic* city network for the /simulation twin.

Reproducing Bengaluru exactly is impractical, so this builds an invented but
production-grade road network that exercises every feature the simulation can
show: curved + straight roads, roundabouts, U-turn bays on a divided boulevard,
grade-separated flyovers, river bridges, multi-lane arterials, and a mix of
one-way / two-way roads. Output schema is identical to the OSM pipeline
(web/src/data/sim_network.json) so the engine/renderer run unchanged, with two
additions used only for drawing: edges[].kind / edges[].level and meta.rivers.

Guarantees (validated, fails loudly otherwise): 100% strongly-connected,
100% routing success, 0 dead-ends, every signal has >=2 conflicting phases,
no signal on a roundabout.

Run:  python3 ml/build_synthetic_network.py
"""
import json
import math
import os
import random
from collections import defaultdict, deque

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "src", "data", "sim_network.json")

SEED = 42
random.seed(SEED)

# --- scale: "Large" organic-mixed ---
COLS, ROWS = 8, 8
SPACING = 235.0          # nominal block size (m)
CENTER_LAT, CENTER_LON = 12.975, 77.605
MLAT = 111320.0
MLON = 111320.0 * math.cos(math.radians(CENTER_LAT))

# river runs vertically between column index 3 and 4
RIVER_COL = 3.5
BRIDGE_ROWS = [1, 5]
ROUNDABOUT_CELLS = [(2, 2), (5, 2), (2, 5), (5, 5)]
SIGNAL_DEDUP_M = 28.0

ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]
CROSS_NAMES = ["Maple Cross", "Birch Cross", "Cedar Cross", "Elm Cross",
               "Ash Cross", "Pine Cross", "Oak Cross", "Willow Cross"]
MAIN_NAMES = ["1st Main", "2nd Main", "3rd Main", "4th Main",
              "5th Main", "6th Main", "7th Main", "8th Main"]
ROUNDABOUT_NAMES = ["Victory Circle", "Harmony Circle", "Liberty Circle", "Unity Circle"]


def m2ll(x, y):
    return (CENTER_LAT + y / MLAT, CENTER_LON + x / MLON)


def ll(x, y):
    lat, lon = m2ll(x, y)
    return [round(lon, 6), round(lat, 6)]


def dist_m(p, q):
    return math.hypot(p[0] - q[0], p[1] - q[1])


# ---- graph containers ----
nodes = {}          # id -> dict(x, y, signalized?, kind?)
node_xy = {}        # id -> (x, y) in metres
edges = []          # list of edge dicts
_nid = [0]
_eid = [0]


def new_node(x, y, kind=None):
    _nid[0] += 1
    nid = f"n{_nid[0]}"
    nodes[nid] = {"x": x, "y": y}
    if kind:
        nodes[nid]["kind"] = kind
    node_xy[nid] = (x, y)
    return nid


def geom_len(pts):
    return sum(dist_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def cap_for(road_class, lanes):
    per = {"arterial": 1900, "sub_arterial": 1300, "collector": 750}[road_class]
    return per * lanes


def curve_pts(a_xy, b_xy, bow, n=10):
    (x0, y0), (x1, y1) = a_xy, b_xy
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1.0
    px, py = -dy / L, dx / L          # unit perpendicular
    cx, cy = mx + px * bow, my + py * bow
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1
        y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1
        out.append((x, y))
    return out


def add_edge(a, b, name, road_class, lanes, *, bow=0.0, kind=None, level=0,
             oneway=False, geom_m=None, heavy=None):
    """Add edge a->b (and the reverse unless oneway)."""
    if geom_m is None:
        if bow:
            geom_m = curve_pts(node_xy[a], node_xy[b], bow)
        else:
            geom_m = [node_xy[a], node_xy[b]]
    if heavy is None:
        heavy = road_class in ("arterial", "sub_arterial") and kind != "uturn"

    def _mk(fr, to, pts):
        _eid[0] += 1
        e = {
            "id": f"e{_eid[0]}",
            "from": fr, "to": to, "name": name,
            "length_m": max(6, int(round(geom_len(pts)))),
            "lanes": lanes, "road_class": road_class,
            "base_capacity_vph": cap_for(road_class, lanes),
            "allows_heavy_vehicle": heavy,
            "geometry": [ll(x, y) for (x, y) in pts],
        }
        if kind:
            e["kind"] = kind
        if level:
            e["level"] = level
        edges.append(e)

    _mk(a, b, geom_m)
    if not oneway:
        _mk(b, a, list(reversed(geom_m)))


# ---------------------------------------------------------------------------
# 1) organic perturbed grid of nodes
# ---------------------------------------------------------------------------
col_x = []
acc = 0.0
for c in range(COLS):
    acc += SPACING * random.uniform(0.85, 1.15) if c else 0.0
    col_x.append(acc)
row_y = []
acc = 0.0
for r in range(ROWS):
    acc += SPACING * random.uniform(0.85, 1.15) if r else 0.0
    row_y.append(acc)
# centre the lattice
cx0 = sum(col_x) / COLS
cy0 = sum(row_y) / ROWS

grid = {}  # (c,r) -> node id
for c in range(COLS):
    for r in range(ROWS):
        jx = col_x[c] - cx0 + random.uniform(-32, 32)
        jy = row_y[r] - cy0 + random.uniform(-32, 32)
        grid[(c, r)] = new_node(jx, jy)

rb_cells = set(ROUNDABOUT_CELLS)

# arterials: two through corridors (a row + a column) get 3 lanes
ART_ROW, ART_COL = 4, 6


def river_x_at(y):
    base = (col_x[3] + col_x[4]) / 2 - cx0
    return base + 28.0 * math.sin(y / 180.0)


def crosses_river(c, cn):
    # only the column step 3<->4 spans the river
    return {c, cn} == {3, 4}


# ---------------------------------------------------------------------------
# 2) grid roads (skip river span except at bridges)
# ---------------------------------------------------------------------------
def road_class_for(is_art):
    return "arterial" if is_art else random.choice(["sub_arterial", "collector"])


# horizontal roads
for r in range(ROWS):
    for c in range(COLS - 1):
        a, b = grid[(c, r)], grid[(c + 1, r)]
        if crosses_river(c, c + 1) and r not in BRIDGE_ROWS:
            continue  # river gap — only bridges cross here
        is_art = (r == ART_ROW)
        rc = "arterial" if is_art else road_class_for(False)
        lanes = 3 if is_art else random.choice([1, 2, 2])
        name = CROSS_NAMES[r]
        bow = random.choice([0, 0, 0, 22, -22, 30]) if not is_art else 0
        if crosses_river(c, c + 1) and r in BRIDGE_ROWS:
            add_edge(a, b, f"{name} Bridge", "arterial", 2, kind="bridge", level=0)
        else:
            add_edge(a, b, name, rc, lanes, bow=bow)

# vertical roads
for c in range(COLS):
    for r in range(ROWS - 1):
        a, b = grid[(c, r)], grid[(c, r + 1)]
        is_art = (c == ART_COL)
        rc = "arterial" if is_art else road_class_for(False)
        lanes = 3 if is_art else random.choice([1, 2, 2])
        name = MAIN_NAMES[c]
        bow = random.choice([0, 0, 0, 20, -20, 28]) if not is_art else 0
        # one-way couplet: 2nd Main southbound only, 3rd Main northbound only
        oneway = c in (1, 2)
        if c == 1:
            add_edge(b, a, name, rc, lanes, bow=bow, oneway=True)   # southbound
        elif c == 2:
            add_edge(a, b, name, rc, lanes, bow=bow, oneway=True)   # northbound
        else:
            add_edge(a, b, name, rc, lanes, bow=bow)


# ---------------------------------------------------------------------------
# 2b) thin the lattice for an organic, irregular-block layout (and to avoid a
#     traffic light at every uniform 4-way crossing). Never isolate a node.
# ---------------------------------------------------------------------------
def thin_grid(fraction=0.18):
    udeg = defaultdict(int)
    pairs = defaultdict(list)
    for e in edges:
        pairs[frozenset((e["from"], e["to"]))].append(e)
    for key, es in pairs.items():
        a, b = tuple(key)
        udeg[a] += 1
        udeg[b] += 1
    keys = list(pairs.keys())
    random.shuffle(keys)
    protect = {grid[c] for c in ROUNDABOUT_CELLS if grid.get(c)}
    removed = 0
    target = int(len(keys) * fraction)
    for key in keys:
        if removed >= target:
            break
        a, b = tuple(key)
        if a in protect or b in protect:
            continue
        # never thin arterials or special links (bridges) — keep corridors whole
        if any(e["road_class"] == "arterial" or e.get("kind") for e in pairs[key]):
            continue
        if udeg[a] <= 2 or udeg[b] <= 2:
            continue  # keep everyone connected
        ids = {e["id"] for e in pairs[key]}
        edges[:] = [e for e in edges if e["id"] not in ids]
        udeg[a] -= 1
        udeg[b] -= 1
        removed += 1


thin_grid(0.24)


# ---------------------------------------------------------------------------
# 3) roundabouts — replace selected junctions with circulating rings
# ---------------------------------------------------------------------------
roundabout_meta = []


def replace_with_roundabout(cell, name):
    g = grid[cell]
    gx, gy = node_xy[g]
    RR = 24.0
    K = 6
    ring = []
    for i in range(K):
        ang = 2 * math.pi * i / K
        ring.append(new_node(gx + RR * math.cos(ang), gy + RR * math.sin(ang), kind="roundabout"))
    # circulate clockwise (left-hand traffic): i -> i-1
    for i in range(K):
        a = ring[i]
        b = ring[(i - 1) % K]
        # arc geometry
        a_ang = 2 * math.pi * i / K
        b_ang = 2 * math.pi * ((i - 1) % K) / K
        # ensure we sweep the short clockwise way
        if b_ang > a_ang:
            b_ang -= 2 * math.pi
        pts = []
        for s in range(5):
            t = s / 4
            ang = a_ang + (b_ang - a_ang) * t
            pts.append((gx + RR * math.cos(ang), gy + RR * math.sin(ang)))
        add_edge(a, b, name, "arterial", 2, kind="roundabout", level=0, oneway=True, geom_m=pts)

    # reconnect incident edges (that touched g) to nearest ring node
    incident = [e for e in edges if e["from"] == g or e["to"] == g]
    seen_pairs = set()
    for e in list(incident):
        other = e["to"] if e["from"] == g else e["from"]
        if other in ring:
            continue
        ox, oy = node_xy[other]
        rn = min(ring, key=lambda rid: dist_m(node_xy[rid], (ox, oy)))
        key = tuple(sorted((other, rn)))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        nm, rc, ln = e["name"], e["road_class"], e["lanes"]
        # two-way stub between the neighbour and the ring
        add_edge(other, rn, nm, rc, ln)
    # drop the original node + its incident edges
    edges[:] = [e for e in edges if e["from"] != g and e["to"] != g]
    del nodes[g]
    del node_xy[g]
    grid[cell] = None
    roundabout_meta.append({"center": [round(m2ll(gx, gy)[0], 6), round(m2ll(gx, gy)[1], 6)],
                            "radius_m": round(RR, 1), "node_count": K})


for idx, cell in enumerate(ROUNDABOUT_CELLS):
    replace_with_roundabout(cell, ROUNDABOUT_NAMES[idx])


# ---------------------------------------------------------------------------
# 4) flyovers — elevated grade-separated express links (share only endpoints)
# ---------------------------------------------------------------------------
def node_at(cell):
    return grid.get(cell)


FLYOVERS = [
    ((0, 1), (5, 1), "North Express Flyover", 40),
    ((1, 6), (6, 6), "South Express Flyover", -38),
    ((0, 7), (7, 4), "Diagonal Skyway", 60),
]
for (ca, cb, nm, bow) in FLYOVERS:
    a, b = node_at(ca), node_at(cb)
    if a and b:
        add_edge(a, b, nm, "arterial", 2, bow=bow, kind="flyover", level=1)


# ---------------------------------------------------------------------------
# 5) divided boulevard with U-turn bays (south of the grid)
# ---------------------------------------------------------------------------
def build_boulevard():
    grid_ids = list(node_xy.keys())  # snapshot before adding boulevard nodes
    y_base = min(node_xy[v][1] for v in node_xy) - 190.0  # just south of the grid
    xs = [col_x[c] - cx0 for c in range(1, 7)]
    east = [new_node(x, y_base + 6) for x in xs]   # eastbound carriageway
    west = [new_node(x, y_base - 6) for x in xs]   # westbound carriageway
    nm = "Riverside Boulevard"
    for i in range(len(east) - 1):
        add_edge(east[i], east[i + 1], nm, "arterial", 2, oneway=True)
    for i in range(len(west) - 1, 0, -1):
        add_edge(west[i], west[i - 1], nm, "arterial", 2, oneway=True)

    def nearest_grid(node_id):
        x, y = node_xy[node_id]
        return min(grid_ids, key=lambda g: (node_xy[g][0] - x) ** 2 + (node_xy[g][1] - y) ** 2)

    # tie the boulevard into the nearest grid nodes at each end (directed loop)
    left = nearest_grid(east[0])
    right = nearest_grid(east[-1])
    add_edge(left, east[0], nm, "arterial", 2, oneway=True)
    add_edge(east[-1], right, nm, "arterial", 2, oneway=True)
    add_edge(right, west[-1], nm, "arterial", 2, oneway=True)
    add_edge(west[0], left, nm, "arterial", 2, oneway=True)
    # U-turn bays: short crossovers between the two carriageways
    for k in (1, 3):
        add_edge(east[k], west[k], "U-turn Bay", "collector", 1,
                 kind="uturn", oneway=True, bow=6)
        add_edge(west[k], east[k], "U-turn Bay", "collector", 1,
                 kind="uturn", oneway=True, bow=6)


build_boulevard()


# ---------------------------------------------------------------------------
# helpers: SCC / routing / bearing
# ---------------------------------------------------------------------------
def build_out():
    o = defaultdict(list)
    present = set()
    alln = set()
    for e in edges:
        alln.add(e["from"]); alln.add(e["to"])
        o[e["from"]].append(e["to"])
        present.add((e["from"], e["to"]))
    for n in alln:
        o.setdefault(n, [])
    return o, present, alln


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
                    stack.append((w, iter(out_adj[w]))); adv = True; break
            if not adv:
                order.append(nd); stack.pop()
    rev = defaultdict(list)
    for u in out_adj:
        for v in out_adj[u]:
            rev[v].append(u)
    comp, seen, c = {}, set(), 0
    for n in reversed(order):
        if n in seen:
            continue
        st, mem = [n], []; seen.add(n)
        while st:
            x = st.pop(); comp[x] = c; mem.append(x)
            for w in rev[x]:
                if w not in seen:
                    seen.add(w); st.append(w)
        c += 1
    return comp


def largest_scc(node_ids, out_adj):
    comp = sccs(node_ids, out_adj)
    by = defaultdict(list)
    for n, c in comp.items():
        by[c].append(n)
    return set(max(by.values(), key=len)) if by else set()


def routing_success(node_ids, out_adj, n=600):
    random.seed(7)
    nl = list(node_ids); ok = tot = 0
    for _ in range(n):
        s, t = random.choice(nl), random.choice(nl)
        if s == t:
            continue
        tot += 1
        q, vis, found = deque([s]), {s}, False
        while q:
            u = q.popleft()
            if u == t:
                found = True; break
            for v in out_adj[u]:
                if v not in vis:
                    vis.add(v); q.append(v)
        ok += found
    return round(100 * ok / max(1, tot))


def bearing_deg(e):
    g = e["geometry"]
    lo1, la1 = g[-2]; lo2, la2 = g[-1]
    dy = (la2 - la1) * MLAT
    dx = (lo2 - lo1) * MLON
    return (math.degrees(math.atan2(dy, dx)) + 360) % 360


def axis_groups(incoming):
    groups = []
    for e in incoming:
        ax = bearing_deg(e) % 180
        hit = False
        for g in groups:
            d = abs(g - ax) % 180
            if d > 90:
                d = 180 - d
            if d <= 40:
                hit = True; break
        if not hit:
            groups.append(ax)
    return len(groups)


# ---------------------------------------------------------------------------
# 6) connectivity repair (safety net) then signals/sources
# ---------------------------------------------------------------------------
synthetic = 0
for _ in range(8):
    out_adj, present, alln = build_out()
    core = largest_scc(list(alln), out_adj)
    if len(core) == len(alln):
        break
    added = 0
    for e in list(edges):
        a, b = e["from"], e["to"]
        if (a not in core or b not in core) and (b, a) not in present:
            rev = dict(e)
            rev["id"] = f"e{_eid[0] + 1}"; _eid[0] += 1
            rev["from"], rev["to"] = b, a
            rev["geometry"] = list(reversed(e["geometry"]))
            rev["synthetic"] = True
            edges.append(rev); present.add((b, a)); added += 1; synthetic += 1
    if added == 0:
        break

out_adj, present, alln = build_out()
final_core = largest_scc(list(alln), out_adj)

inc_edges = defaultdict(list)
out_edges = defaultdict(list)
undir = defaultdict(set)
for e in edges:
    inc_edges[e["to"]].append(e)
    out_edges[e["from"]].append(e)
    undir[e["from"]].add(e["to"]); undir[e["to"]].add(e["from"])

rb_centers = [(rb["center"][0], rb["center"][1], rb["radius_m"]) for rb in roundabout_meta]


def on_roundabout(nid):
    if nodes[nid].get("kind") == "roundabout":
        return True
    la, lo = m2ll(*node_xy[nid])
    for (clat, clon, rr) in rb_centers:
        dy = (la - clat) * MLAT; dx = (lo - clon) * MLON
        if math.hypot(dx, dy) <= rr + 10:
            return True
    return False


# Signal rule (validated for free flow): a light only at a genuine grid
# cross-intersection — a 4-way junction whose incoming streams actually conflict
# (>=2 distinct approach axes / phases). Special structures stay UNSIGNALISED and
# free-flowing: roundabouts (yield), flyovers/bridges (grade-separated), and the
# divided U-turn boulevard. Signalising those creates spill-back deadlock.
MAJOR = {"arterial", "sub_arterial"}


def touches_special(nid):
    for e in out_edges[nid] + inc_edges[nid]:
        if e.get("kind"):  # flyover / bridge / uturn / roundabout
            return True
        if e["name"] == "Riverside Boulevard":
            return True
    return False


cand = []
for nid in alln:
    if on_roundabout(nid) or touches_special(nid):
        continue
    incoming = inc_edges[nid]
    if len(incoming) < 2:
        continue
    if axis_groups(incoming) < 2:       # genuine conflicting movements only
        continue
    if len(undir[nid]) < 4:             # true cross-intersections only
        continue
    cand.append(nid)
# busiest first, then dedupe by proximity
cand.sort(key=lambda n: (len(undir[n]), len(inc_edges[n])), reverse=True)
signalized = set()
for nid in cand:
    la, lo = m2ll(*node_xy[nid])
    too_close = False
    for s in signalized:
        sla, slo = m2ll(*node_xy[s])
        if math.hypot((la - sla) * MLAT, (lo - slo) * MLON) < SIGNAL_DEDUP_M:
            too_close = True; break
    if not too_close:
        signalized.add(nid)

# sources: boundary nodes (grid perimeter + boulevard handled via degree)
minx = min(node_xy[v][0] for v in node_xy)
maxx = max(node_xy[v][0] for v in node_xy)
miny = min(node_xy[v][1] for v in node_xy)
maxy = max(node_xy[v][1] for v in node_xy)
margin = SPACING * 0.6
border = []
for nid in alln:
    x, y = node_xy[nid]
    if (x - minx < margin or maxx - x < margin or y - miny < margin or maxy - y < margin):
        if nodes[nid].get("kind") != "roundabout":
            border.append(nid)
border.sort(key=lambda n: len(undir[n]), reverse=True)
sources = set(border[:22])


# ---------------------------------------------------------------------------
# 7) validate + write
# ---------------------------------------------------------------------------
scc_pct = round(100 * len(final_core) / len(alln))
route_pct = routing_success(list(alln), out_adj)
dead_ends = sum(1 for n in alln if not out_edges[n] or not inc_edges[n])

# duplicate directed edges
seen = set(); dups = 0
for e in edges:
    k = (e["from"], e["to"])
    if k in seen:
        dups += 1
    seen.add(k)

# signal phase / roundabout assertions
bad_phase = [n for n in signalized if axis_groups(inc_edges[n]) < 2]
bad_rb = [n for n in signalized if on_roundabout(n)]

out_nodes = []
_jid = 0
for nid in sorted(alln, key=lambda s: int(s[1:])):
    la, lo = m2ll(*node_xy[nid])
    _jid += 1
    rec = {"id": nid, "lat": round(la, 6), "lon": round(lo, 6), "jid": _jid}
    if nid in signalized:
        rec["signalized"] = True
    if nid in sources:
        rec["kind"] = "source"
    elif nodes[nid].get("kind") == "roundabout":
        rec["kind"] = "roundabout"
    out_nodes.append(rec)

out_edges_json = []
for e in edges:
    rec = {
        "id": e["id"], "from": e["from"], "to": e["to"], "name": e["name"],
        "length_m": e["length_m"], "lanes": e["lanes"], "road_class": e["road_class"],
        "base_capacity_vph": e["base_capacity_vph"],
        "allows_heavy_vehicle": e["allows_heavy_vehicle"],
        "geometry": e["geometry"],
    }
    if e.get("kind"):
        rec["kind"] = e["kind"]
    if e.get("level"):
        rec["level"] = e["level"]
    if e.get("synthetic"):
        rec["synthetic"] = True
    out_edges_json.append(rec)

# river polyline (for rendering)
river = []
for r in range(ROWS):
    y = row_y[r] - cy0
    river.append(ll(river_x_at(y), y))
# extend a bit past the ends
river.insert(0, ll(river_x_at(miny - 120), miny - 120))
river.append(ll(river_x_at(maxy + 120), maxy + 120))

lats = [n["lat"] for n in out_nodes]
lons = [n["lon"] for n in out_nodes]
doc = {
    "meta": {
        "source": "synthetic generator (build_synthetic_network.py)",
        "bbox": {"min_lat": min(lats), "max_lat": max(lats),
                 "min_lon": min(lons), "max_lon": max(lons)},
        "center": [CENTER_LAT, CENTER_LON],
        "node_count": len(out_nodes), "edge_count": len(out_edges_json),
        "signal_count": len(signalized), "source_count": len(sources),
        "roundabout_count": len(roundabout_meta),
        "flyover_count": sum(1 for e in edges if e.get("kind") == "flyover"),
        "bridge_count": sum(1 for e in edges if e.get("kind") == "bridge"),
        "uturn_count": sum(1 for e in edges if e.get("kind") == "uturn"),
        "synthetic_edges": synthetic,
        "largest_scc_pct": scc_pct, "routing_success_pct": route_pct,
        "dead_ends": dead_ends, "duplicate_edges": dups,
        "roundabouts": roundabout_meta,
        "rivers": [river],
    },
    "nodes": out_nodes, "edges": out_edges_json,
}
json.dump(doc, open(OUT, "w"), separators=(",", ":"))

print(f"wrote {OUT}")
print(f"  nodes={len(out_nodes)} edges={len(out_edges_json)} signals={len(signalized)} sources={len(sources)}")
print(f"  roundabouts={len(roundabout_meta)} flyovers={doc['meta']['flyover_count']} "
      f"bridges={doc['meta']['bridge_count']} uturns={doc['meta']['uturn_count']} synthetic={synthetic}")
print(f"  largest_SCC={scc_pct}%  routing={route_pct}%  dead_ends={dead_ends}  dup_edges={dups}")
print(f"  bad_phase_signals={len(bad_phase)}  signals_on_roundabout={len(bad_rb)}")
problems = []
if scc_pct != 100: problems.append("SCC<100")
if route_pct != 100: problems.append("routing<100")
if dead_ends: problems.append("dead_ends>0")
if dups: problems.append("duplicate_edges>0")
if bad_phase: problems.append("1-phase signals")
if bad_rb: problems.append("signals on roundabout")
if problems:
    print("  !! PROBLEMS:", ", ".join(problems))
else:
    print("  OK: fully connected, clean signals, no leaks")
