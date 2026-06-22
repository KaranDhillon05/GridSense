// Routing for the simulation: heap-based pathfinding with route caching.
// Used for initial trip routes, congestion-aware reroutes after closures, and
// Yen's k-shortest diversion alternatives.

import {
  aStarWithContext,
  buildSearchContext,
  dijkstraWithContext,
  kShortestPaths,
  type PathResult,
  type SearchContext,
} from "@/lib/pathfinding";
import type { SimNetwork } from "./network";

const MAX_CACHE = 512;
const CACHE_TTL_MS = 5000;

type CacheEntry = { edges: string[]; at: number; closedKey: string };

let searchCtx: SearchContext | null = null;
let ctxNet: SimNetwork | null = null;
const routeCache = new Map<string, CacheEntry>();
let closedVersion = 0;

function closedKey(closed: Set<string>): string {
  if (closed.size <= 8) return [...closed].sort().join(",");
  return `v${closedVersion}:${closed.size}`;
}

export function bumpClosedVersion() {
  closedVersion++;
  if (routeCache.size > MAX_CACHE) routeCache.clear();
}

function getCtx(net: SimNetwork): SearchContext {
  if (ctxNet !== net || !searchCtx) {
    searchCtx = buildSearchContext(net.nodes, net.edges);
    ctxNet = net;
    routeCache.clear();
  }
  return searchCtx;
}

function cacheGet(key: string, closed: Set<string>): string[] | null | undefined {
  const hit = routeCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    routeCache.delete(key);
    return undefined;
  }
  if (hit.closedKey !== closedKey(closed)) return undefined;
  return hit.edges;
}

function cacheSet(key: string, closed: Set<string>, edges: string[] | null) {
  if (routeCache.size >= MAX_CACHE) {
    const first = routeCache.keys().next().value;
    if (first) routeCache.delete(first);
  }
  routeCache.set(key, {
    edges: edges ?? [],
    at: Date.now(),
    closedKey: closedKey(closed),
  });
}

export function routeBetween(
  net: SimNetwork,
  start: string,
  goal: string,
  closed: Set<string>,
  utilization?: Map<string, number>
): string[] | null {
  const cacheKey = `${start}|${goal}|${utilization ? "a" : "d"}`;
  const cached = cacheGet(cacheKey, closed);
  if (cached !== undefined) return cached && cached.length ? cached : null;

  const ctx = getCtx(net);
  const res = utilization
    ? aStarWithContext(ctx, start, goal, closed, utilization, 0.9)
    : dijkstraWithContext(ctx, start, goal, closed);

  const edges = res?.edge_ids ?? null;
  cacheSet(cacheKey, closed, edges);
  return edges;
}

/** k distinct diversion corridors between two nodes (Yen's algorithm). */
export function diversionRoutes(
  net: SimNetwork,
  start: string,
  goal: string,
  closed: Set<string>,
  k = 3,
  utilization?: Map<string, number>
): PathResult[] {
  return kShortestPaths(net.nodes, net.edges, start, goal, closed, k, utilization, 0.9);
}

/** Re-route a vehicle from its current node toward its destination. */
export function reroute(
  net: SimNetwork,
  currentNode: string,
  destNode: string,
  closed: Set<string>,
  utilization: Map<string, number>
): string[] | null {
  if (currentNode === destNode) return [];
  return routeBetween(net, currentNode, destNode, closed, utilization);
}

export function clearRouteCache() {
  routeCache.clear();
  searchCtx = null;
  ctxNet = null;
}
