"use client";

// Like useSimulation but boots the Engine only after the real Bengaluru road
// network (sim_network_real.json) has been fetched and injected as the singleton.

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, type IncidentInput } from "@/lib/sim/engine";
import { buildResponsePlan, type ResponsePlan } from "@/lib/sim/decisionEngine";
import { initRealNetwork } from "@/lib/sim/network_real";
import type { DiversionStrategy } from "@/lib/sim/incidents";
import type { Metrics, ResourceType, SimSnapshot } from "@/lib/sim/types";

const DT = 0.2;
const SEED = 1337;

export interface SimControls {
  running: boolean;
  speed: number;
  spawnPerMin: number;
}

export function useSimulationReal() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveRef = useRef<Engine | null>(null);
  const baseRef = useRef<Engine | null>(null);
  const runningRef = useRef(true);
  const speedRef = useRef(3);
  const accRef = useRef(0);

  const [controls, setControls] = useState<SimControls>({ running: true, speed: 3, spawnPerMin: 30 });
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [baseline, setBaseline] = useState<Metrics | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [plan, setPlan] = useState<ResponsePlan | null>(null);
  const [interventionAt, setInterventionAt] = useState<number | null>(null);

  const selectedIncidentRef = useRef<string | null>(null);
  selectedIncidentRef.current = selectedIncident;

  // Load real network then build engines
  useEffect(() => {
    let cancelled = false;
    initRealNetwork()
      .then(() => {
        if (cancelled) return;
        // Network singleton is now the real one — engines will use it
        liveRef.current = new Engine({ seed: SEED, spawnPerMin: 30, applyInterventions: true });
        baseRef.current = new Engine({ seed: SEED, spawnPerMin: 30, applyInterventions: false });

        // Prime with 220 warm-up steps
        for (let i = 0; i < 220; i++) {
          liveRef.current.step(DT);
          baseRef.current.step(DT);
        }
        setSnapshot(liveRef.current.snapshot());
        setBaseline(baseRef.current.snapshot().metrics);
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animation loop — only runs once engines are ready
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let lastSnap = 0;
    const tick = (now: number) => {
      const real = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (runningRef.current) {
        accRef.current += real * speedRef.current;
        let guard = 0;
        while (accRef.current >= DT && guard < 240) {
          liveRef.current!.step(DT);
          baseRef.current!.step(DT);
          accRef.current -= DT;
          guard++;
        }
      }
      if (now - lastSnap > 200) {
        lastSnap = now;
        setSnapshot(liveRef.current!.snapshot());
        setBaseline(baseRef.current!.snapshot().metrics);
        if (selectedIncidentRef.current) {
          const inc = liveRef.current!.activeIncidents().find((i) => i.id === selectedIncidentRef.current);
          if (inc) {
            setPlan(buildResponsePlan(liveRef.current!.net, inc, liveRef.current!.congestionByEdge()));
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const setRunning = useCallback((r: boolean) => {
    runningRef.current = r;
    setControls((c) => ({ ...c, running: r }));
  }, []);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setControls((c) => ({ ...c, speed: s }));
  }, []);
  const setSpawn = useCallback((n: number) => {
    liveRef.current?.setSpawnRate(n);
    baseRef.current?.setSpawnRate(n);
    setControls((c) => ({ ...c, spawnPerMin: n }));
  }, []);

  const reset = useCallback(() => {
    if (!liveRef.current || !baseRef.current) return;
    liveRef.current.reset();
    baseRef.current.reset();
    accRef.current = 0;
    setSelectedIncident(null);
    setPlan(null);
    setInterventionAt(null);
    for (let i = 0; i < 220; i++) {
      liveRef.current.step(DT);
      baseRef.current.step(DT);
    }
    setSnapshot(liveRef.current.snapshot());
    setBaseline(baseRef.current.snapshot().metrics);
  }, []);

  const injectIncident = useCallback((input: IncidentInput) => {
    if (!liveRef.current || !baseRef.current) return null;
    const inc = liveRef.current.addIncident(input);
    baseRef.current.addIncident(input);
    setSelectedIncident(inc.id);
    setPlan(buildResponsePlan(liveRef.current.net, inc, liveRef.current.congestionByEdge()));
    return inc;
  }, []);

  const applyResponse = useCallback((p: ResponsePlan) => {
    const live = liveRef.current;
    if (!live) return;
    live.applyDiversion(p.incidentId, p.diversionStrategy as DiversionStrategy);
    live.applySignalPlan(p.incidentId);
    for (const m of p.manpower) {
      for (let i = 0; i < m.count; i++) live.dispatchResource(m.type, p.incidentId);
    }
    if (p.barricades > 0) live.dispatchResource("barricade" as ResourceType, p.incidentId);
    setInterventionAt(live.time);
  }, []);

  return {
    ready,
    error,
    liveRef,
    controls,
    snapshot,
    baseline,
    selectedIncident,
    setSelectedIncident,
    plan,
    interventionAt,
    setRunning,
    setSpeed,
    setSpawn,
    reset,
    injectIncident,
    applyResponse,
  };
}
