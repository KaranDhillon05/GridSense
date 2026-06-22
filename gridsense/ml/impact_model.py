"""
GridSense — Duration model + impact-score artifact generation.

Trains a gradient-boosted regressor to predict event clearance duration from
features, evaluates it, then computes the composite impact score (via scoring.py)
for every historical event and writes a lightweight prediction table the API and
the learning page consume.

Outputs (ml/artifacts/):
  - duration_model.joblib    : sklearn pipeline (cause/corridor/... -> minutes)
  - model_meta.json          : metrics + feature importances
  - scored_events.json       : per-event predicted duration + impact score
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

import scoring

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "artifacts"

CAT = ["event_cause", "corridor", "zone", "veh_type", "priority"]
NUM = ["requires_road_closure", "is_planned", "hour", "dow", "is_weekend", "is_peak"]
TARGET = "duration_min"


def train():
    df = pd.read_parquet(OUT / "features.parquet")
    # Train on log-duration (heavy right tail) for stability.
    df = df.dropna(subset=[TARGET])
    df["zone"] = df["zone"].fillna("Unknown")
    df["veh_type"] = df["veh_type"].fillna("Unknown")
    y = np.log1p(df[TARGET].clip(lower=1))
    X = df[CAT + NUM]

    pre = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=5, sparse_output=False), CAT)],
        remainder="passthrough",
    )
    model = Pipeline(
        [("pre", pre),
         ("gb", HistGradientBoostingRegressor(
             max_iter=400, learning_rate=0.05, max_depth=6,
             l2_regularization=1.0, random_state=42))]
    )

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
    model.fit(Xtr, ytr)

    pred_log = model.predict(Xte)
    pred = np.expm1(pred_log)
    actual = np.expm1(yte)
    mae = mean_absolute_error(actual, pred)
    medae = float(np.median(np.abs(actual - pred)))
    r2 = r2_score(yte, pred_log)
    print(f"Duration model — MAE={mae:.0f}min  MedAE={medae:.0f}min  R2(log)={r2:.3f}")

    # Refit on all data for the shipped artifact.
    model.fit(X, y)
    joblib.dump(model, OUT / "duration_model.joblib")

    meta = {
        "mae_min": round(float(mae), 1),
        "median_ae_min": round(medae, 1),
        "r2_log": round(float(r2), 3),
        "n_train": int(len(df)),
        "features": {"categorical": CAT, "numeric": NUM},
        "baseline_median_min": float(np.expm1(y).median()),
    }
    (OUT / "model_meta.json").write_text(json.dumps(meta, indent=2))
    return model


def score_all(model):
    """Compute predicted duration + impact score for every event with coords."""
    agg = scoring.load_aggregates()
    events = json.loads((OUT / "events.json").read_text())
    edf = pd.DataFrame(events)

    # Build the model feature frame from raw events.
    feat = pd.DataFrame({
        "event_cause": edf["event_cause"].fillna("others"),
        "corridor": edf["corridor"].fillna("Non-corridor"),
        "zone": edf["zone"].fillna("Unknown"),
        "veh_type": edf["veh_type"].fillna("Unknown"),
        "priority": edf["priority"].fillna("Low"),
        "requires_road_closure": edf["requires_road_closure"].fillna(0).astype(int),
        "is_planned": edf["is_planned"].fillna(0).astype(int),
        "hour": edf["hour"].fillna(12).astype(int),
        "dow": 2,  # neutral default for scoring display
        "is_weekend": 0,
        "is_peak": edf["is_peak"].fillna(0).astype(int),
    })
    pred = np.expm1(model.predict(feat[CAT + NUM]))

    scored = []
    for i, ev in enumerate(events):
        s = scoring.score_factors(
            agg=agg,
            cause=feat["event_cause"].iloc[i],
            corridor=feat["corridor"].iloc[i],
            duration_min=float(pred[i]),
            requires_road_closure=bool(feat["requires_road_closure"].iloc[i]),
            priority=feat["priority"].iloc[i],
            is_peak=bool(feat["is_peak"].iloc[i]),
        )
        ev = dict(ev)
        ev["predicted_duration_min"] = round(float(pred[i]), 1)
        ev["impact_score"] = s["impact_score"]
        ev["tier"] = s["tier"]
        scored.append(ev)

    (OUT / "scored_events.json").write_text(json.dumps(scored, ensure_ascii=False))

    sc = pd.Series([e["impact_score"] for e in scored])
    print(f"Scored {len(scored)} events. Impact score "
          f"mean={sc.mean():.1f} p50={sc.median():.1f} p90={sc.quantile(0.9):.1f}")

    # Sanity: mean impact by cause should rank pot_holes/water_logging high.
    by = pd.DataFrame(scored).groupby("event_cause")["impact_score"].mean().sort_values(ascending=False)
    print("Mean impact by cause (top 6):")
    print(by.head(6).round(1).to_string())


if __name__ == "__main__":
    model = train()
    score_all(model)
