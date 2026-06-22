"use client";

// Traffic Command Center — live vehicle-level digital twin of the Bengaluru CBD.
// Inject incidents on the real map, watch congestion spill back, and apply the
// recommended response to measure delay reduction vs a no-intervention baseline.

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useSimulation } from "@/hooks/useSimulation";
import { ControlBar } from "@/components/sim/ControlBar";
import { IncidentInjector } from "@/components/sim/IncidentInjector";
import { IncidentList } from "@/components/sim/IncidentList";
import { ResponsePanel } from "@/components/sim/ResponsePanel";
import { MetricsPanel } from "@/components/sim/MetricsPanel";
import { Legend } from "@/components/sim/Legend";
import { RouteTestPanel, type RouteTestState } from "@/components/sim/RouteTestPanel";
import { reroute } from "@/lib/sim/routing";
import { makeVehicle } from "@/lib/sim/demand";
import type { EdgePick } from "@/components/sim/SimMap";
import type { IncidentInput } from "@/lib/sim/engine";

const SimMap = dynamic(() => import("@/components/sim/SimMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-white/40 text-sm bg-[#0b0e14]">
      Loading digital twin…
    </div>
  ),
});

export default function SimulationPage() {
  const sim = useSimulation();
  const [pick, setPick] = useState<EdgePick | null>(null);
  const [debug, setDebug] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [testRoute, setTestRoute] = useState<RouteTestState>({ isActive: false });
  const [showTestPanel, setShowTestPanel] = useState(false);

  const incidents = sim.snapshot?.incidents ?? [];
  const selectedInc = incidents.find((i) => i.id === sim.selectedIncident) ?? null;
  const applied = selectedInc?.responseApplied ?? false;

  // Build list of all junctions with names
  const allJunctions = useMemo(() => {
    if (!sim.liveRef.current) return [];
    const net = sim.liveRef.current.net;
    const result: Array<{ jid: number; nodeId: string; name?: string }> = [];
    for (const node of net.nodes.values()) {
      const jid = net.junctionId.get(node.id);
      if (jid != null) {
        result.push({ jid, nodeId: node.id, name: node.name });
      }
    }
    result.sort((a, b) => a.jid - b.jid);
    return result;
  }, [sim.liveRef.current?.net]);

  // Highlight diversion edges OR test route edges
  const highlightEdges = useMemo(() => {
    if (testRoute.isActive && testRoute.route) {
      return testRoute.route;
    }
    if (!sim.plan) return [] as string[];
    return sim.plan.diversions.flatMap((d) => d.edgeIds);
  }, [sim.plan, testRoute]);

  const roadName = pick ? sim.liveRef.current?.net.edge(pick.edgeId)?.name ?? "road" : "";
  const laneCount = pick ? sim.liveRef.current?.net.laneCount(pick.edgeId) ?? 1 : 1;

  const onInject = (input: IncidentInput) => {
    sim.injectIncident(input);
    setPick(null);
  };

  const handleStartTest = (srcJid: number, dstJid: number) => {
    const eng = sim.liveRef.current;
    if (!eng) return;
    const net = eng.net;

    // Find node ids
    const srcNodeId = Array.from(net.junctionId.entries()).find(([, jid]) => jid === srcJid)?.[0];
    const dstNodeId = Array.from(net.junctionId.entries()).find(([, jid]) => jid === dstJid)?.[0];

    if (!srcNodeId || !dstNodeId) return;

    // Route using pathfinding
    const route = reroute(net, srcNodeId, dstNodeId, new Set(), new Map());

    if (!route || !route.length) {
      alert(`No route found from J${srcJid} to J${dstJid}`);
      return;
    }

    // Inject 5 test vehicles
    for (let i = 0; i < 5; i++) {
      const veh = makeVehicle(eng.vehicles.length + 1000 + i, "car", route, srcNodeId, dstNodeId, eng.time, net);
      eng.vehicles.push(veh);
    }

    setTestRoute({
      sourceJid: srcJid,
      destJid: dstJid,
      route: route,
      isActive: true,
    });

    setShowTestPanel(false);
  };

  const handleConfirmTest = () => {
    setTestRoute({ isActive: false });
  };

  const handleCancelTest = () => {
    setTestRoute({ isActive: false });
    setShowTestPanel(false);
  };

  return (
    <div className="h-[calc(100vh-var(--nav-height))] w-full flex bg-[#0b0e14] text-white overflow-hidden">
      {/* map + overlays */}
      <div className="relative flex-1 min-w-0">
        <SimMap engineRef={sim.liveRef} highlightEdges={highlightEdges} debug={debug} showEdges={showEdges} onPick={setPick} />

        <div className="absolute top-3 left-3 right-3 z-[500] pointer-events-none">
          <div className="pointer-events-auto inline-flex max-w-full">
            <ControlBar
              controls={sim.controls}
              metrics={sim.snapshot?.metrics ?? null}
              debug={debug}
              showEdges={showEdges}
              onRunning={sim.setRunning}
              onSpeed={sim.setSpeed}
              onSpawn={sim.setSpawn}
              onReset={sim.reset}
              onToggleDebug={() => setDebug((d) => !d)}
              onToggleEdges={() => setShowEdges((s) => !s)}
              onTestRoute={() => setShowTestPanel(true)}
            />
          </div>
        </div>

        {showTestPanel && (
          <div className="absolute top-20 left-3 z-[610]">
            <RouteTestPanel
              engine={sim.liveRef.current}
              allJunctions={allJunctions}
              testState={testRoute}
              onStartTest={handleStartTest}
              onConfirmTest={handleConfirmTest}
              onCancelTest={handleCancelTest}
            />
          </div>
        )}

        {pick && (
          <div className="absolute top-20 left-3 z-[600]">
            <IncidentInjector pick={pick} roadName={roadName} laneCount={laneCount} onInject={onInject} onCancel={() => setPick(null)} />
          </div>
        )}

        <div className="absolute bottom-3 left-3 z-[500] w-[300px]">
          <Legend />
        </div>

        <div className="absolute bottom-3 right-3 z-[500] text-[10px] text-white/30">
          Synthetic city network · IDM car-following · {sim.snapshot?.vehicleCount ?? 0} vehicles
        </div>
      </div>

      {/* command sidebar */}
      <aside className="w-[380px] shrink-0 border-l border-white/10 bg-[#0d1118] overflow-y-auto p-3 space-y-3">
        <div>
          <div className="text-base font-semibold">Command Center</div>
          <div className="text-[11px] text-white/45">Bengaluru CBD · ASTraM digital twin</div>
        </div>

        <IncidentList
          incidents={incidents}
          engine={sim.liveRef.current}
          selected={sim.selectedIncident}
          onSelect={sim.setSelectedIncident}
        />

        {selectedInc && sim.plan && (
          <ResponsePanel
            plan={sim.plan}
            applied={applied}
            resources={sim.snapshot?.resources ?? []}
            onApply={sim.applyResponse}
          />
        )}

        <MetricsPanel
          live={sim.snapshot?.metrics ?? null}
          baseline={sim.baseline}
          interventionAt={sim.interventionAt}
          hasIncident={incidents.length > 0}
        />
      </aside>
    </div>
  );
}
