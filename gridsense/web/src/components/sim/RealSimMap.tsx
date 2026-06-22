"use client";

import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { SimCanvasLayer } from "./SimCanvasLayer";
import { REAL_CBD_CENTER } from "@/lib/sim/network_real";
import type { Engine } from "@/lib/sim/engine";
import type { EdgePick } from "./SimMap";

function ClickCapture({
  engineRef,
  onPick,
}: {
  engineRef: React.RefObject<Engine | null>;
  onPick: (p: EdgePick) => void;
}) {
  useMapEvents({
    click(e) {
      const eng = engineRef.current;
      if (!eng) return;
      const snap = eng.net.snapToEdge(e.latlng.lat, e.latlng.lng);
      if (snap) onPick(snap);
    },
  });
  return null;
}

export interface RealSimMapProps {
  engineRef: React.RefObject<Engine | null>;
  highlightEdges?: string[];
  debug?: boolean;
  showEdges?: boolean;
  onPick: (p: EdgePick) => void;
}

export default function RealSimMap({ engineRef, highlightEdges, debug, showEdges, onPick }: RealSimMapProps) {
  return (
    <MapContainer
      center={REAL_CBD_CENTER}
      zoom={14}
      minZoom={12}
      maxZoom={18}
      zoomAnimation={false}
      preferCanvas
      style={{ height: "100%", width: "100%", background: "#0b0e14" }}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; OpenStreetMap · CARTO · GridSense'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <SimCanvasLayer engineRef={engineRef} highlightEdges={highlightEdges} debug={debug} showEdges={showEdges} />
      <ClickCapture engineRef={engineRef} onPick={onPick} />
    </MapContainer>
  );
}
