"use client";

// Leaflet/CartoDB dark basemap for the CBD digital twin. Hosts the canvas
// vehicle layer and captures clicks to inject incidents (snapped to the nearest
// road edge). Dynamically imported with ssr:false by the page.

import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { SimCanvasLayer } from "./SimCanvasLayer";
import { CBD_CENTER } from "@/lib/sim/network";
import type { Engine } from "@/lib/sim/engine";

export interface EdgePick {
  edgeId: string;
  distOnEdge: number;
  lat: number;
  lon: number;
}

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

export interface SimMapProps {
  engineRef: React.RefObject<Engine | null>;
  highlightEdges?: string[];
  debug?: boolean;
  showEdges?: boolean;
  onPick: (p: EdgePick) => void;
}

export default function SimMap({ engineRef, highlightEdges, debug, showEdges, onPick }: SimMapProps) {
  return (
    <MapContainer
      center={CBD_CENTER}
      zoom={15}
      minZoom={13}
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
