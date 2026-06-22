"""
GridSense — Data preparation & feature engineering.

Reads the raw ASTraM event CSV, cleans it, derives features and an impact
proxy, and writes artifacts consumed by the model, the API, and the web app.

Outputs (all in ml/artifacts/):
  - events.json          : per-event records for the map / command center
  - features.parquet     : modeling table (resolvable events with duration)
  - aggregates.json      : priors used by the live API (cause/corridor/zone tables)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from scoring import score_factors

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "data" / "astram_events.csv"
OUT = ROOT / "artifacts"
OUT.mkdir(parents=True, exist_ok=True)

# Bengaluru is UTC+5:30. Local peak windows (morning 8-11, evening 17-21).
IST_OFFSET = pd.Timedelta(hours=5, minutes=30)

NULLS = {"", "NULL", "null", "None", None}

# Canonicalize messy cause labels.
CAUSE_FIX = {
    "Debris": "debris",
    "debris": "debris",
    "Fog / Low Visibility": "low_visibility",
    "test_demo": "others",
}


def _clean_str(s):
    if s is None:
        return None
    s = str(s).strip()
    return None if s in NULLS else s


def _parse_dt(series: pd.Series) -> pd.Series:
    """Parse the postgres-style timestamps, tolerate NULL/empty, return naive UTC."""
    s = series.astype(str).str.replace(r"\+00$", "", regex=True).str.strip()
    s = s.where(~series.isin(list(NULLS)), other=None)
    return pd.to_datetime(s, errors="coerce", utc=False)


def load_raw() -> pd.DataFrame:
    df = pd.read_csv(DATA, dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]
    return df


def build(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()
    out["id"] = df["id"]
    out["event_type"] = df["event_type"].map(_clean_str)
    out["is_planned"] = (out["event_type"] == "planned").astype(int)

    cause = df["event_cause"].map(_clean_str).fillna("others")
    out["event_cause"] = cause.map(lambda c: CAUSE_FIX.get(c, c))

    for col in ("latitude", "longitude", "endlatitude", "endlongitude"):
        out[col] = pd.to_numeric(df[col], errors="coerce")

    out["address"] = df["address"].map(_clean_str)
    out["corridor"] = df["corridor"].map(_clean_str).fillna("Non-corridor")
    out["zone"] = df["zone"].map(_clean_str)
    out["junction"] = df["junction"].map(_clean_str)
    out["police_station"] = df["police_station"].map(_clean_str)
    out["veh_type"] = df["veh_type"].map(_clean_str)
    out["description"] = df["description"].map(_clean_str)
    out["status"] = df["status"].map(_clean_str)
    out["priority"] = df["priority"].map(_clean_str).fillna("Low")
    out["requires_road_closure"] = df["requires_road_closure"].str.upper().eq("TRUE").astype(int)

    start = _parse_dt(df["start_datetime"])
    closed = _parse_dt(df["closed_datetime"])
    resolved = _parse_dt(df["resolved_datetime"])
    end_planned = _parse_dt(df["end_datetime"])
    out["start_datetime"] = start

    # Actual clearance time: prefer closed, fall back to resolved.
    ended = closed.fillna(resolved)
    dur_min = (ended - start).dt.total_seconds() / 60.0
    out["duration_min"] = dur_min
    out["end_datetime"] = end_planned  # planned-event scheduled end

    # Local-time features.
    local = start + IST_OFFSET
    out["hour"] = local.dt.hour
    out["dow"] = local.dt.dayofweek  # 0=Mon
    out["is_weekend"] = local.dt.dayofweek.isin([5, 6]).astype(int)
    out["month"] = local.dt.strftime("%Y-%m")
    h = local.dt.hour
    out["is_peak"] = (h.between(8, 10) | h.between(17, 20)).astype(int)

    # ~500m spatial grid for hotspot aggregation (1 deg lat ~ 111km).
    out["grid_lat"] = (out["latitude"] / 0.0045).round() * 0.0045
    out["grid_lon"] = (out["longitude"] / 0.0045).round() * 0.0045

    return out


def aggregates(feat: pd.DataFrame) -> dict:
    resolvable = feat[(feat["duration_min"] > 0) & (feat["duration_min"] < 60 * 24 * 7)]

    def med_by(col):
        g = resolvable.groupby(col)["duration_min"]
        return {k: round(float(v), 1) for k, v in g.median().items() if pd.notna(k)}

    cause_dur = med_by("event_cause")
    corridor_dur = med_by("corridor")
    overall_med = float(resolvable["duration_min"].median())

    # Cause severity prior, normalized 0..1 by median clearance time.
    max_cd = max(cause_dur.values()) if cause_dur else 1.0
    cause_severity = {k: round(v / max_cd, 3) for k, v in cause_dur.items()}

    # Location sensitivity: events per corridor (busier corridor = more sensitive).
    corridor_counts = feat["corridor"].value_counts().to_dict()
    max_corr = max(corridor_counts.values())
    corridor_sensitivity = {
        k: round(0.3 + 0.7 * (v / max_corr), 3) for k, v in corridor_counts.items()
    }

    zone_counts = feat["zone"].dropna().value_counts().to_dict()

    return {
        "overall_median_duration_min": round(overall_med, 1),
        "cause_median_duration_min": cause_dur,
        "corridor_median_duration_min": corridor_dur,
        "cause_severity": cause_severity,
        "corridor_sensitivity": corridor_sensitivity,
        "corridor_event_counts": {k: int(v) for k, v in corridor_counts.items()},
        "zone_event_counts": {k: int(v) for k, v in zone_counts.items()},
        "causes": sorted(feat["event_cause"].dropna().unique().tolist()),
        "corridors": sorted(feat["corridor"].dropna().unique().tolist()),
        "zones": sorted(feat["zone"].dropna().unique().tolist()),
        "veh_types": sorted(feat["veh_type"].dropna().unique().tolist()),
        "n_events": int(len(feat)),
        "n_resolvable": int(len(resolvable)),
        "date_min": feat["start_datetime"].min().strftime("%Y-%m-%d"),
        "date_max": feat["start_datetime"].max().strftime("%Y-%m-%d"),
    }


def hotspots(feat: pd.DataFrame) -> list[dict]:
    g = feat.dropna(subset=["grid_lat", "grid_lon"]).groupby(["grid_lat", "grid_lon"])
    rows = []
    for (glat, glon), sub in g:
        rows.append(
            {
                "lat": round(float(glat), 5),
                "lon": round(float(glon), 5),
                "count": int(len(sub)),
                "closure_rate": round(float(sub["requires_road_closure"].mean()), 3),
                "high_priority_rate": round(float((sub["priority"] == "High").mean()), 3),
            }
        )
    rows.sort(key=lambda r: -r["count"])
    return rows


def events_json(feat: pd.DataFrame) -> list[dict]:
    cols = [
        "id", "event_type", "event_cause", "latitude", "longitude", "address",
        "corridor", "zone", "junction", "police_station", "priority", "veh_type",
        "requires_road_closure", "status", "duration_min", "hour", "is_peak",
        "is_planned", "description",
    ]
    recs = feat[cols].copy()
    recs["start_datetime"] = feat["start_datetime"].dt.strftime("%Y-%m-%d %H:%M:%S")
    recs = recs.where(pd.notna(recs), None)
    out = []
    for r in recs.to_dict(orient="records"):
        if r["latitude"] is None or r["longitude"] is None:
            continue
        if isinstance(r["duration_min"], float) and (math.isnan(r["duration_min"])):
            r["duration_min"] = None
        out.append(r)
    return out


def precedents(feat: pd.DataFrame, agg: dict) -> list[dict]:
    """Resolved events with ACTUAL clearance time — the historical analog corpus.

    Powers the Precedent Engine: given a new event, we retrieve genuinely similar
    past events and report their *real* outcomes (median/P90 clearance, closure
    rate, severity mix). Each row is tagged with the same auditable impact tier the
    rest of the app uses, computed from its actual duration.
    """
    resolvable = feat[
        (feat["duration_min"] > 0)
        & (feat["duration_min"] < 60 * 24 * 7)
        & feat["latitude"].notna()
        & feat["longitude"].notna()
    ]
    rows: list[dict] = []
    for r in resolvable.to_dict(orient="records"):
        closure = bool(r["requires_road_closure"])
        dur = float(r["duration_min"])
        sf = score_factors(
            agg=agg,
            cause=r["event_cause"],
            corridor=r["corridor"],
            duration_min=dur,
            requires_road_closure=closure,
            priority=r["priority"] or "High",
            is_peak=bool(r["is_peak"]),
        )
        start = r["start_datetime"]
        rows.append(
            {
                "id": r["id"],
                "cause": r["event_cause"],
                "corridor": r["corridor"],
                "zone": r["zone"],
                "lat": round(float(r["latitude"]), 5),
                "lon": round(float(r["longitude"]), 5),
                "requires_road_closure": int(closure),
                "is_peak": int(bool(r["is_peak"])),
                "is_planned": int(bool(r["is_planned"])),
                "priority": r["priority"] or "High",
                "actual_duration_min": round(dur, 1),
                "tier": sf["tier"],
                "impact_score": sf["impact_score"],
                "start_date": start.strftime("%Y-%m-%d") if pd.notna(start) else None,
            }
        )
    return rows


def main():
    raw = load_raw()
    feat = build(raw)
    print(f"Loaded {len(feat)} events.")

    agg = aggregates(feat)
    (OUT / "aggregates.json").write_text(json.dumps(agg, indent=2, ensure_ascii=False))
    print(f"Wrote aggregates.json  (median dur={agg['overall_median_duration_min']}min, "
          f"{agg['n_resolvable']} resolvable)")

    hs = hotspots(feat)
    (OUT / "hotspots.json").write_text(json.dumps(hs, ensure_ascii=False))
    print(f"Wrote hotspots.json  ({len(hs)} grid cells)")

    ev = events_json(feat)
    (OUT / "events.json").write_text(json.dumps(ev, ensure_ascii=False))
    print(f"Wrote events.json  ({len(ev)} events with coords)")

    prec = precedents(feat, agg)
    (OUT / "precedents.json").write_text(json.dumps(prec, ensure_ascii=False))
    print(f"Wrote precedents.json  ({len(prec)} resolved events with actual clearance)")

    # Modeling table: resolvable events only.
    # NOTE: `month` + `start_datetime` are carried for the post-event learning
    # loop (temporal split / drift analysis). The model only consumes CAT+NUM, so
    # these extra columns don't affect training.
    model_cols = [
        "event_cause", "corridor", "zone", "veh_type", "priority",
        "requires_road_closure", "is_planned", "hour", "dow", "is_weekend",
        "is_peak", "duration_min", "month", "start_datetime",
    ]
    mt = feat[(feat["duration_min"] > 0) & (feat["duration_min"] < 60 * 24 * 7)][model_cols].copy()
    mt.to_parquet(OUT / "features.parquet", index=False)
    print(f"Wrote features.parquet  ({len(mt)} rows for training)")

    # Quick sanity print
    top = sorted(agg["cause_median_duration_min"].items(), key=lambda x: -x[1])[:6]
    print("Top causes by median clearance (min):", top)


if __name__ == "__main__":
    main()
