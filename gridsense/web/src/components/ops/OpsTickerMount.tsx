"use client";

import { useEffect } from "react";
import { hydrateFromStorage } from "@/lib/ops/store";
import { startTicker, stopTicker } from "@/lib/ops/ticker";

/**
 * Mount once (on the Operations Center) to bring the twin to life: restore any
 * fresh persisted state, then start the ops clock. Unmount stops the clock.
 */
export function OpsTickerMount() {
  useEffect(() => {
    hydrateFromStorage();
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) startTicker();
    return () => stopTicker();
  }, []);
  return null;
}
