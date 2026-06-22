# GridSense — Event-Driven Congestion Intelligence

**Flipkart Gridlock 2.0 · Problem: Event-Driven Congestion (Planned & Unplanned)**
Partners: MapmyIndia · Bengaluru Traffic Police (ASTraM)

GridSense turns historical ASTraM event data into **forecasted traffic impact** and an
**auto-generated deployment plan** (manpower, barricading, diversion) for any event —
before it happens — and closes the loop by learning from how each event actually resolves.

It directly answers the three stated gaps:

| Stated gap | GridSense answer |
|---|---|
| Event impact is not quantified in advance | A **0–100 Impact Score** with a transparent factor breakdown, backed by a learned clearance-time model |
| Resource deployment is experience-driven | A **rules-from-data recommender** that outputs concrete manpower / barricade / diversion plans |
| No post-event learning system | A **predicted-vs-actual learning loop** that measures accuracy by cause & corridor and feeds back |

---

## What's in the data

Real, anonymized ASTraM event log: **8,173 events · 2023-11-09 → 2024-04-08 · Bengaluru-wide.**
Mostly unplanned (7,706) with 467 planned events (construction, public events, processions,
VIP movement, protests). There is **no direct congestion-severity label** — so impact is
built from strong proxies the data *does* contain: clearance duration, road-closure flag,
priority, cause, and corridor/zone/junction. PII is pre-redacted.

## How the Impact Score works (auditable, not a black box)

```
Impact (0–100) = 100 × Σ  weightᵢ · factorᵢ
```

| Factor | Weight | Source |
|---|---|---|
| Clearance duration | 0.34 | learned duration model (below) |
| Road closure | 0.22 | event flag |
| Cause severity | 0.16 | historical median clearance per cause |
| Location sensitivity | 0.16 | corridor traffic load |
| Peak timing | 0.12 | Bengaluru peak windows (IST) |

The UI shows each factor's contribution ("why this score"), so an officer can trust and
override it.

### The learned model

A `HistGradientBoostingRegressor` predicts **clearance duration** from event features
(cause, corridor, zone, vehicle type, priority, closure, planned, hour, day, peak).
Trained on the 2,777 resolvable events.

- **Median absolute error: ~36 min** (the operationally relevant metric; the mean is
  inflated by a few multi-day events).
- Rankings match ground truth: pot-holes / water-logging / construction score highest,
  vehicle-breakdown / accident clear fastest.

## What's learned vs. AI-generated vs. rule-based (honest breakdown)

| Layer | How it's produced |
|---|---|
| Impact score, tier, expected clearance, affected radius | **Trained model** (`HistGradientBoostingRegressor`) + **data-derived priors** (cause-severity, corridor-sensitivity computed from the 8,173 events) |
| Management strategies, "why", advisory, checklist | **LLM (Groq / Llama)** — grounded on the forecast above + real ASTraM statistics (this-cause / this-corridor median clearance, event density). Falls back to a deterministic **rule engine** if no API key |
| Manpower / barricade numbers (resource_plan) | **Rule formulas** over tier × junctions × closure — kept reproducible even when AI is on |

The dataset has **no labels** for which strategy was deployed or its outcome (`assigned_to_police_id` is filled on ~1.6% of rows), so the strategy layer cannot be supervised-trained — instead the LLM reasons over the data-grounded forecast and historical evidence, and the UI labels each playbook **✨ AI-generated** or **⚙ rule-based** so it's transparent.

### Enabling AI (optional)
Copy `web/.env.example` → `web/.env.local` and set a free **Groq** key (`https://console.groq.com/keys`). Without it the app uses the rule engine, so the demo always works.

## Architecture

```
gridsense/
├── data/                  raw ASTraM CSV
├── ml/                    Python data-science core
│   ├── prepare.py         clean + feature-engineer → artifacts
│   ├── impact_model.py    train duration model + score every event
│   ├── scoring.py         the auditable Impact Score formula
│   ├── recommend.py       impact → manpower / barricade / diversion
│   ├── learn.py           predicted-vs-actual learning metrics
│   └── artifacts/         committed model + JSON priors
├── api/                   FastAPI (local/standalone) + MOCK integrations
│   ├── main.py            /forecast /recommend /events /hotspots /learning
│   └── service.py         MapmyIndia + ASTraM-feed mock clients
└── web/                   Next.js 16 app (deployed on Vercel)
    └── src/
        ├── lib/gridsense.ts   TS port of scoring+recommend (runs at the edge)
        ├── app/api/*          self-contained API routes over the JSON artifacts
        ├── app/page.tsx       Command Center
        ├── app/plan/page.tsx  Plan an Event
        └── app/learning/...   Post-Event Learning
```

**Why two code paths?** The Python `ml/` is the research/credibility core. The deployed
web app reuses the *same* logic ported to TypeScript and a model-derived duration lookup,
so it runs fully self-contained on Vercel (no Python runtime at request time) while staying
faithful to the trained model.

**Routing + feed integrations** (`api/service.py` + `lib/gridsense.ts`) now support
two modes:
- **Live MapmyIndia routing** (when `MAPMYINDIA_API_KEY` + `MAPMYINDIA_DIRECTIONS_URL` are set)
- **Deterministic mock fallback** (default) with explicit `routing_source` + `fallback_reason`

`LiveFeedClient.active_events()` remains a mock ASTraM stream synthesizer and is
production-swappable.

## The three screens

1. **Command Center** — live Bengaluru map, impact-colored event pins, risk heatmap toggle,
   city KPIs, and a ranked "deploy resources now" panel.
2. **Plan an Event** — pick a scenario (e.g. *cricket match at Chinnaswamy, Sat 7pm, road
   closure*) → impact gauge + factor breakdown + affected radius on map + a full manpower /
   barricade / diversion plan with the diversion route drawn live.
3. **Post-Event Learning** — predicted-vs-actual clearance by cause, calibration by corridor,
   and the accuracy metrics that close the loop.

---

## Run it

### 1. Regenerate ML artifacts (optional — committed already)
```bash
cd ml
pip install -r ../requirements.txt
python prepare.py        # clean + features
python impact_model.py   # train model + score events
python learn.py          # learning metrics
```

### 2. Web app (the demo)
```bash
cd web
npm install
npm run dev              # http://localhost:3000
```

Optional env (in `web/.env.local`) for live rerouting:
```bash
MAPMYINDIA_API_KEY=...
MAPMYINDIA_DIRECTIONS_URL=...
```
If unset/unavailable, GridSense still returns 2-3 ranked diversion alternatives
using the built-in mock routing engine.

### 3. Python API (optional standalone server)
```bash
cd api
uvicorn main:app --reload --port 8000
curl -X POST localhost:8000/recommend -H 'content-type: application/json' \
  -d '{"cause":"public_event","corridor":"CBD 2","requires_road_closure":true,"is_peak":true,"affected_junctions":3,"lat":12.9788,"lon":77.5996}'
```

## Demo script (90 seconds)

1. **Command Center** — "Here's the city right now. 1,000+ active events, colour-coded by
   forecast impact, the worst ranked on the right for immediate deployment."
2. **Plan an Event** — click *Cricket match · Chinnaswamy*. "Before the match, we forecast
   impact, see *why* (closure + peak), get a 22-person plan, 10 barricades, and a diversion
   route on the map — no guesswork."
3. **Post-Event Learning** — "After it resolves we compare predicted vs actual. ~36 min
   median error, and we see exactly which corridors we under-predict — the loop that's
   missing today."

## Out of scope / production path
Real MapmyIndia routing + live ASTraM feed (stubs are swap-ready), online retraining,
mobile app, multi-city. The mock boundaries make each a drop-in replacement.
