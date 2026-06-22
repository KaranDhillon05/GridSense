# GridSense — AI Traffic Operations Platform

> **Flipkart Gridlock 2.0** · Problem: *Event-Driven Congestion (Planned & Unplanned)*
> Partners: **MapmyIndia / Mappls** · **Bengaluru Traffic Police (ASTraM)**

GridSense transforms Bengaluru's Traffic Management Centre from a reactive post-gridlock operation into a **predictive, AI-powered command center**. It runs the complete TMC loop — Observe → Detect → Assess → Simulate → Decide → Execute → Monitor → Learn — as a working, deployed platform.

---

## Quick Start

```bash
cd web
npm install
npm run dev      # → http://localhost:3000/operations
```

No API keys, no database, no Python required to run the demo. All ML artifacts are pre-computed and committed. Optional keys unlock live AI narration and real map routing — see [Configuration](#configuration).

---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Data](#the-data)
3. [Solution Overview](#solution-overview)
4. [System Architecture](#system-architecture)
5. [Feature Deep-Dives](#feature-deep-dives)
6. [The ML Pipeline](#the-ml-pipeline)
7. [The Simulation Engine](#the-simulation-engine)
8. [The Operations Platform](#the-operations-platform)
9. [Tech Stack](#tech-stack)
10. [Repository Layout](#repository-layout)
11. [Configuration](#configuration)
12. [Running & Deploying](#running--deploying)
13. [Validation & Honesty](#validation--honesty)

---

## The Problem

Bengaluru loses an estimated **₹3,700 crore annually** to traffic congestion. The city's TMC operates with no predictive layer — when a vehicle breaks down on the Outer Ring Road or a procession blocks MG Road, officers react *after* gridlock has already formed.

For planned events (cricket matches, VIP movements, rallies), preparation is manual, experience-driven, and undocumented. When the same event recurs the following year, the institutional memory is gone.

```
TODAY'S TMC LOOP (broken)
─────────────────────────
Gridlock forms  →  Radio call  →  Officers react  →  30-60 min lost  →  repeat
```

**Three core gaps:**

| Gap | Impact |
|---|---|
| Impact not quantified in advance | No basis for resourcing decisions |
| Deployment is guesswork | Wrong units, wrong junctions, wrong timing |
| No learning from outcomes | Same mistakes next shift, next year |

---

## The Data

**Source:** ASTraM (Automated Signal Traffic Management) anonymized event log, provided by Bengaluru Traffic Police.

```
8,173 incidents  ·  46 columns  ·  ~150 days  ·  Nov 2023 → Apr 2024  ·  Bengaluru-wide
```

### Key Statistics

| Dimension | Detail |
|---|---|
| **Event split** | 7,706 unplanned · 467 planned (construction, public events, processions, VIP, protests) |
| **Top causes** | vehicle_breakdown (4,896) · potholes · construction · water_logging · accident · tree_fall |
| **Road closure** | 676 events required closure |
| **Priority** | 5,030 High · 3,141 Low |
| **Coverage** | 22 corridors · 10 zones · 54 police stations |
| **Resolved events** | 2,777 with measured clearance time → the supervised training set |

### Clearance Time by Cause (operational ground truth)

```
Cause               Median Clearance
──────────────────────────────────────
Pothole             1,490 min
Water logging         790 min
Construction          456 min
Tree fall             218 min
Accident               41 min
Vehicle breakdown      41 min
```

**Key insight:** The distribution is **heavy-tailed**. Water_logging actuals span 73 min → 3,738 min (P10–P90: 34 min → 110 hours). This makes MAE a misleading metric — GridSense optimizes for *tier accuracy* and *uncertainty quantification* instead.

---

## Solution Overview

GridSense is built in two rounds:

- **Round 1 — Planning Intelligence:** Forecast engine + operational playbook + calibrated learning loop
- **Round 2 — Operations Platform:** Vehicle-level micro-simulation + live AI command center (the full TMC loop)

```
GRIDSENSE TMC LOOP (what we built)
────────────────────────────────────────────────────────────────────
Observe      →  Detect   →  Assess      →  Simulate   →  Decide
(live feed)    (ASTraM)    (AI Commander) (Wind Tunnel) (accept plan)
                                                           ↓
Learn        ←  Monitor  ←  Execute     ←──────────────────
(calibration)  (/operations) (deployments)
```

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js 16 App (Vercel)                          │
│                                                                     │
│  /operations  /incidents  /simulation  /plan  /learning  /proof    │
│  /workflows   /resources  /events      /preparedness  /intelligence │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
   ┌───────▼────────┐                ┌────────▼────────┐
   │  lib/ops/*     │                │  lib/sim/*      │
   │  Operations    │                │  Traffic Engine │
   │  Store         │                │  (IDM + signals │
   │  (singleton +  │                │  + incidents +  │
   │  useSyncExt    │                │  resources)     │
   │  ternalStore)  │                └────────┬────────┘
   └───────┬────────┘                         │
           │                                  │
   ┌───────▼──────────────────────────────────▼────────┐
   │              lib/gridsense.ts                      │
   │   forecast() · recommend() · correctionFor()       │
   │   + duration_lookup.json · correction_factors.json │
   └───────┬────────────────────────────────────────────┘
           │
   ┌───────▼────────────────────────────┐
   │  External APIs (server-side only)  │
   │  Cerebras / Groq / Gemini  (LLM)   │
   │  MapmyIndia route_adv/driving      │
   │  OSM Overpass  (data build only)   │
   └────────────────────────────────────┘
```

### State Management Architecture

The Operations Center cannot use React Context because `layout.tsx` is shared and protected. Instead, GridSense uses a **provider-less module singleton** + React 19's `useSyncExternalStore`:

```
┌─────────────────────────────────────────────────────┐
│  lib/ops/store.ts  (module singleton)               │
│                                                     │
│  getOpsState()   ←── any module, any route, API    │
│  subscribe(fn)   ←── React via useSyncExternalStore │
│  emit()          ←── bumps version + notifies       │
│                                                     │
│  Persists to localStorage (gridsense_ops_state_v1)  │
│  Re-seeds if >2h stale (demo always starts alive)   │
└─────────────────────────────────────────────────────┘
           ↑                    ↑
   lib/ops/ticker.ts     app/api/brain/route.ts
   (1s wall = 20 ops-s)  (LLM reads state, writes brief)
```

### Data Flow — From Event to Deployed Plan

```
Input (incident / planned event)
        │
        ▼
┌───────────────────┐     ┌──────────────────────┐
│  Impact Forecast  │────▶│  Precedent Engine     │
│  (ML model +      │     │  findSimilarEvents()  │
│  correction)      │     │  2,777 resolved events│
└───────────────────┘     └──────────────────────┘
        │
        ▼
┌───────────────────┐     ┌──────────────────────┐
│  Playbook Engine  │────▶│  LLM Narration        │
│  buildResponsePlan│     │  (Cerebras/Groq/Gemini│
│  7 strategy types │     │  → rule fallback)     │
└───────────────────┘     └──────────────────────┘
        │
        ▼
┌───────────────────┐     ┌──────────────────────┐
│  Network Planner  │────▶│  MapmyIndia Routing   │
│  OSM graph +      │     │  3 ranked diversion   │
│  Equilibrium      │     │  routes with geometry │
│  assignment       │     └──────────────────────┘
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Strategy Wind     │
│ Tunnel            │
│ simulatePlan()    │
│ Plan A/B/C/D      │
│ ranked by         │
│ veh-hours lost    │
└───────────────────┘
        │
        ▼
  Deploy to ops store → Deployments + Tasks + logOutcome()
```

---

## Feature Deep-Dives

### 1. Impact Forecast Engine

**What it does:** Given any incident (cause, corridor, closure, time of day), outputs a **0–100 Impact Score**, a duration estimate in minutes, and a severity tier — calibrated against real outcomes.

**The scoring formula (auditable, not a black box):**

```
Impact Score (0–100) = 100 × Σ (weightᵢ × normalized_factorᵢ)

Factor              Weight    Source
─────────────────────────────────────────────────────────
Clearance duration   0.34     Learned ML model
Road closure         0.22     Event's closure flag
Cause severity       0.16     Historical median by cause
Location sensitivity 0.16     Corridor load from dataset
Peak-hour timing     0.12     Bengaluru peak windows

Tiers:  ≥70 → Severe  ·  ≥50 → High  ·  ≥30 → Moderate  ·  else Low
```

The UI shows each factor's contribution so officers can understand and challenge the score.

**Calibration (Post-Event Learning):** A temporal 70/30 holdout split (n=834 held-out events, after 2024-03-05) validates correction factors per cause × corridor. Applied results:

```
Metric              Before    After    Change
────────────────────────────────────────────
Tier accuracy       76.1%     77.9%    +1.8pp
Duration-class acc  49.0%     51.0%    +2.0pp
Within ±50%         33.1%     33.8%    +0.7pp
MAE (min)             626       619    -7 min
```

Example: water_logging Mysore Rd forecast shifts from ~20 min → ~133 min after calibration.

---

### 2. OSM Map-Intelligence Routing Engine

Replaced hardcoded compass-ring routing with a real graph-theoretic engine derived from OpenStreetMap.

**Road graph construction:**

```
Overpass API (Greater Bengaluru, 3×3 chunked grid)
        │
        ▼
ml/build_osm_graph.py
        │
        ▼
blr_road_graph.json
  14,860 nodes
  26,900 directed edges
  1,088 hospitals
  True topology (way-split at shared junctions)
  Douglas–Peucker compressed geometry
```

**Routing stack:**

```
networkPlanner.ts
├── cityGraph.ts        Grid spatial index · nearestNode · extractSubgraph
├── graphSearch.ts      Binary-heap Dijkstra (not O(V) scan)
├── capacityModel.ts    BPR volume-delay function (α=0.15, β=4)
│                       freeFlowMin + live traffic override
└── trafficAssignment.ts
    Equilibrium assignment (12 increments)
    Virtual super-source/sink → endogenous load split across approaches
    (No hardcoded percentages)
```

**Example output — Cricket @ Chinnaswamy:**
- Approach split: 50% / 33% / 17% across Queen's Rd, Cubbon Rd, Inner Ring Rd
- Emergency corridor: reserved shortest-time path to nearest hospital
- Barricades: edge-cut at cordon boundary, classified (emergency-gate / managed-entry / hard-closure)

---

### 3. Historical Precedent Engine

**What it does:** For any scenario, retrieves the 15 most similar real past incidents and surfaces what *actually happened* — grounding the forecast in evidence.

```
Weighted similarity score = Σ (wᵢ × matchᵢ)

Dimension        Weight
─────────────────────────
Cause              0.45
Corridor           0.20
Haversine distance 0.15
Road closure       0.12
Peak-hour          0.08
```

**Output:** n matches, same-cause count, P50/P90 actual clearance, closure rate, tier distribution, and `forecast_within_band` flag — if the model's estimate falls outside [P25, P90] of real outcomes, the UI shows an explicit warning.

---

### 4. GridSense Copilot

A dockable AI assistant available on every page. Officers can ask questions in natural language or generate full plans.

**Tool-calling architecture:**

```
User question
     │
     ▼
app/api/copilot/route.ts  (maxDuration=30, ≤3 tool rounds)
     │
     ├── query_stats       →  aggregates.json (8,173 events)
     ├── find_events        →  events_slim.json (full corpus search)
     ├── find_similar_events →  Precedent Engine
     └── plan_event         →  recommend() + buildPlaybook()
                                → returns structured card
                                → deep-link pre-populates /plan
```

**LLM provider selection** (pluggable, `lib/llm.ts`):

```
GEMINI_API_KEY present?   → use Gemini
  else CEREBRAS_API_KEY?  → use Cerebras gpt-oss-120b (1M tokens/day)
    else GROQ_API_KEY?    → use llama-3.3-70b-versatile (100k tokens/day)
      else                → rule engine (always works)
```

---

### 5. Post-Event Learning Loop (`/learning`)

Closes the feedback loop. Every shift, the system compares its forecasts against resolved actuals and updates the calibration.

**The dashboard shows:**

- **Calibration scatter** (log axes): base forecast vs calibrated, y=x reference line
- **Drift chart:** monthly bucket accuracy before/after calibration over 150 days
- **Per-cause reliability table:** base → calibrated, correction factor, P10–P90 actual range, confidence badge
- **Honest error band statement:** explicit about what the model does and doesn't learn (strategy efficacy not in scope — no deployment record in dataset)

---

## The Simulation Engine

### Digital Twin (`/simulation`)

A **microscopic, agent-based traffic simulation** of a Bengaluru CBD. Individual vehicles follow the Intelligent Driver Model (IDM), obey signals, queue behind incidents, and reroute — with a "ghost baseline" running in parallel with no interventions. The gap between the two timelines is the *measured impact* of police response.

**Engine architecture:**

```
lib/sim/
├── network.ts          SimNetwork: directed edges, per-lane offset
│                       interpolation, cached Bézier turn connectors
├── carFollowing.ts     IDM: vehicles never bump
│                       stationary virtual leader = red light / incident
├── signals.ts          Phase grouping by approach axis
│                       adaptive cycle · emergency green-wave preemption
├── demand.ts           Seeded mulberry32 trips between boundary sources
├── routing.ts          Dijkstra/A*/kShortestPaths + closedEdges set
├── incidents.ts        25-type catalog: severity · lanes · duration ·
│                       closesRoad · response template
├── congestion.ts       Emergent spillback detection
├── metrics.ts          Delay veh-min · veh-hrs · queue lengths ·
│                       throughput · gridlock
├── resources.ts        Fleet + depots · mobile units routed to scene
├── decisionEngine.ts   buildResponsePlan: diversion corridors + splits
│                       signal / manpower / barricade plan
└── engine.ts           Deterministic fixed-step orchestrator
```

**Live vs. Baseline (the key insight):**

```
Same seed, same incidents
          │
    ┌─────┴─────┐
    │           │
 Live sim    Ghost baseline
 (response   (do-nothing —
 applied)    routing closed,
             barricades active)
    │           │
    └─────┬─────┘
          │
  metrics.ts measures the gap
  → Delay reduction attributed to
    police response = provable ROI
```

**Network:** Synthetic organic city (96 nodes / 207 edges) — 4 signalized intersections, 4 roundabouts (yield logic), 3 flyovers + 2 bridges (grade-separated), 1 river, divided boulevard with U-turn bays. 100% strongly-connected, 100% routing success, 0 dead-ends.

**Performance:** ~24–25 km/h mean speed at steady state, ~150 active vehicles, 30 veh/min inflow. Renderer: Leaflet dark map + aligned HTML Canvas overlay at 60 fps (React gets 5 Hz snapshots).

**SUMO validation:** The engine is cross-validated against SUMO (academic-standard microsimulator) on the CBD core. **Delay matches SUMO to within ~3%.**

---

### Strategy Wind Tunnel

Runs four competing response plans through the simulation engine for any live incident and ranks them by measured outcome.

```
Plan A — Full recommended   → diversions + signals + units
Plan B — Diversion only     → reroute, no signal changes
Plan C — Signals + units    → override signals + manpower, no diversion
Plan D — Do nothing         → baseline (same as ghost twin)

Ranking: vehicle-hours lost (asc) → resource cost (asc)
```

**On Accept:**
1. Pushes diversions + field units into the ops store as `Deployment`s
2. Sets incident status → `responding`
3. Calls `logOutcome()` → `playbookMemory` (feeds the Operations Intelligence library)

---

## The Operations Platform

GridSense 2.0 transforms the planning tool into a full AI Traffic Operations Platform. All state is stored in the browser via a **provider-less module singleton + `useSyncExternalStore`** — no Context, no Zustand, works with a protected `layout.tsx`.

### Living Twin (the ticker)

```
lib/ops/ticker.ts  (client setInterval, 1 wall-sec = 20 ops-sec)
├── Advances clockMs
├── Moves en-route resources toward incident (decrement etaMin → flip onscene)
├── Progresses incident lifecycle on timers
│   detected → verified → responding → managed → clearing → closed
├── Recomputes metrics
└── Injects a new incident every ~90 seconds
```

State persists to `localStorage (gridsense_ops_state_v1)`. Re-seeds from the ASTraM corpus if >2h stale so the demo always starts with a populated operating picture.

### Platform Pages

| Route | Module | What it does |
|---|---|---|
| `/operations` | Operations Center | Map-first command center. Live incidents/resources/deployments on map. MetricsStrip KPIs. AI ops brief. Copilot 2.0. |
| `/incidents` | Incident Board | Kanban by lifecycle stage (detected → closed). Live cards progress in real time. |
| `/incidents/[id]` | Incident Detail | AI Incident Commander (assessment, precedents, escalation). Strategy Wind Tunnel. Dispatch controls. |
| `/workflows` | Workflow Engine | Task columns + SLA timers. Auto-generated from accepted Wind Tunnel plans. |
| `/resources` | Resource Intelligence | Fleet map (36 units). AI dispatch recommendations — nearest available unit to unresourced incidents. |
| `/events` | Event Ops Center | Planned event calendar. Forecast per event. Stage any event as a live incident. |
| `/digital-twin` | Digital Twin 2.0 | Full-screen ops map with layer toggles (incidents, resources, deployments, risk zones). Emerging-risk detector. |
| `/intelligence` | Ops Intelligence | Best-Known-Response library. Accumulates as Wind Tunnel plans are accepted. |
| `/preparedness` | Night Watch 3.0 | Monte-Carlo batch: "what could go wrong tonight" → resilience grade + pre-position recommendations. |

### AI Operations Brain

```
app/api/brain/route.ts
├── Receives OpsState snapshot (POST from client)
├── LLM call (getLlm() → Cerebras/Groq/Gemini)
│   → OpsBrief { headline, situation, priorities[], recommendations[], escalations[] }
└── lib/ops/brain.ts (deterministic fallback, always instant)
    ├── severe counts → headline
    ├── unassigned incidents → dispatch recommendation
    ├── >70% resource utilization → escalation
    └── longest-open incident → top priority
```

---

## The ML Pipeline

```
ml/
├── prepare.py         CSV → features.parquet, aggregates.json,
│                      hotspots.json, precedents.json (2,777 events)
├── impact_model.py    HistGradientBoostingRegressor → duration model
│                      + scores every event → events_slim.json
├── scoring.py         The auditable 0–100 formula
├── recommend.py       Impact → manpower / barricade / diversion rules
├── learn.py           Temporal 70/30 split → correction_factors.json
│                      + enriched learning.json (drift, scatter, per-cause)
└── build_osm_graph.py Overpass → blr_road_graph.json (14,860 nodes)
```

**Why Python AND TypeScript?**
The Python `ml/` core is the research layer that trains the model and computes the priors. The deployed web app re-implements the same scoring logic in TypeScript (`lib/gridsense.ts`) plus a model-derived lookup table (`duration_lookup.json`) so it runs **fully self-contained on Vercel** — no Python at request time, no cold starts.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Web framework** | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5 |
| **Styling** | Tailwind v4 · Framer Motion · Apple-inspired light theme |
| **Charts** | Recharts (isAnimationActive=false for SSR) |
| **Maps** | Mappls Web SDK v3 (WebGL) · Leaflet + CartoDB dark tiles (fallback) · HTML Canvas (sim overlay) |
| **ML** | Python · pandas · numpy · scikit-learn (HistGradientBoostingRegressor) |
| **AI/LLM** | OpenAI-compatible: Gemini 2.0 / Cerebras gpt-oss-120b / Groq llama-3.3-70b · tool-calling loop |
| **Routing** | MapmyIndia route_adv/driving · OSM Overpass + Dijkstra in-browser |
| **State** | useSyncExternalStore + module singleton (no Zustand, no Context) |
| **Deploy** | Vercel (deploy root: gridsense/web) |

---

## Repository Layout

```
gridsense/
├── data/
│   └── astram_events.csv           Raw anonymized ASTraM log (8,173 events)
│
├── ml/                             Python research core
│   ├── prepare.py                  CSV → cleaned features + all JSON artifacts
│   ├── impact_model.py             Train duration model + score all events
│   ├── scoring.py                  Auditable 0–100 impact score formula
│   ├── recommend.py                Impact → manpower/barricade/diversion rules
│   ├── learn.py                    Predicted-vs-actual calibration
│   ├── build_osm_graph.py          Overpass → 14,860-node Bengaluru road graph
│   ├── build_synthetic_network.py  Generate sim_network.json (active source)
│   ├── build_sim_network.py        OSM CBD extract (kept for reference)
│   ├── artifacts/                  Committed model + JSON priors
│   └── sumo/                       SUMO offline validation pipeline (dev only)
│
├── api/                            FastAPI standalone (local demo, not deployed)
│   ├── main.py
│   └── service.py
│
└── web/                            The Next.js app — this is the product
    ├── public/
    └── src/
        ├── app/
        │   ├── operations/         New flagship — Operations Center
        │   ├── incidents/          Kanban board + [id] detail + Commander
        │   ├── workflows/          Task board + SLA tracking
        │   ├── resources/          Fleet map + AI dispatch
        │   ├── events/             Planned event calendar + [id] ops
        │   ├── digital-twin/       City health layers
        │   ├── intelligence/       Best-Known-Response library
        │   ├── preparedness/       Night Watch 3.0
        │   ├── simulation/         Protected: micro-sim digital twin
        │   ├── plan/               Event planning console + report
        │   ├── learning/           Calibration dashboard
        │   ├── proof/              Historical backtest
        │   ├── command/            Classic monitoring + replay
        │   └── api/                All API routes (brain, copilot, forecast, …)
        │
        ├── components/
        │   ├── ops/                OpsMap, MetricsStrip, IncidentBoard,
        │   │                       WindTunnelPanel, IncidentCommander, …
        │   ├── sim/                SimMap, SimCanvasLayer, ControlBar,
        │   │                       IncidentInjector, ResponsePanel, …
        │   ├── playbook/           ForecastSummaryCard, PrecedentCard,
        │   │                       RoutingIntelligenceCard, …
        │   ├── copilot/            CopilotDock (global)
        │   ├── nightwatch/         NightWatch components
        │   └── ui/                 GlassPanel, KpiCard, PillButton, …
        │
        ├── lib/
        │   ├── gridsense.ts        TS port of scoring + recommend + routing
        │   ├── sim/                Microscopic traffic engine
        │   │   ├── engine.ts       Deterministic fixed-step orchestrator
        │   │   ├── carFollowing.ts IDM model
        │   │   ├── signals.ts      Signal control + emergency preemption
        │   │   ├── incidents.ts    25-type incident catalog
        │   │   ├── resources.ts    Fleet + depot routing
        │   │   ├── decisionEngine.ts buildResponsePlan
        │   │   ├── strategySimulator.ts simulatePlan (Wind Tunnel core)
        │   │   └── planScenario.ts event→scenario bridge
        │   ├── ops/                Operations Center
        │   │   ├── store.ts        Module singleton state
        │   │   ├── seed.ts         Deterministic ASTraM-seeded initial state
        │   │   ├── ticker.ts       Living twin clock
        │   │   ├── brain.ts        Deterministic AI brief fallback
        │   │   ├── windTunnel.ts   Plan A/B/C/D runner + Accept logic
        │   │   └── types.ts        All ops domain types
        │   ├── llm.ts              Pluggable LLM provider (Gemini/Cerebras/Groq)
        │   ├── precedent.ts        Weighted similarity over 2,777 events
        │   ├── playbookMemory.ts   logOutcome / findSimilar (counterfactual)
        │   ├── networkPlanner.ts   OSM graph → barricades + equilibrium routing
        │   └── nightwatch/         Monte-Carlo resilience analysis
        │
        ├── hooks/
        │   ├── useSimulation.ts    Live sim + ghost baseline on rAF
        │   └── useOps.ts           useSyncExternalStore wrapper
        │
        └── data/                   Pre-computed JSON artifacts (committed)
            ├── events_slim.json    Scored event corpus
            ├── aggregates.json     Dataset statistics
            ├── precedents.json     2,777 resolved events with actuals
            ├── correction_factors.json  Calibration by cause × corridor
            ├── duration_lookup.json     Model priors (cause×corridor×peak)
            ├── hotspots.json       High-risk locations
            ├── learning.json       Calibration metrics for /learning
            ├── blr_road_graph.json 14,860-node Bengaluru OSM graph
            └── sim_network.json    CBD digital twin network (96 nodes)
```

### Road Graphs

| Graph | Size | Used for |
|---|---|---|
| `road_graph.json` | 14 nodes | Tiny hand-built CBD fallback (legacy) |
| `blr_road_graph.json` | 14,860 nodes · 26,900 edges | Full-city routing for traffic planner |
| `sim_network.json` | 96 nodes · 207 edges | CBD digital twin microsimulation |

---

## Configuration

All keys are **optional**. Without them, every page still works via deterministic fallbacks. Copy `web/.env.example` → `web/.env.local`.

| Variable | Unlocks | Notes |
|---|---|---|
| `GEMINI_API_KEY` | AI playbook, ops briefs, Copilot | Preferred — highest free limits |
| `CEREBRAS_API_KEY` | Same | `gpt-oss-120b`; 1M tokens/day; set `reasoning_effort:low` |
| `GROQ_API_KEY` | Same | `llama-3.3-70b-versatile`; 100k tokens/day (exhausts fast in demos) |
| `MAPMYINDIA_CLIENT_ID` + `MAPMYINDIA_CLIENT_SECRET` | Live Mappls routing + map tiles | OAuth2 — auto-exchanged for token |
| `MAPPLS_REST_KEY` | Live Mappls enrichment (isochrones, ETAs, POIs) | Static-key alternative |
| `LLM_MODEL` | Override the model name | e.g. `gemini-2.0-flash` |

**Graceful degradation is a first-class feature.** No Mappls key → deterministic mock routing. No LLM key → rule engine with transparent badge (`⚙ rule-based`). The demo never breaks.

---

## Running & Deploying

### Development

```bash
# Web app (all you need for the demo)
cd web
npm install
npm run dev          # → http://localhost:3000/operations

# Regenerate ML artifacts (optional — already committed)
cd gridsense          # repo root
pip install -r requirements.txt
cd ml
python prepare.py     # CSV → all JSON artifacts
python impact_model.py
python learn.py
cp artifacts/{learning,correction_factors,precedents}.json ../web/src/data/

# Regenerate simulation network (optional)
cd ml
python build_synthetic_network.py
# writes web/src/data/sim_network.json

# Optional: standalone Python API
cd api
uvicorn main:app --reload --port 8000
```

### Production Deploy (Vercel)

```bash
cd web
vercel deploy --prod --yes
# Deploy root: gridsense/web
# Project: web · Team: karan-dhillons-projects
```

### Developer Scripts

```bash
npm run validate:routing    # confirm 100% SCC + routing on sim network
npm run export:junctions    # junction audit CSV
npm run parity:save         # snapshot current sim metrics
npm run parity:check        # compare current sim to saved snapshot (SUMO parity)
npm run calibrate           # run engine headless + compare to SUMO ground truth
```

---

## Validation & Honesty

### What's real vs. mocked

| Component | Status |
|---|---|
| Impact forecast model | Real — trained on 8,173 ASTraM events |
| Precedent retrieval | Real — 2,777 resolved events, weighted similarity |
| MapmyIndia routing | Real — OAuth2 → route_adv/driving, 3 ranked routes |
| OSM road graph | Real — 14,860 nodes, Greater Bengaluru |
| LLM (Copilot, playbook, ops brief) | Real — Cerebras/Groq, falls back to rule engine |
| Live ops state / ticker | Seeded deterministic sim (no live ASTraM feed — swap boundary is the `LiveFeedClient` mock in `api/`) |
| Vehicle microsimulation | Real IDM engine; synthetic road network (not real Bengaluru streets — chosen for reliable topology) |

### Simulation vs. SUMO

The traffic engine is cross-validated against SUMO on the CBD core (`ml/sumo/`). **Delay matches SUMO to within ~3%.** The mean speed reads lower because the engine reports vehicle-mean (including queued) vs. SUMO's edge-mean — a measurement definition difference, not a model error.

### Calibration honesty

The Post-Event Learning loop calibrates the **duration forecast** — not strategy efficacy. The ASTraM dataset has no record of which plan was deployed or what the outcome was. Future work: log accepted Wind Tunnel plans and measure actual delay reduction via the ghost-baseline pattern.

### The protected module

`/app/simulation/page.tsx` and all of `lib/sim/*` are treated as a **protected, stable module**. All GridSense 2.0 ops features import from the sim engine (read-only) but never modify it. This ensures the digital twin remains a reliable proof-of-concept baseline.

---

*GridSense — forecast the impact, deploy with precision, prove it in simulation, and learn from every outcome.*
