"use client";

// Canvas vehicle/road layer aligned to the Leaflet map. Appends a <canvas> over
// the map container and redraws every animation frame, reading engine state
// directly (no React re-render per frame) and projecting lat/lon through
// map.latLngToContainerPoint so it stays glued to the basemap on pan/zoom.

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Engine } from "@/lib/sim/engine";
import type { VehicleType } from "@/lib/sim/types";

const VEHICLE_COLOR: Record<VehicleType, string> = {
  car: "#9ca3af",
  auto: "#fbbf24",
  bus: "#38bdf8",
  truck: "#a78bfa",
  ambulance: "#ffffff",
  police: "#3b82f6",
  fire: "#ef4444",
  tow: "#f97316",
};

function congColor(util: number): string {
  if (util >= 1.0) return "#b91c1c";
  if (util >= 0.75) return "#ef4444";
  if (util >= 0.5) return "#f97316";
  if (util >= 0.3) return "#eab308";
  return "#22c55e";
}

export function SimCanvasLayer({
  engineRef,
  highlightEdges,
  debug,
  showEdges,
}: {
  engineRef: React.RefObject<Engine | null>;
  highlightEdges?: string[];
  debug?: boolean;
  showEdges?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "450";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;

    const resize = () => {
      const s = map.getSize();
      canvas.width = Math.max(1, s.x * dpr);
      canvas.height = Math.max(1, s.y * dpr);
      canvas.style.width = `${s.x}px`;
      canvas.style.height = `${s.y}px`;
    };
    resize();
    map.on("resize", resize);

    const project = (lat: number, lon: number): [number, number] => {
      const p = map.latLngToContainerPoint(L.latLng(lat, lon));
      return [p.x * dpr, p.y * dpr];
    };

    const pxPerMeter = (): number => {
      const c = map.getCenter();
      const a = map.latLngToContainerPoint(c);
      const b = map.latLngToContainerPoint(L.latLng(c.lat, c.lng + 0.001));
      const meters = 0.001 * 111320 * Math.cos((c.lat * Math.PI) / 180);
      return (Math.abs(b.x - a.x) * dpr) / Math.max(1, meters);
    };

    const draw = () => {
      const eng = engineRef.current;
      raf = requestAnimationFrame(draw);
      if (!eng) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ppm = pxPerMeter();
      const cong = eng.congestionByEdge();
      const hl = new Set(highlightEdges ?? []);

      const showEdgesNow = showEdges !== false;
      const bounds = map.getBounds().pad(0.08);

      // trace an edge's lane-centre polyline as a canvas path
      const tracePath = (edge: { id: string; lanes: number }) => {
        const len = eng.net.edgeLength(edge.id);
        const midLane = (edge.lanes - 1) / 2;
        const samples = Math.max(2, Math.ceil(len / 20));
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const d = (len * i) / samples;
          const p = eng.net.laneAt(edge.id, midLane, d);
          const [x, y] = project(p.lat, p.lon);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      // --- rivers (drawn first, beneath everything) ---
      if (showEdgesNow) {
        for (const riv of eng.net.rivers) {
          ctx.beginPath();
          for (let i = 0; i < riv.length; i++) {
            const [x, y] = project(riv[i].lat, riv[i].lon);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "rgba(40,86,140,0.55)";
          ctx.lineWidth = Math.max(6, 16 * ppm);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      }

      // --- ground roads (level 0) ---
      for (const edge of eng.net.edges) {
        if ((eng.net.edgeLevel.get(edge.id) ?? 0) !== 0) continue;
        const width = Math.max(2, edge.lanes * 3.4 * ppm);
        const c = cong.get(edge.id);
        if (showEdgesNow) {
          tracePath(edge);
          if (c?.blocked) {
            ctx.strokeStyle = "#7f1d1d";
            ctx.setLineDash([8, 6]);
          } else {
            ctx.strokeStyle = c ? congColor(c.utilization) : "#3a3f4b";
            ctx.setLineDash([]);
          }
          ctx.globalAlpha = c?.blocked ? 0.9 : 0.55;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        if (hl.has(edge.id)) {
          tracePath(edge);
          ctx.strokeStyle = "#22d3ee";
          ctx.lineWidth = width + 4 * dpr;
          ctx.globalAlpha = 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // --- roundabout rings + junction blobs (ground structures) ---
      if (showEdgesNow) {
        for (const rb of eng.net.roundabouts) {
          if (!bounds.contains(L.latLng(rb.center.lat, rb.center.lon))) continue;
          const [cx, cy] = project(rb.center.lat, rb.center.lon);
          const rr = rb.radius_m * ppm;
          if (rr < 3) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = "#3a3f4b";
          ctx.lineWidth = Math.max(4, 2 * 3.4 * ppm);
          ctx.globalAlpha = 0.9;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        for (const node of eng.net.nodes.values()) {
          if (!bounds.contains(L.latLng(node.lat, node.lon))) continue;
          const [x, y] = project(node.lat, node.lon);
          const allE = [
            ...(eng.net.outgoing.get(node.id) ?? []),
            ...(eng.net.incoming.get(node.id) ?? []),
          ].filter((e) => (eng.net.edgeLevel.get(e.id) ?? 0) === 0);
          if (!allE.length) continue;
          const maxLanes = allE.reduce((m, e) => Math.max(m, e.lanes), 1);
          const outerM = 1.2 + (maxLanes + 0.5) * 3.4;
          const r = Math.max(2 * dpr, outerM * ppm);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(58,63,75,0.85)";
          ctx.fill();
        }
      }

      // --- elevated roads (flyovers / bridges) drawn on top with elevation ---
      if (showEdgesNow) {
        for (const edge of eng.net.edges) {
          if ((eng.net.edgeLevel.get(edge.id) ?? 0) === 0) continue;
          const kind = eng.net.edgeKind.get(edge.id);
          const width = Math.max(3, edge.lanes * 3.4 * ppm);
          const c = cong.get(edge.id);
          // drop shadow conveys height above the ground network
          tracePath(edge);
          ctx.save();
          ctx.translate(2.5 * dpr, 3 * dpr);
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = width + 3 * dpr;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.restore();
          // deck
          tracePath(edge);
          ctx.strokeStyle = c?.blocked ? "#7f1d1d" : c ? congColor(c.utilization) : "#6b7480";
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.globalAlpha = 1;
          // parapet edges (thin light rails) to read as a structure
          tracePath(edge);
          ctx.strokeStyle = kind === "bridge" ? "rgba(200,210,225,0.7)" : "rgba(170,180,195,0.6)";
          ctx.lineWidth = Math.max(1, 1.2 * dpr);
          ctx.stroke();
          if (hl.has(edge.id)) {
            tracePath(edge);
            ctx.strokeStyle = "#22d3ee";
            ctx.lineWidth = width + 4 * dpr;
            ctx.globalAlpha = 0.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      // --- debug topology overlay ---
      if (debug) {
        const net = eng.net;
        // synthetic (repaired) edges in magenta
        for (const id of net.syntheticEdges) {
          const len = net.edgeLength(id);
          const e = net.edge(id);
          if (!e) continue;
          ctx.beginPath();
          const s = Math.max(2, Math.ceil(len / 25));
          for (let i = 0; i <= s; i++) {
            const p = net.laneAt(id, (e.lanes - 1) / 2, (len * i) / s);
            const [x, y] = project(p.lat, p.lon);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "#e879f9";
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // turn connectors + junction analysis overlay (viewport-culled)
        for (const node of net.nodes.values()) {
          if (!bounds.contains(L.latLng(node.lat, node.lon))) continue;
          const ins = net.incoming.get(node.id) ?? [];
          const outs = net.outgoing.get(node.id) ?? [];
          const signalized = net.signalized.has(node.id);
          for (const ie of ins) {
            for (const oe of outs) {
              if (oe.to === ie.from) continue; // skip U-turn
              const conn = net.connector(ie.id, 0, oe.id, 0);
              ctx.beginPath();
              for (let i = 0; i < conn.points.length; i++) {
                const [x, y] = project(conn.points[i].lat, conn.points[i].lon);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.strokeStyle = signalized ? "rgba(34,211,238,0.45)" : "rgba(250,204,21,0.35)";
              ctx.lineWidth = 1 * dpr;
              ctx.stroke();
            }
          }
          const nbrs = new Set<string>();
          for (const e of ins) nbrs.add(e.from);
          for (const e of outs) nbrs.add(e.to);
          const deadEnd = ins.length === 0 || outs.length === 0;
          const [x, y] = project(node.lat, node.lon);
          const r = Math.max(3 * dpr, 1.2 * ppm);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          if (deadEnd) ctx.fillStyle = "#ef4444";
          else if (signalized) ctx.fillStyle = "#22c55e";
          else if (nbrs.size >= 4) ctx.fillStyle = "#f97316"; // unsignalized cross
          else if (nbrs.size === 3) ctx.fillStyle = "#eab308"; // unsignalized T
          else ctx.fillStyle = "#64748b";
          ctx.fill();
          // conflict count label for cross/T junctions
          if (nbrs.size >= 3 && !deadEnd) {
            const turnCount = ins.length * outs.length - ins.filter((ie) => outs.some((oe) => oe.to === ie.from)).length;
            const fontSize = Math.max(7, 6 * ppm) * dpr;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.textAlign = "center";
            ctx.fillText(String(Math.max(0, turnCount)), x, y - r - 2 * dpr);
          }
        }
      }

      // --- vehicles ---
      const vlen = Math.max(2.5 * dpr, 4.6 * ppm);
      const vwid = Math.max(1.8 * dpr, 2.0 * ppm);
      for (const v of eng.vehicles) {
        const [x, y] = project(v.lat, v.lon);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-v.heading + Math.PI / 2);
        const l = Math.max(vlen, (v.lengthM / 4.6) * vlen);
        ctx.fillStyle = VEHICLE_COLOR[v.type];
        if (v.emergency) {
          ctx.shadowColor = v.type === "ambulance" ? "#ffffff" : VEHICLE_COLOR[v.type];
          ctx.shadowBlur = 8;
        }
        ctx.fillRect(-vwid, -l / 2, vwid * 2, l);
        ctx.restore();
        ctx.shadowBlur = 0;
      }

      // --- signals ---
      for (const sig of eng.signals.values()) {
        const node = eng.net.nodes.get(sig.nodeId);
        if (!node) continue;
        const [x, y] = project(node.lat, node.lon);
        const r = Math.max(2.5 * dpr, 1.6 * ppm);
        let color = "#22c55e";
        if (sig.mode === "failed") color = "#6b7280";
        else if (sig.inAllRed) color = "#ef4444";
        else if (sig.inLeftTurn) color = "#a855f7";
        else if (sig.inYellow) color = "#eab308";
        else if (sig.mode === "emergency" || sig.mode === "manual") color = "#3b82f6";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.stroke();
      }

      // --- incidents ---
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
      for (const inc of eng.activeIncidents()) {
        const [x, y] = project(inc.lat, inc.lon);
        const r = Math.max(7 * dpr, 4 * ppm);
        ctx.beginPath();
        ctx.arc(x, y, r + pulse * 6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(239,68,68,0.18)";
        ctx.fill();
        // warning triangle
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
        ctx.fillStyle = inc.fullBlockage ? "#dc2626" : "#f59e0b";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(r)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", x, y + r * 0.15);
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      map.off("resize", resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [map, engineRef, highlightEdges, debug, showEdges]);

  return null;
}
