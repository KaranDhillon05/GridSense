"use client";

import { useSyncExternalStore } from "react";
import { getOpsState, subscribe } from "./store";
import type { OpsState } from "./types";

/** Subscribe to the whole ops state (re-renders on any commit). */
export function useOps(): OpsState {
  return useSyncExternalStore(subscribe, getOpsState, getOpsState);
}

/**
 * Subscribe to a derived slice. NOTE: the selector runs against the same state
 * reference until a commit swaps it, so returning the slice directly is safe —
 * commits always produce a new top-level reference, so React re-checks.
 */
export function useOpsSelector<T>(selector: (s: OpsState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getOpsState()),
    () => selector(getOpsState())
  );
}
