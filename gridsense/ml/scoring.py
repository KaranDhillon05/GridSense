"""
GridSense — Impact scoring (pure Python, no heavy deps at request time).

The Impact Score (0-100) is a transparent, auditable weighted blend of factors
derived from the ASTraM data. It is intentionally a documented formula on top of
a learned duration estimate, so the UI can explain *why* a score is what it is.

This module is imported by the model trainer, the recommender, and the API.
It only needs `aggregates.json` (priors) + a duration estimate.
"""
from __future__ import annotations

import json
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# Factor weights (sum = 1.0). Tuned to the data's structure; documented in README.
WEIGHTS = {
    "duration": 0.34,   # how long it ties up the road
    "closure": 0.22,    # full road closure is the single biggest disruptor
    "cause": 0.16,      # intrinsic severity of the cause
    "location": 0.16,   # how busy/sensitive the corridor is
    "timing": 0.12,     # peak hour amplifies impact
}

# A duration of this many minutes saturates the duration factor at 1.0.
DURATION_SATURATION_MIN = 720.0  # 12h


def load_aggregates() -> dict:
    return json.loads((ARTIFACTS / "aggregates.json").read_text())


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score_factors(
    *,
    agg: dict,
    cause: str,
    corridor: str,
    duration_min: float,
    requires_road_closure: bool,
    priority: str = "High",
    is_peak: bool = False,
) -> dict:
    """Return each normalized 0..1 factor plus the final 0..100 impact score."""
    # Duration factor: log-ish saturation so long events dominate but don't explode.
    dur = _clamp(duration_min / DURATION_SATURATION_MIN)

    closure = 1.0 if requires_road_closure else 0.0

    cause_sev = agg.get("cause_severity", {}).get(cause)
    if cause_sev is None:
        # Unknown cause: derive from its median duration if present, else mid.
        cd = agg.get("cause_median_duration_min", {}).get(cause)
        if cd is not None:
            mx = max(agg["cause_median_duration_min"].values()) or 1.0
            cause_sev = cd / mx
        else:
            cause_sev = 0.4
    cause_sev = _clamp(cause_sev)

    location = _clamp(agg.get("corridor_sensitivity", {}).get(corridor, 0.4))

    timing = 1.0 if is_peak else 0.45
    # High priority nudges timing/urgency up.
    if priority == "High":
        timing = _clamp(timing + 0.2)

    factors = {
        "duration": round(dur, 3),
        "closure": round(closure, 3),
        "cause": round(cause_sev, 3),
        "location": round(location, 3),
        "timing": round(timing, 3),
    }
    raw = sum(WEIGHTS[k] * factors[k] for k in WEIGHTS)
    score = round(100 * _clamp(raw), 1)

    # Contribution of each factor to the final score (for the "why" breakdown).
    contributions = {
        k: round(100 * WEIGHTS[k] * factors[k], 1) for k in WEIGHTS
    }

    return {
        "impact_score": score,
        "tier": tier_for(score),
        "factors": factors,
        "weights": WEIGHTS,
        "contributions": contributions,
        "expected_duration_min": round(float(duration_min), 1),
    }


def tier_for(score: float) -> str:
    if score >= 70:
        return "Severe"
    if score >= 50:
        return "High"
    if score >= 30:
        return "Moderate"
    return "Low"
