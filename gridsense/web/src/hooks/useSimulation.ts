"use client";

// Drives the simulation: owns a live Engine and a headless "ghost" baseline
// Engine (same seed + same incidents, no interventions) so the UI can compare
// "with vs without intervention". Steps both in fixed timesteps on rAF, publishes
// throttled snapshots to React, and exposes the live engine ref to the canvas
// (which draws every frame straight from engine state, bypassing React).

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, type IncidentInput } from "@/lib/sim/engine";
import { buildResponsePlan, type ResponsePlan } from "@/lib/sim/decisionEngine";
import type { DiversionStrategy } from "@/lib/sim/incidents";
import type { Metrics, ResourceType, SimSnapshot } from "@/lib/sim/types";

const DT = 0.2; // fixed sim timestep (s)
const SEED = 1337;

export interface SimControls {
  running: boolean;
  speed: number;
  spawnPerMin: number;
}

export function useSimulation() {
  const liveRef = useRef<Engine | null>(null);
  const baseRef = useRef<Engine | null>(null);
  if (!liveRef.current) {
    liveRef.current = new Engine({ seed: SEED, spawnPerMin: 30, applyInterventions: true });
    baseRef.current = new Engine({ seed: SEED, spawnPerMin: 30, applyInterventions: false });
  }

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

  // prime the network so it isn't empty on first paint; also handle Night Watch replay
  useEffect(() => {
    const live = liveRef.current!;
    const base = baseRef.current!;
    if (live.time === 0) {
      for (let i = 0; i < 220; i++) {
        live.step(DT);
        base.step(DT);
      }
      setSnapshot(live.snapshot());
      setBaseline(base.snapshot().metrics);

      // Night Watch replay: auto-inject the scenario written by the NW page.
      try {
        const raw = sessionStorage.getItem("nightwatch_replay");
        if (raw) {
          sessionStorage.removeItem("nightwatch_replay");
          const payload = JSON.parse(raw) as {
            type: Parameters<typeof live.addIncident>[0]["type"];
            edgeId: string;
            severity: Parameters<typeof live.addIncident>[0]["severity"];
            lanesAffected: number;
            durationSec: number;
          };
          const net = live.net;
          const edgeLen = net.edgeLength(payload.edgeId);
          const input = {
            type: payload.type,
            edgeId: payload.edgeId,
            distOnEdge: edgeLen / 2,
            severity: payload.severity,
            lanesAffected: payload.lanesAffected,
            durationSec: payload.durationSec,
          };
          const inc = live.addIncident(input);
          base.addIncident(input);
          setSelectedIncident(inc.id);
        }
      } catch {
        // Ignore parse errors — not a blocker.
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
  }, []);

  // ---- controls ------------------------------------------------------------
  const setRunning = useCallback((r: boolean) => {
    runningRef.current = r;
    setControls((c) => ({ ...c, running: r }));
  }, []);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setControls((c) => ({ ...c, speed: s }));
  }, []);
  const setSpawn = useCallback((n: number) => {
    liveRef.current!.setSpawnRate(n);
    baseRef.current!.setSpawnRate(n);
    setControls((c) => ({ ...c, spawnPerMin: n }));
  }, []);

  const reset = useCallback(() => {
    liveRef.current!.reset();
    baseRef.current!.reset();
    accRef.current = 0;
    setSelectedIncident(null);
    setPlan(null);
    setInterventionAt(null);
    for (let i = 0; i < 220; i++) {
      liveRef.current!.step(DT);
      baseRef.current!.step(DT);
    }
    setSnapshot(liveRef.current!.snapshot());
    setBaseline(baseRef.current!.snapshot().metrics);
  }, []);

  // ---- incident + response -------------------------------------------------
  const injectIncident = useCallback((input: IncidentInput) => {
    // add to both sims so the comparison is fair (baseline never gets the response)
    const inc = liveRef.current!.addIncident(input);
    baseRef.current!.addIncident(input);
    setSelectedIncident(inc.id);
    setPlan(buildResponsePlan(liveRef.current!.net, inc, liveRef.current!.congestionByEdge()));
    return inc;
  }, []);

  const applyResponse = useCallback((p: ResponsePlan) => {
    const live = liveRef.current!;
    live.applyDiversion(p.incidentId, p.diversionStrategy as DiversionStrategy);
    live.applySignalPlan(p.incidentId);
    for (const m of p.manpower) {
      for (let i = 0; i < m.count; i++) live.dispatchResource(m.type, p.incidentId);
    }
    if (p.barricades > 0) live.dispatchResource("barricade" as ResourceType, p.incidentId);
    setInterventionAt(live.time);
  }, []);

  const dispatchOne = useCallback((type: ResourceType, incidentId: string) => {
    liveRef.current!.dispatchResource(type, incidentId);
  }, []);

  return {
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
    dispatchOne,
  };
}
