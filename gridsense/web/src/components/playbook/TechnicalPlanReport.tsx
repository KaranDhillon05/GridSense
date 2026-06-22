"use client";

import type {
  RecommendResponse,
  TrafficRoute,
  TrafficPlanOutput,
  MapplsContext,
} from "@/lib/types";
import type { EventPlannerInput } from "@/lib/types";

// --- Helper formatters ---
function pct(v: number) {
  return `${(v * 100).toFixed(0)}%`;
}
function round1(v: number) {
  return v.toFixed(1);
}
function round0(v: number) {
  return Math.round(v).toLocaleString();
}

function RouteRow({ r, label }: { r: TrafficRoute; label: string }) {
  const util = r.utilization;
  const utilColor = util >= 0.9 ? "#ef4444" : util >= 0.7 ? "#f59e0b" : "#22c55e";
  return (
    <tr>
      <td>{r.id}</td>
      <td>{label}</td>
      <td>{round1(r.distance_km)} km</td>
      <td>
        {r.expected_travel_min} min
        {r.eta_source === "mappls" && (
          <span className="badge-live ml-1">Live</span>
        )}
      </td>
      <td>{round0(r.capacity_vph)}</td>
      <td style={{ color: utilColor }}>{pct(r.utilization)}</td>
      <td>{round0(r.assigned_flow_vph)}</td>
    </tr>
  );
}

function Section({
  num,
  title,
  children,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section">
      <h2>
        {num}. {title}
      </h2>
      {children}
    </section>
  );
}

export function TechnicalPlanReport({
  result,
  input,
}: {
  result: RecommendResponse;
  input: EventPlannerInput;
}) {
  const { forecast, traffic_plan, playbook, area, mappls_context } = result;
  const plan = traffic_plan as TrafficPlanOutput | null | undefined;
  const ctx = mappls_context as MapplsContext | undefined;

  // Collect all routes in a flat list for the route-spec table
  const allRoutes: Array<{ route: TrafficRoute; label: string }> = plan
    ? [
        ...plan.routes.primary_inbound.map((r) => ({ route: r, label: "Inbound primary" })),
        ...plan.routes.secondary_inbound.map((r) => ({ route: r, label: "Inbound secondary" })),
        ...plan.routes.primary_outbound.map((r) => ({ route: r, label: "Outbound primary" })),
        ...plan.routes.secondary_outbound.map((r) => ({ route: r, label: "Outbound secondary" })),
        ...plan.routes.through_diversion.map((r) => ({ route: r, label: "Diversion" })),
        ...plan.routes.emergency_access.map((r) => ({ route: r, label: "Emergency" })),
      ]
    : [];

  const impact = plan?.traffic_impact;
  const modeSplit = impact?.mode_split;

  return (
    <div className="technical-plan-report">
      {/* Cover */}
      <div className="report-cover">
        <div className="report-logo">GridSense · ASTraM Intelligence Platform</div>
        <h1>Traffic Management Technical Plan</h1>
        <p className="report-subtitle">
          {input.event_name || input.cause} ·{" "}
          {input.expected_attendance.toLocaleString()} attendees
        </p>
        <p className="report-meta">
          Venue: ({round1(input.lat ?? 0)}, {round1(input.lon ?? 0)}) &nbsp;|&nbsp;
          Hour: {input.hour}:00 &nbsp;|&nbsp; Tier:{" "}
          <strong>{forecast.tier}</strong>
        </p>
        <p className="report-meta muted" style={{ marginTop: 4 }}>
          Generated {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
        </p>
      </div>

      {/* 1. Impact Quantification */}
      <Section num={1} title="Event Impact Quantification">
        <p>
          Crowd-to-vehicle conversion using ASTraM historical occupancy and mode-split
          model for Bengaluru CBD. Private-vehicle and taxi-ridehail trips generate the
          highest demand load on surrounding road corridors.
        </p>
        <table className="report-table">
          <tbody>
            <tr>
              <th>Expected attendance</th>
              <td>{input.expected_attendance.toLocaleString()}</td>
            </tr>
            <tr>
              <th>Total vehicle trips</th>
              <td>{impact ? round0(impact.total_vehicle_trips) : "—"}</td>
            </tr>
            <tr>
              <th>Peak arrival vph</th>
              <td>{impact ? round0(impact.peak_arrival_vph) : "—"}</td>
            </tr>
            <tr>
              <th>Peak dispersal vph</th>
              <td>{impact ? round0(impact.peak_departure_vph) : "—"}</td>
            </tr>
            <tr>
              <th>Dispersal P50 / P90</th>
              <td>
                {impact
                  ? `${impact.time_to_disperse_p50_min} min / ${impact.time_to_disperse_p90_min} min`
                  : "—"}
              </td>
            </tr>
            <tr>
              <th>Baseline network delay</th>
              <td>{impact ? `${round1(impact.baseline_delay_min)} min` : "—"}</td>
            </tr>
            <tr>
              <th>Traffic load factor</th>
              <td>{impact ? round1(impact.traffic_load_factor) + "×" : "—"}</td>
            </tr>
          </tbody>
        </table>

        {modeSplit && (
          <>
            <h3>Mode Split</h3>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>Private car</th>
                  <td>{pct(modeSplit.private_car)}</td>
                </tr>
                <tr>
                  <th>Taxi / ride-hail</th>
                  <td>{pct(modeSplit.taxi_ridehail)}</td>
                </tr>
                <tr>
                  <th>Bus / metro</th>
                  <td>{pct(modeSplit.bus_metro)}</td>
                </tr>
                <tr>
                  <th>Walk</th>
                  <td>{pct(modeSplit.walk)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {ctx?.isochrones?.length ? (
          <>
            <h3>Drive-time Catchment Zones</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Contour</th>
                  <th>Area (km²)</th>
                  <th>Data source</th>
                </tr>
              </thead>
              <tbody>
                {ctx.isochrones.map((iso) => (
                  <tr key={iso.minutes}>
                    <td>{iso.minutes}-min drive-time</td>
                    <td>{round1(iso.area_km2)} km²</td>
                    <td>
                      {ctx.isochrone_source === "mappls" ? (
                        <span className="badge-live">Live · Mappls Isochrone API</span>
                      ) : (
                        <span className="badge-model">Modelled estimate</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {impact?.junction_queue_risk?.length ? (
          <>
            <h3>Junction Spillback Risk</h3>
            <ul>
              {impact.junction_queue_risk.map((j) => (
                <li key={j.junction}>
                  <strong>{j.junction}</strong> — {j.spillback_probability}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      {/* 2. Traffic Management Plan */}
      <Section num={2} title="Traffic Management Plan">
        {plan?.plan_source === "network" ? (
          <p>
            Every decision below is derived from the real Bengaluru road network (OpenStreetMap):
            the cordon edge-cut sets the barricades, an incremental BPR user-equilibrium assignment
            distributes inbound/outbound demand across the actual arterials, through-traffic is
            diverted on residual-graph shortest paths around the cordon, and a shortest-time corridor
            to the nearest hospital is reserved (never barricaded).
          </p>
        ) : (
          <p>
            Corridors are assigned by capacity-weighted demand split, then every route is
            snapped to the real road network (OSRM / OpenStreetMap) so geometry aligns with
            the map and follows actual streets.
          </p>
        )}
        {plan?.ops_brief && (
          <p style={{ fontStyle: "italic" }}>
            <strong>Operations brief: </strong>
            {plan.ops_brief}
          </p>
        )}
        {plan?.methodology && (
          <p className="report-muted">
            <strong>Method: </strong>
            {plan.methodology}
          </p>
        )}
        {ctx?.gateway_matrix_source === "mappls" && (
          <p>Travel times are augmented with real-time durations from the Mappls Distance Matrix (traffic) API.</p>
        )}

        {ctx?.gateway_matrix?.length ? (
          <>
            <h3>Gateway Travel Times</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Corridor</th>
                  <th>Distance</th>
                  <th>Duration</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {ctx.gateway_matrix.map((g) => (
                  <tr key={g.corridor_id}>
                    <td>{g.corridor_name}</td>
                    <td>{round1(g.distance_km)} km</td>
                    <td>{round1(g.duration_min)} min</td>
                    <td>
                      {g.source === "mappls" ? (
                        <span className="badge-live">Live</span>
                      ) : (
                        <span className="badge-model">Modelled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {allRoutes.length > 0 && (
          <>
            <h3>Route Specifications</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Distance</th>
                  <th>ETA</th>
                  <th>Capacity</th>
                  <th>Utilization</th>
                  <th>Assigned flow</th>
                </tr>
              </thead>
              <tbody>
                {allRoutes.map(({ route, label }) => (
                  <RouteRow key={route.id} r={route} label={label} />
                ))}
              </tbody>
            </table>
          </>
        )}

        {plan?.access_corridors?.length ? (
          <>
            <h3>Access Corridors</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Corridor</th>
                  <th>Direction</th>
                  <th>Road class</th>
                  <th>Base capacity</th>
                </tr>
              </thead>
              <tbody>
                {plan.access_corridors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.direction}</td>
                    <td>{c.road_class}</td>
                    <td>{round0(c.base_capacity_vph)} vph</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {ctx?.facilities?.length ? (
          <>
            <h3>Emergency Facilities Along Routes</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Category</th>
                  <th>Distance from route</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {ctx.facilities.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td style={{ textTransform: "capitalize" }}>{f.category}</td>
                    <td>{f.distance_m}m</td>
                    <td>
                      {ctx.facilities_source === "mappls" ? (
                        <span className="badge-live">Live · Mappls POI</span>
                      ) : (
                        <span className="badge-model">Modelled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Section>

      {/* 3. Algorithm Selection & Justification */}
      <Section num={3} title="Algorithm Selection & Justification">
        {plan?.plan_source === "network" ? (
          <>
            <h3>Road network — real OpenStreetMap graph</h3>
            <p>
              Routing runs on a topologically-correct Bengaluru road graph (~15k intersections /
              27k directed edges) built from OpenStreetMap via the Overpass API. Edge capacity is
              lanes × per-class saturation flow; free-flow time is length ÷ class speed.
            </p>
            <h3>Inbound &amp; Outbound — incremental BPR user-equilibrium assignment</h3>
            <p>
              Demand is loaded onto the network in increments; each increment takes the
              current-cheapest path under a Bureau-of-Public-Roads congestion cost, so as arterials
              fill the load spills onto other real approaches. The split across corridors therefore
              EMERGES from the network rather than being assumed:
            </p>
            <pre className="code-block">
              {`cost(edge) = base_time × (1 + α·(flow/capacity)^β),  α=0.9, β=4
base_time  = live Mappls ETA (if available) else free-flow time
assignment = Σ increments of demand routed on the current shortest path`}
            </pre>
            <h3>Barricades — cordon edge-cut</h3>
            <p>
              The barricades are exactly the edges crossing the cordon boundary (one endpoint inside,
              one outside) — the only physical entry/exit points. Each is classified by role:
              emergency-corridor crossing → staffed gate; active approach → metered entry; otherwise →
              hard closure with through-traffic diverted.
            </p>
            <h3>Diversion — residual-graph shortest path</h3>
            <p>
              For through-movements whose natural path crosses the closed cordon, the bypass is the
              shortest path in the residual graph (cordon-interior edges removed) — a genuine
              route around the closure, with the added distance reported.
            </p>
            <h3>Emergency access — reserved shortest-time corridor</h3>
            <p>
              The nearest hospital is connected to the venue by the shortest free-flow-time path;
              its edges are reserved (excluded from public assignment) and its boundary crossing is a
              staffed gate, never hard-closed.
            </p>
          </>
        ) : (
          <>
        <h3>Inbound &amp; Outbound Routing — A* (heuristic pathfinding)</h3>
        <p>
          A* is applied to all inbound and outbound corridors. A haversine distance
          heuristic provides an admissible lower bound, guaranteeing optimality while
          pruning the search space. Edge costs are congestion-weighted:
        </p>
        <pre className="code-block">
          {`cost(edge) = free_flow_time × (1 + 0.3 × utilization)
heuristic(node) = haversine(node, venue) / mean_speed_m_per_s`}
        </pre>
        <p>
          K-shortest paths (edge-exclusion variant, k=3) generate the pool of inbound /
          outbound candidates that demand is then split across by capacity ratio.
        </p>

        <h3>Emergency Access — Dijkstra (guaranteed shortest path)</h3>
        <p>
          Emergency corridors use Dijkstra (no heuristic) to guarantee the absolute
          shortest-distance path to the venue. The lack of heuristic is intentional:
          emergency vehicles have the authority to clear traffic, so congestion weighting
          is removed and distance is the only optimisation criterion.
        </p>

        <h3>Diversion &amp; Through-Traffic — K-shortest + Edge Ban</h3>
        <p>
          Through-traffic diversion routes avoid the primary event corridors by banning
          those edge IDs from the graph. This forces true route diversity rather than
          near-duplicates. The edge-ban set is derived from barricade placement and
          road-closure zones.
        </p>
          </>
        )}

        {ctx?.predictive_diversion_source === "mappls" && (
          <>
            <h3>Primary Diversion — Mappls Predictive Routing</h3>
            <p>
              The recommended diversion geometry is sourced from the Mappls Predictive
              Routing API (<code>speedTypes=traffic</code>, future{" "}
              <code>date_time</code> matched to the event hour). This provides a
              road-snapped, turn-by-turn aware path with real congestion forecasts,
              replacing the synthetic arc used in fallback mode.
            </p>
          </>
        )}

        <h3>Demand Model</h3>
        <p>
          Total vehicle demand is derived from attendance via a crowd-to-trip conversion
          factor calibrated on ASTraM historical data for Bengaluru CBD events (occupancy
          1.8 persons/vehicle, mode split as per Section 1). Demand is split across
          routes proportional to their residual capacity:
        </p>
        <pre className="code-block">
          {`flow_i = total_demand × (capacity_i / Σ capacity_j)`}
        </pre>
      </Section>

      {/* 4. Risk & Contingency */}
      <Section num={4} title="Risk Analysis &amp; Contingency Planning">
        {plan?.risks?.length ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Likelihood</th>
                <th>Impact</th>
                <th>Trigger</th>
                <th>Contingency action</th>
              </tr>
            </thead>
            <tbody>
              {plan.risks.map((r, i) => (
                <tr key={i}>
                  <td>{r.risk}</td>
                  <td>{r.likelihood}</td>
                  <td>{r.impact}</td>
                  <td>{r.trigger}</td>
                  <td>
                    {r.contingency_action}
                    {r.routes_to_activate?.length
                      ? ` (activate: ${r.routes_to_activate.join(", ")})`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>
            {playbook.strategies
              .filter((s) => !s.recommended)
              .slice(0, 3)
              .map((s) => (
                <span key={s.id}>
                  <strong>{s.name}:</strong> {s.use_when}
                  <br />
                </span>
              ))}
          </p>
        )}

        {impact?.dispersal_scenarios?.length ? (
          <>
            <h3>Dispersal Scenarios</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>P50 disperse</th>
                  <th>P90 disperse</th>
                  <th>Peak queue delay</th>
                  <th>Routes used</th>
                </tr>
              </thead>
              <tbody>
                {impact.dispersal_scenarios.map((s) => (
                  <tr key={s.scenario}>
                    <td>{s.scenario}</td>
                    <td>{s.time_to_disperse_p50_min} min</td>
                    <td>{s.time_to_disperse_p90_min} min</td>
                    <td>{round1(s.peak_queue_delay_min)} min</td>
                    <td>{s.routes_used}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Section>

      {/* 5. Visual Map — placeholder note (actual map renders in the console) */}
      <Section num={5} title="Visual Traffic Map">
        <div className="map-placeholder">
          <p>
            The interactive traffic map with colour-coded routes, directional arrow
            indicators, volume-weighted polylines, isochrone catchment zones,
            barricade/post markers, and POI facilities is available in the GridSense
            planning console at <strong>/plan</strong>.
          </p>
          <p>
            For print inclusion, take a screenshot of the map from the console before
            using browser print / export PDF.
          </p>
          <table className="report-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Layer</th>
                <th>Description</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Inbound / outbound routes</td>
                <td>Blue / orange polylines, volume-weighted thickness, directional arrows</td>
                <td>
                  {plan?.routes.primary_inbound[0]?.geometry_source === "osrm"
                    ? "Real road network (OSRM / OpenStreetMap)"
                    : "Synthetic road graph"}
                  {ctx?.gateway_matrix_source === "mappls" ? " + Mappls real ETAs" : ""}
                </td>
              </tr>
              <tr>
                <td>Diversion routes</td>
                <td>Green polylines; road-snapped when Mappls predictive API responds</td>
                <td>{ctx?.predictive_diversion_source === "mappls" ? "Mappls Predictive Routing" : "Synthetic arc"}</td>
              </tr>
              <tr>
                <td>Catchment zones</td>
                <td>Dashed polygon overlays at 10 min and 20 min drive-time</td>
                <td>{ctx?.isochrone_source === "mappls" ? "Mappls Isochrone API" : "Radial estimate"}</td>
              </tr>
              <tr>
                <td>POI facilities</td>
                <td>Colour-coded circle markers: red=hospital, blue=police, amber=fuel, grey=parking</td>
                <td>{ctx?.facilities_source === "mappls" ? "Mappls POI Along Route" : "Hardcoded offsets"}</td>
              </tr>
              <tr>
                <td>Barricades / posts</td>
                <td>Red B markers (barricades) and blue P markers (deployment posts)</td>
                <td>Traffic plan (rule engine)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 6. Implementation & Signage */}
      <Section num={6} title="Implementation, Signage &amp; Field Checklist">
        <h3>Resource Plan</h3>
        <table className="report-table">
          <tbody>
            <tr>
              <th>Head constables</th>
              <td>{playbook.resource_plan.head_constables}</td>
            </tr>
            <tr>
              <th>Constables</th>
              <td>{playbook.resource_plan.constables}</td>
            </tr>
            <tr>
              <th>Wardens / volunteers</th>
              <td>{playbook.resource_plan.wardens}</td>
            </tr>
            <tr>
              <th>Shifts</th>
              <td>{playbook.resource_plan.shifts}</td>
            </tr>
            <tr>
              <th>Officers range</th>
              <td>{playbook.resource_plan.officers_range}</td>
            </tr>
            <tr>
              <th>Barricades range</th>
              <td>{playbook.resource_plan.barricades_range}</td>
            </tr>
            {playbook.resource_plan.special_units?.length > 0 && (
              <tr>
                <th>Special units</th>
                <td>{playbook.resource_plan.special_units.join(", ")}</td>
              </tr>
            )}
          </tbody>
        </table>

        {plan?.signage?.length ? (
          <>
            <h3>Signage Requirements</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Location</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {plan.signage.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textTransform: "capitalize" }}>{s.phase.replace("_", " ")}</td>
                    <td>{s.location}</td>
                    <td>{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {playbook.checklist && (
          <>
            <h3>Field Checklist</h3>
            {(["before", "during", "after"] as const).map((phase) => {
              const items = playbook.checklist[phase];
              if (!items?.length) return null;
              return (
                <div key={phase} style={{ marginBottom: 8 }}>
                  <strong style={{ textTransform: "capitalize" }}>{phase} event</strong>
                  <ul style={{ margin: "4px 0 0 16px" }}>
                    {items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </>
        )}

        {plan?.deployment_posts?.length ? (
          <>
            <h3>Deployment Posts</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Role</th>
                  <th>Officers</th>
                  <th>Shift</th>
                </tr>
              </thead>
              <tbody>
                {plan.deployment_posts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.role}</td>
                    <td>{p.officers}</td>
                    <td>{p.shift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {plan?.barricade_points?.length ? (
          <>
            <h3>Barricade Placement</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Type</th>
                  <th>Officers required</th>
                </tr>
              </thead>
              <tbody>
                {plan.barricade_points.map((b) => (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td>{b.type}</td>
                    <td>{b.officers_required}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Section>

      {/* Footer */}
      <div className="report-footer">
        <p>
          GridSense · Flipkart Gridlock 2.0 &nbsp;|&nbsp; ASTraM anonymised event data
          (Bengaluru) &nbsp;|&nbsp; Road network: synthetic CBD graph + Mappls API
          augmentation &nbsp;|&nbsp; Confidence: {playbook.resource_plan.confidence}
        </p>
        <p className="muted" style={{ fontSize: 10, marginTop: 2 }}>
          This plan is an AI/algorithm-assisted recommendation and must be reviewed by the
          senior traffic officer before deployment.
        </p>
      </div>
    </div>
  );
}
