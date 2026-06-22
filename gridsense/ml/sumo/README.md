# SUMO ground-truth pipeline (offline, dev-only)

Validates the in-browser TypeScript micro-sim engine against **SUMO** (the
academic-standard microsimulator) as ground truth, on the **Bengaluru CBD core**.
SUMO is a developer/validation tool only — production stays a static Next.js app
with the TS engine. Nothing here runs in production.

## What it does

1. Crops the CBD bbox out of `web/public/sim_network_real.json` — the exact
   network `/map-sim` runs (the realism engine). Same crop the calibration
   harness uses, so SUMO and the engine simulate the **same** network.
2. Builds a SUMO network (`build_sumo_net.py`) from our cleaned graph (custom
   `.nod`/`.edg` → `netconvert`), in the engine's flat-earth metre frame so edge
   lengths agree.
3. Generates demand (`build_demand.py`) mirroring the engine: same spawn rate,
   vehicle-type mix, lengths, and **the same IDM car-following params** — so any
   residual difference is junction/signal modeling, which is what we calibrate.
4. Runs SUMO headless and parses tripinfo/edgeData (`run_sumo.py`) into the
   committed `ground_truth_cbd.json` (network-wide + per-edge metrics).

## Run

```bash
# one-time: SUMO via pip wheel (no Homebrew tap needed), into the repo .venv
.venv/bin/pip install eclipse-sumo sumolib traci

cd gridsense/ml/sumo
../../../.venv/bin/python build_sumo_net.py
../../../.venv/bin/python build_demand.py
../../../.venv/bin/python run_sumo.py        # → ground_truth_cbd.json
```

Each script **degrades gracefully**: if SUMO isn't installed it prints a skip
message, exits 0, and the committed `ground_truth_cbd.json` remains the reference.

## Calibration

```bash
cd gridsense/web
npm run calibrate     # runs the REAL engine on the CBD crop, compares to ground truth
```

### Honest finding

- **Delay matches SUMO to within ~3%** (the robust, comparably-defined metric).
- **Mean speed reads ~20% lower** in the engine. This is largely structural: the
  engine reports a *vehicle-mean* speed (queued cars included) while SUMO's
  edgeData speed is *edge-mean* (free-flow weighted). A global speed-factor sweep
  trades speed-fit against delay-fit; we keep the default factors (no over-fit)
  because they match delay well and improve speed materially over the un-tuned
  baseline.
- **Throughput is reported but NOT optimized** — SUMO and the engine count
  completed trips differently (teleports, window edge effects), so it's a
  metric-definition mismatch, not a model error.

The tunable knob is `Engine.REALISM_SPEED_FACTORS` (realism path only; the legacy
`/simulation` desired-speed literals are untouched).

## Files

- `common.py` — shared bbox, crop, projection, SUMO-binary discovery, constants.
- `build_sumo_net.py` / `build_demand.py` / `run_sumo.py` — the pipeline.
- `out/` — generated `.nod/.edg/.net/.rou/tripinfo/edgedata` (gitignored).
- `ground_truth_cbd.json` — committed SUMO ground truth (the calibration contract).
