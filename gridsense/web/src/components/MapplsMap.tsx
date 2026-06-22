"use client";

import { useEffect, useRef, useState } from "react";
import type { MapProps } from "./BengaluruMap";
import { tierColor } from "@/lib/ui";
import { volumeWeight } from "@/lib/trafficMapLayers";

// Mappls (MapmyIndia) Web Map SDK v3 — Mapbox/MapLibre-GL based.
// We load it once with a short-lived token fetched from /api/maptoken, then
// drive the basemap + overlays through the GL API (sources/layers/markers).

const BLR_CENTER: [number, number] = [77.5946, 12.9716]; // [lng, lat]

declare global {
  interface Window {
    mappls?: any;
    __mapplsLoading?: Promise<void>;
  }
}

function loadMapplsSdk(token: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.mappls?.Map) return Promise.resolve();
  if (window.__mapplsLoading) return window.__mapplsLoading;

  window.__mapplsLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://apis.mappls.com/advancedmaps/api/${token}/map_sdk?layer=vector&v=3.0&callback=__mapplsReady`;
    s.async = true;
    (window as any).__mapplsReady = () => resolve();
    s.onerror = () => reject(new Error("Mappls SDK failed to load"));
    document.head.appendChild(s);
  });
  return window.__mapplsLoading;
}

type GLMap = any;

// Minimal arrow SVG registered as a GL image for line symbol layers
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="10,2 18,18 10,13 2,18" fill="white" opacity="0.9"/></svg>`;

function svgToImage(svg: string): HTMLImageElement {
  const img = new Image(20, 20);
  img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
  return img;
}

export default function MapplsMap({
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
  center,
  zoom = 11,
  selectedId = null,
  token,
  onError,
}: MapProps & { token: string; onError?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const rawMapRef = useRef<GLMap | null>(null); // SDK instance before ready; ensures cleanup
  const markersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const idRef = useRef(`gs-mappls-${Math.random().toString(36).slice(2)}`);

  const lngLatCenter: [number, number] = center
    ? [center[1], center[0]]
    : BLR_CENTER;

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;

    loadMapplsSdk(token)
      .then(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const mappls = window.mappls;
        const map = new mappls.Map(idRef.current, {
          center: lngLatCenter,
          zoom,
          zoomControl: true,
          location: false,
        });
        rawMapRef.current = map; // track immediately so cleanup can always remove it

        const markReady = () => {
          if (cancelled || mapRef.current) return;
          if (map.isStyleLoaded && !map.isStyleLoaded()) return;
          mapRef.current = map;
          setReady(true);
        };

        try {
          map.on("load", markReady);
        } catch {
          /* some builds don't expose .on before load */
        }

        // Poll until the GL style is actually ready (timeout fallback alone races overlays).
        let attempts = 0;
        pollId = setInterval(() => {
          attempts += 1;
          markReady();
          if (mapRef.current || attempts > 40) clearInterval(pollId);
        }, 250);
      })
      .catch(() => {
        onError?.();
      });

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      const instance = rawMapRef.current;
      rawMapRef.current = null;
      mapRef.current = null;
      if (instance) {
        try {
          instance.remove();
        } catch {
          /* SDK may not support remove */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && mapRef.current) {
      mapRef.current.flyTo({ center: lngLatCenter, zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lngLatCenter[0], lngLatCenter[1], zoom]);

  // Register arrow image once after map is ready
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    whenStyleReady(map, () => {
      if (!map.hasImage?.("gs-arrow")) {
        const img = svgToImage(ARROW_SVG);
        img.onload = () => {
          try {
            if (!map.hasImage("gs-arrow")) map.addImage("gs-arrow", img);
          } catch { /* already added */ }
        };
      }
    });
  }, [ready]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    whenStyleReady(map, () => {
      const eventFc = {
        type: "FeatureCollection",
        features: events
          .filter((e) => e.latitude != null && e.longitude != null)
          .map((e) => ({
            type: "Feature",
            properties: {
              color: tierColor(e.tier ?? "Low"),
              radius: selectedId === e.id ? 9 : 3 + (e.impact_score ?? 0) / 14,
              stroke: selectedId === e.id ? "#ffffff" : tierColor(e.tier ?? "Low"),
              sw: selectedId === e.id ? 2 : 1,
            },
            geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
          })),
      };
      upsertSource(map, "gs-events", eventFc);
      upsertLayer(map, {
        id: "gs-events",
        type: "circle",
        source: "gs-events",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.78,
          "circle-stroke-color": ["get", "stroke"],
          "circle-stroke-width": ["get", "sw"],
        },
      });

      const maxCount = Math.max(1, ...hotspots.map((h) => h.count));
      const hotFc = {
        type: "FeatureCollection",
        features: showHeatmap
          ? hotspots.map((h) => ({
              type: "Feature",
              properties: { intensity: h.count / maxCount },
              geometry: { type: "Point", coordinates: [h.lon, h.lat] },
            }))
          : [],
      };
      upsertSource(map, "gs-hotspots", hotFc);
      upsertLayer(map, {
        id: "gs-hotspots",
        type: "circle",
        source: "gs-hotspots",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 14, 40],
          "circle-color": "#ef4444",
          "circle-opacity": ["+", 0.12, ["*", 0.5, ["get", "intensity"]]],
        },
      });
    });
  }, [ready, events, hotspots, showHeatmap, selectedId]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const mappls = window.mappls;

    whenStyleReady(map, () => {
      markersRef.current.forEach((m) => m.remove?.());
      markersRef.current = [];

      // --- Isochrone contours ---
      const isoFeatures = isochrones.flatMap((iso) => {
        if (!iso.geometry?.length) return [];
        return [{
          type: "Feature",
          properties: { color: iso.color, minutes: iso.minutes },
          geometry: { type: "Polygon", coordinates: iso.geometry },
        }];
      });
      upsertSource(map, "gs-isochrones", { type: "FeatureCollection", features: isoFeatures });
      upsertLayer(map, {
        id: "gs-isochrones-fill",
        type: "fill",
        source: "gs-isochrones",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
      });
      upsertLayer(map, {
        id: "gs-isochrones-line",
        type: "line",
        source: "gs-isochrones",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-dasharray": [6, 4],
        },
      });

      // --- Focus radius + marker ---
      const radiusFc = {
        type: "FeatureCollection",
        features:
          focus && focus.lat != null
            ? [
                {
                  type: "Feature",
                  properties: { color: tierColor(focus.tier ?? "High") },
                  geometry: {
                    type: "Polygon",
                    coordinates: [circle(focus.lon, focus.lat, focus.radius_m ?? 500)],
                  },
                },
              ]
            : [],
      };
      upsertSource(map, "gs-radius", radiusFc);
      upsertLayer(map, {
        id: "gs-radius-fill",
        type: "fill",
        source: "gs-radius",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
      });
      upsertLayer(map, {
        id: "gs-radius-line",
        type: "line",
        source: "gs-radius",
        paint: { "line-color": ["get", "color"], "line-width": 2 },
      });

      if (focus && focus.lat != null && mappls?.Marker) {
        const marker = new mappls.Marker({
          map,
          position: { lat: focus.lat, lng: focus.lon },
          popupHtml: focus.label ? `<b>${focus.label}</b>` : undefined,
        });
        markersRef.current.push(marker);
      }

      // --- Diversion / advisory routes ---
      const divFc = {
        type: "FeatureCollection",
        features: [
          ...(diversion
            ? [
                {
                  type: "Feature",
                  properties: { routeType: "secondary", selected: 1 },
                  geometry: { type: "LineString", coordinates: diversion },
                },
              ]
            : []),
          ...diversionRoutes.map((route) => ({
            type: "Feature",
            properties: {
              routeType: route.route_type ?? "secondary",
              selected: activeRouteId
                ? Number(activeRouteId === route.id)
                : Number(route.id === diversionRoutes[0]?.id),
            },
            geometry: { type: "LineString", coordinates: route.geometry },
          })),
        ],
      };
      upsertSource(map, "gs-diversion", divFc);
      upsertLayer(map, {
        id: "gs-diversion",
        type: "line",
        source: "gs-diversion",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "routeType"],
            "primary", "#22c55e",
            "secondary", "#f59e0b",
            "heavy_vehicle", "#ef4444",
            "#38bdf8",
          ],
          "line-width": ["case", ["==", ["get", "selected"], 1], 6, 4],
          "line-opacity": 0.95,
        },
      });

      // --- Traffic routes (volume-weighted, with arrow symbols) ---
      const solidTraffic = trafficRoutes.filter((r) => r.path.length >= 2 && !r.dashArray);
      const dashedTraffic = trafficRoutes.filter((r) => r.path.length >= 2 && r.dashArray);

      const toLineFeatures = (routes: typeof trafficRoutes) =>
        routes.map((route) => ({
          type: "Feature" as const,
          properties: {
            color: route.color,
            weight: Math.max(volumeWeight(route.flow_vph), 3),
          },
          geometry: {
            type: "LineString" as const,
            coordinates: route.path.map(([lat, lon]) => [lon, lat]),
          },
        }));

      const solidFc = { type: "FeatureCollection", features: toLineFeatures(solidTraffic) };
      const dashedFc = { type: "FeatureCollection", features: toLineFeatures(dashedTraffic) };

      upsertSource(map, "gs-traffic", solidFc);
      upsertLayer(map, {
        id: "gs-traffic",
        type: "line",
        source: "gs-traffic",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "weight"],
          "line-opacity": 0.95,
        },
      });

      upsertSource(map, "gs-traffic-dashed", dashedFc);
      upsertLayer(map, {
        id: "gs-traffic-dashed",
        type: "line",
        source: "gs-traffic-dashed",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "weight"],
          "line-opacity": 0.9,
          "line-dasharray": [2, 2],
        },
      });

      // Arrow symbol layer along solid traffic lines
      if (map.hasImage?.("gs-arrow")) {
        upsertLayer(map, {
          id: "gs-traffic-arrows",
          type: "symbol",
          source: "gs-traffic",
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 120,
            "icon-image": "gs-arrow",
            "icon-size": 0.7,
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
          },
        });
      }

      // --- Vehicle barricades (red=hard, amber=soft) ---
      const vehicleBarricades = barricadePoints.filter(
        (p) => p.purpose !== "crowd" && p.type !== "coning"
      );
      const crowdBarriers = barricadePoints.filter(
        (p) => p.purpose === "crowd" || p.type === "coning"
      );
      upsertSource(map, "gs-barricades", {
        type: "FeatureCollection",
        features: vehicleBarricades.map((point) => ({
          type: "Feature",
          properties: {
            label: point.label,
            color: point.type === "soft" ? "#f59e0b" : "#ef4444",
          },
          geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        })),
      });
      upsertLayer(map, {
        id: "gs-barricades",
        type: "circle",
        source: "gs-barricades",
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });

      // --- Crowd-control barriers (teal pedestrian barriers) ---
      upsertSource(map, "gs-crowd", {
        type: "FeatureCollection",
        features: crowdBarriers.map((point) => ({
          type: "Feature",
          properties: { label: point.label },
          geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        })),
      });
      upsertLayer(map, {
        id: "gs-crowd",
        type: "circle",
        source: "gs-crowd",
        paint: {
          "circle-radius": 6,
          "circle-color": "#14b8a6",
          "circle-stroke-color": "#0f766e",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });

      // --- Deployment posts (blue circles) ---
      upsertSource(map, "gs-posts", {
        type: "FeatureCollection",
        features: deploymentPosts.map((post) => ({
          type: "Feature",
          properties: { label: post.label },
          geometry: { type: "Point", coordinates: [post.lon, post.lat] },
        })),
      });
      upsertLayer(map, {
        id: "gs-posts",
        type: "circle",
        source: "gs-posts",
        paint: {
          "circle-radius": 9,
          "circle-color": "#3b82f6",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });

      // --- POI Facilities (hospital/police/fuel/parking) ---
      const poiColors: Record<string, string> = {
        hospital: "#ef4444",
        police: "#1d4ed8",
        fuel: "#f59e0b",
        parking: "#6b7280",
      };
      upsertSource(map, "gs-facilities", {
        type: "FeatureCollection",
        features: facilities.map((f) => ({
          type: "Feature",
          properties: {
            label: f.name,
            category: f.category,
            color: poiColors[f.category] ?? "#888",
          },
          geometry: { type: "Point", coordinates: [f.lon, f.lat] },
        })),
      });
      upsertLayer(map, {
        id: "gs-facilities",
        type: "circle",
        source: "gs-facilities",
        paint: {
          "circle-radius": 7,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      try {
        map.triggerRepaint?.();
      } catch {
        /* optional */
      }
    });
  }, [
    ready,
    focus,
    diversion,
    diversionRoutes,
    activeRouteId,
    barricadePoints,
    deploymentPosts,
    trafficRoutes,
    isochrones,
    facilities,
  ]);

  return (
    <div
      id={idRef.current}
      ref={containerRef}
      style={{ height: "100%", width: "100%" }}
    />
  );
}

function whenStyleReady(map: GLMap, fn: () => void, attempt = 0) {
  if (map.isStyleLoaded?.()) {
    try {
      fn();
    } catch {
      if (attempt < 8) setTimeout(() => whenStyleReady(map, fn, attempt + 1), 300);
    }
    return;
  }
  if (attempt < 40) {
    setTimeout(() => whenStyleReady(map, fn, attempt + 1), 200);
  }
}

function upsertSource(map: GLMap, id: string, data: any) {
  const src = map.getSource(id);
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

function upsertLayer(map: GLMap, layer: any, before?: string) {
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer, before && map.getLayer(before) ? before : undefined);
}

function circle(lon: number, lat: number, radiusM: number, steps = 48): number[][] {
  const coords: number[][] = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return coords;
}
