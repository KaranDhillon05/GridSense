"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Circle,
  Polyline,
  Polygon,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { tierColor, prettyCause, fmtDuration, type ScoredEvent } from "@/lib/ui";
import type {
  BarricadePoint,
  DeploymentPost,
  DiversionRouteOption,
  IsochroneContour,
  PoiFacility,
} from "@/lib/types";
import type { MapTrafficRoute } from "@/lib/trafficMapLayers";

const BLR_CENTER: [number, number] = [12.9716, 77.5946];

type Hotspot = {
  lat: number;
  lon: number;
  count: number;
  closure_rate: number;
  high_priority_rate: number;
};

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

// SVG arrow divIcon at a given bearing
function arrowIcon(color: string, bearingDeg: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-8 -8 16 16">
    <polygon points="0,-7 5,4 0,1 -5,4" fill="${color}" opacity="0.9" transform="rotate(${bearingDeg})"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// Distinct marker for vehicle barricade (red barrier). Soft tapers are amber.
function barricadeIcon(type?: BarricadePoint["type"]) {
  const bg = type === "soft" ? "#f59e0b" : "#ef4444";
  return L.divIcon({
    html: `<div style="width:18px;height:18px;background:${bg};border:2px solid #fff;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:bold;">B</div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Crowd-control pedestrian barrier — distinct hatched teal marker.
function crowdBarrierIcon() {
  return L.divIcon({
    html: `<div style="width:20px;height:14px;background:repeating-linear-gradient(45deg,#14b8a6,#14b8a6 3px,#fff 3px,#fff 6px);border:2px solid #0f766e;border-radius:2px;"></div>`,
    className: "",
    iconSize: [20, 14],
    iconAnchor: [10, 7],
  });
}

// Distinct marker for deployment post (blue shield)
function postIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;background:#3b82f6;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:bold;">P</div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const POI_ICON_CONFIG: Record<PoiFacility["category"], { bg: string; label: string }> = {
  hospital: { bg: "#ef4444", label: "H" },
  police: { bg: "#1d4ed8", label: "PD" },
  fuel: { bg: "#f59e0b", label: "F" },
  parking: { bg: "#6b7280", label: "P" },
};

function poiIcon(category: PoiFacility["category"]) {
  const { bg, label } = POI_ICON_CONFIG[category];
  return L.divIcon({
    html: `<div style="width:20px;height:20px;background:${bg};border:2px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:bold;">${label}</div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export type MapProps = {
  events?: ScoredEvent[];
  hotspots?: Hotspot[];
  showHeatmap?: boolean;
  focus?: {
    lat: number;
    lon: number;
    radius_m?: number;
    tier?: string;
    label?: string;
  } | null;
  diversion?: number[][] | null; // [lon,lat] pairs
  diversionRoutes?: DiversionRouteOption[];
  activeRouteId?: string | null;
  barricadePoints?: BarricadePoint[];
  deploymentPosts?: DeploymentPost[];
  trafficRoutes?: MapTrafficRoute[];
  isochrones?: IsochroneContour[];
  facilities?: PoiFacility[];
  center?: [number, number];
  zoom?: number;
  selectedId?: string | null;
};

export default function BengaluruMap({
  events = [],
  hotspots = [],
  showHeatmap = false,
  focus = null,
  diversion = null,
  diversionRoutes = [],
  activeRouteId = null,
  barricadePoints = [],
  deploymentPosts = [],
  trafficRoutes = [],
  isochrones = [],
  facilities = [],
  center = BLR_CENTER,
  zoom = 11,
  selectedId = null,
}: MapProps) {
  const maxCount = useMemo(
    () => Math.max(1, ...hotspots.map((h) => h.count)),
    [hotspots]
  );

  const divLatLng = useMemo(
    () => (diversion ? diversion.map(([lon, lat]) => [lat, lon] as [number, number]) : null),
    [diversion]
  );

  const routeLatLngs = useMemo(
    () =>
      diversionRoutes.map((route) => ({
        id: route.id,
        route_type: route.route_type,
        path: route.geometry.map(([lon, lat]) => [lat, lon] as [number, number]),
      })),
    [diversionRoutes]
  );

  // Isochrone polygons in [lat,lon][] format for Leaflet
  const isoPolygons = useMemo(
    () =>
      isochrones.map((iso) => ({
        minutes: iso.minutes,
        color: iso.color,
        ring: iso.geometry[0]?.map(([lon, lat]) => [lat, lon] as [number, number]) ?? [],
      })),
    [isochrones]
  );

  // Arrow markers at mid-segment of each traffic route
  const arrowMarkers = useMemo(
    () =>
      trafficRoutes
        .filter((r) => r.bearing != null && r.path.length >= 2)
        .map((r) => {
          const mid = r.path[Math.floor(r.path.length / 2)];
          return { id: r.id, pos: mid, color: r.color, bearing: r.bearing! };
        }),
    [trafficRoutes]
  );

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
      zoomControl
    >
      <Recenter center={center} zoom={zoom} />
      <TileLayer
        attribution='&copy; OpenStreetMap · GridSense'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />

      {/* Isochrone contours — rendered first so they sit under everything */}
      {isoPolygons.map((iso) =>
        iso.ring.length >= 3 ? (
          <Polygon
            key={`iso-${iso.minutes}`}
            positions={iso.ring}
            pathOptions={{
              color: iso.color,
              fillColor: iso.color,
              fillOpacity: 0.12,
              weight: 2,
              dashArray: "6 4",
            }}
          />
        ) : null
      )}

      {showHeatmap &&
        hotspots.map((h, i) => {
          const intensity = h.count / maxCount;
          return (
            <Circle
              key={`hs-${i}`}
              center={[h.lat, h.lon]}
              radius={260}
              pathOptions={{
                color: "transparent",
                fillColor: "#ef4444",
                fillOpacity: 0.12 + 0.5 * intensity,
              }}
            />
          );
        })}

      {events.map((e) => {
        const isSel = selectedId === e.id;
        const r = isSel ? 9 : 3 + (e.impact_score ?? 0) / 14;
        return (
          <CircleMarker
            key={e.id}
            center={[e.latitude, e.longitude]}
            radius={r}
            pathOptions={{
              color: isSel ? "#fff" : tierColor(e.tier ?? "Low"),
              weight: isSel ? 2 : 1,
              fillColor: tierColor(e.tier ?? "Low"),
              fillOpacity: 0.75,
            }}
          >
            <Popup>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {prettyCause(e.event_cause)}{" "}
                  <span style={{ color: tierColor(e.tier ?? "Low") }}>
                    · {e.tier} {e.impact_score}
                  </span>
                </div>
                <div className="muted">{e.address ?? e.corridor}</div>
                <div className="muted">
                  {e.corridor} · clears in {fmtDuration(e.predicted_duration_min)}
                  {e.requires_road_closure ? " · road closure" : ""}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {focus && (
        <>
          <Circle
            center={[focus.lat, focus.lon]}
            radius={focus.radius_m ?? 500}
            pathOptions={{
              color: tierColor(focus.tier ?? "High"),
              fillColor: tierColor(focus.tier ?? "High"),
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
          <CircleMarker
            center={[focus.lat, focus.lon]}
            radius={8}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: tierColor(focus.tier ?? "High"),
              fillOpacity: 1,
            }}
          >
            {focus.label && <Popup>{focus.label}</Popup>}
          </CircleMarker>
        </>
      )}

      {divLatLng && (
        <Polyline
          positions={divLatLng}
          pathOptions={{ color: "#38bdf8", weight: 4, dashArray: "6 6" }}
        />
      )}

      {/* Volume-weighted traffic routes */}
      {trafficRoutes.map((route) => (
        <Polyline
          key={route.id}
          positions={route.path}
          pathOptions={{
            color: route.color,
            weight: Math.max(route.weight, 3),
            opacity: 0.95,
            dashArray: route.dashArray,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      ))}

      {/* Directional arrow markers at route midpoints */}
      {arrowMarkers.map((m) => (
        <Marker
          key={`arrow-${m.id}`}
          position={m.pos}
          icon={arrowIcon(m.color, m.bearing)}
        />
      ))}

      {routeLatLngs.map((route) => {
        const selected = activeRouteId ? activeRouteId === route.id : route.id === diversionRoutes[0]?.id;
        const color =
          route.route_type === "primary"
            ? "#22c55e"
            : route.route_type === "secondary"
            ? "#f59e0b"
            : "#ef4444";
        return (
          <Polyline
            key={route.id}
            positions={route.path}
            pathOptions={{
              color,
              weight: selected ? 5 : 3,
              opacity: selected ? 1 : 0.6,
              dashArray: route.route_type === "heavy_vehicle" ? "8 8" : undefined,
            }}
          />
        );
      })}

      {/* Barricades — vehicle (red/amber B) vs crowd-control (teal hatched) */}
      {barricadePoints.map((point) => {
        const isCrowd = point.purpose === "crowd" || point.type === "coning";
        return (
          <Marker
            key={point.id}
            position={[point.lat, point.lon]}
            icon={isCrowd ? crowdBarrierIcon() : barricadeIcon(point.type)}
          >
            <Popup>
              <b>{point.label}</b>
              <div className="muted">
                {isCrowd ? "Pedestrian crowd-control barrier" : `Vehicle barricade · ${point.type}`}
              </div>
              <div className="muted">Officers: {point.officers_required}</div>
            </Popup>
          </Marker>
        );
      })}

      {/* Deployment post markers — blue circle */}
      {deploymentPosts.map((post) => (
        <Marker
          key={post.id}
          position={[post.lat, post.lon]}
          icon={postIcon()}
        >
          <Popup>
            <b>{post.label}</b>
            <div className="muted">Role: {post.role}</div>
            <div className="muted">Shift: {post.shift}</div>
            <div className="muted">Officers: {post.officers}</div>
          </Popup>
        </Marker>
      ))}

      {/* POI facilities — hospital/police/fuel/parking */}
      {facilities.map((f) => (
        <Marker
          key={f.id}
          position={[f.lat, f.lon]}
          icon={poiIcon(f.category)}
        >
          <Popup>
            <b>{f.name}</b>
            <div className="muted">{f.category} · {f.distance_m}m from route</div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
