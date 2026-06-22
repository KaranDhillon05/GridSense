"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { MapProps } from "./BengaluruMap";

const BengaluruMap = dynamic(() => import("./BengaluruMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

const MapplsMap = dynamic(() => import("./MapplsMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

function MapLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center text-sm text-[#6e6e73] bg-[#f5f5f7]">
      Loading map…
    </div>
  );
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

// Picks the MapmyIndia (Mappls) GL basemap when a token is available AND the
// browser supports WebGL; otherwise falls back to the Leaflet/Carto raster
// basemap. Both share the same MapProps.
export function MapView(props: MapProps) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [webgl, setWebgl] = useState<boolean>(true);
  const [mapplsFailed, setMapplsFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setWebgl(hasWebGL());
    fetch("/api/maptoken")
      .then((r) => r.json())
      .then((d: { token: string | null }) => alive && setToken(d.token))
      .catch(() => alive && setToken(null));
    return () => {
      alive = false;
    };
  }, []);

  if (token === undefined) return <MapLoading />;

  const useMappls = Boolean(token && webgl && !mapplsFailed);
  const map = useMappls ? (
    <MapplsMap {...props} token={token!} onError={() => setMapplsFailed(true)} />
  ) : (
    <BengaluruMap {...props} />
  );
  return <div className="absolute inset-0 h-full w-full">{map}</div>;
}
