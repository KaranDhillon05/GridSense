"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapView } from "@/components/MapView";
import type { EventPlannerInput, RecommendResponse, TrafficPhase } from "@/lib/types";
import {
  EventPlannerForm,
  SAMPLE_SCENARIOS,
} from "@/components/playbook/EventPlannerForm";
import { ForecastSummaryCard } from "@/components/playbook/ForecastSummaryCard";
import { PlanSimulationCard } from "@/components/playbook/PlanSimulationCard";
import { PrecedentCard } from "@/components/playbook/PrecedentCard";
import { RecommendedStrategyCard } from "@/components/playbook/RecommendedStrategyCard";
import { OperationalPlaybook } from "@/components/playbook/OperationalPlaybook";
import { ResourcePlanCard } from "@/components/playbook/ResourcePlanCard";
import { DiversionAdvisoryCard } from "@/components/playbook/DiversionAdvisoryCard";
import { FieldChecklist } from "@/components/playbook/FieldChecklist";
import { TrafficImpactCard } from "@/components/playbook/TrafficImpactCard";
import { RoutingIntelligenceCard } from "@/components/playbook/RoutingIntelligenceCard";
import { TrafficMapLegend } from "@/components/playbook/TrafficMapLegend";
import { PillButton } from "@/components/ui/PillButton";
import { prettyCause } from "@/lib/ui";
import { getEdge } from "@/lib/roadGraph";
import { bottleneckPolylines, flattenTrafficRoutes } from "@/lib/trafficMapLayers";
import { saveReportPayload } from "@/lib/reportStore";

const DEFAULT_INPUT: EventPlannerInput = SAMPLE_SCENARIOS[0].input;

export default function PlanConsole() {
  const [input, setInput] = useState<EventPlannerInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<TrafficPhase>("during");
  const [showContingency, setShowContingency] = useState(false);

  async function runWith(payload: EventPlannerInput) {
    setLoading(true);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: RecommendResponse = await res.json();
      setResult(data);
      setSelectedStrategy(data.playbook.recommended_strategy_id);
      setSelectedRouteId(
        data.playbook.advisory.selected_route_id ??
          data.playbook.advisory.route_options?.[0]?.id ??
          null
      );
    } finally {
      setLoading(false);
    }
  }

  function run() {
    return runWith(input);
  }

  useEffect(() => {
    const stashed = sessionStorage.getItem("gridsense_copilot_plan_input");
    if (stashed) {
      sessionStorage.removeItem("gridsense_copilot_plan_input");
      try {
        const partial = JSON.parse(stashed) as Partial<EventPlannerInput>;
        const clean = Object.fromEntries(
          Object.entries(partial).filter(([, v]) => v != null)
        );
        const merged = { ...DEFAULT_INPUT, ...clean } as EventPlannerInput;
        setInput(merged);
        runWith(merged);
        return;
      } catch {
        /* fall through */
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recommendedStrategy = useMemo(
    () =>
      result?.playbook.strategies.find((s) => s.recommended) ??
      result?.playbook.strategies[0],
    [result]
  );

  const selectedRoute = useMemo(() => {
    if (!result) return null;
    if (!result.playbook.advisory.route_options?.length) return result.playbook.advisory.route ?? null;
    const byId = result.playbook.advisory.route_options.find((r) => r.id === selectedRouteId);
    return byId ?? result.playbook.advisory.route_options[0];
  }, [result, selectedRouteId]);

  const trafficRoutes = useMemo(() => {
    if (!result?.traffic_plan) return [];
    const base = flattenTrafficRoutes(result.traffic_plan.routes, activePhase, showContingency, true);
    const bn = bottleneckPolylines(result.traffic_plan.bottleneck_edges, (id) => getEdge(id)?.geometry ?? null);
    return [...base, ...bn];
  }, [result, activePhase, showContingency]);

  const diversionGeom = selectedRoute?.geometry ?? null;

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-var(--nav-height))] bg-[#f5f5f7]">
      <div className="w-full lg:w-[540px] xl:w-[580px] shrink-0 overflow-y-auto p-4 lg:p-6 space-y-4 bg-white border-b lg:border-b-0 lg:border-r border-black/[0.06] lg:max-h-[calc(100vh-var(--nav-height))]">
        <EventPlannerForm value={input} onChange={setInput} onSubmit={run} loading={loading} />
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4 pb-6"
            >
              <ForecastSummaryCard forecast={result.forecast} />
              <PlanSimulationCard
                input={input}
                forecast={result.forecast}
                recommendedStrategyName={recommendedStrategy?.name}
              />
              <PrecedentCard input={input} />
              {result.traffic_plan && <TrafficImpactCard impact={result.traffic_plan.traffic_impact} />}
              {result.traffic_plan && <RoutingIntelligenceCard plan={result.traffic_plan} />}
              {recommendedStrategy && (
                <RecommendedStrategyCard strategy={recommendedStrategy} why={result.playbook.why} />
              )}
              {result.traffic_plan && (
                <div className="surface-panel p-5 text-sm space-y-2">
                  <div className="text-xs font-medium text-[#6e6e73] uppercase tracking-wide">Access corridors</div>
                  {result.traffic_plan.access_corridors.slice(0, 5).map((c) => (
                    <div key={c.id} className="text-[#424245]">
                      {c.name} · {c.direction} · {c.base_capacity_vph} vph
                    </div>
                  ))}
                </div>
              )}
              <OperationalPlaybook
                playbook={result.playbook}
                selectedId={selectedStrategy}
                onSelect={setSelectedStrategy}
                source={result.source}
              />
              <DiversionAdvisoryCard
                advisory={result.playbook.advisory}
                selectedRouteId={selectedRouteId ?? undefined}
                onSelectRoute={setSelectedRouteId}
              />
              <ResourcePlanCard plan={result.playbook.resource_plan} />
              <FieldChecklist checklist={result.playbook.checklist} />
              <PillButton
                type="button"
                className="w-full"
                onClick={() => {
                  saveReportPayload({ result, input });
                  window.open("/plan/report", "_blank");
                }}
              >
                Generate Technical Plan →
              </PillButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 min-w-0 min-h-[420px] lg:min-h-0 relative lg:sticky lg:top-0 lg:h-[calc(100vh-var(--nav-height))]">
        <MapView
          center={[input.lat ?? 12.9716, input.lon ?? 77.5946]}
          zoom={14}
          focus={
            result && input.lat != null && input.lon != null
              ? {
                  lat: input.lat,
                  lon: input.lon,
                  radius_m: result.area?.estimated_radius_m ?? result.forecast.affected_radius_m,
                  tier: result.forecast.tier,
                  label: `${input.event_name || prettyCause(input.cause)} · ${input.expected_attendance.toLocaleString()} · ${activePhase}`,
                }
              : null
          }
          diversion={trafficRoutes.length === 0 ? diversionGeom : null}
          diversionRoutes={trafficRoutes.length === 0 ? (result?.playbook.advisory.route_options ?? []) : []}
          activeRouteId={selectedRouteId}
          barricadePoints={result?.traffic_plan?.barricade_points ?? result?.playbook.barricade_points}
          deploymentPosts={result?.traffic_plan?.deployment_posts ?? result?.playbook.deployment_posts}
          trafficRoutes={trafficRoutes}
          isochrones={result?.mappls_context?.isochrones}
          facilities={result?.mappls_context?.facilities}
        />
        {result && (
          <TrafficMapLegend
            phase={activePhase}
            onPhaseChange={setActivePhase}
            showContingency={showContingency}
            onToggleContingency={() => setShowContingency((v) => !v)}
            isochroneSource={result.mappls_context?.isochrone_source}
            facilitiesSource={result.mappls_context?.facilities_source}
            routeSource={
              result.traffic_plan?.routes.primary_inbound[0]?.geometry_source === "osrm"
                ? "osrm"
                : result.mappls_context?.gateway_matrix_source
            }
          />
        )}
      </div>
    </div>
  );
}
