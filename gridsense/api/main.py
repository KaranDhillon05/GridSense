"""
GridSense — FastAPI app (local dev / standalone server).

Endpoints:
  GET  /health
  GET  /events?status=&limit=     map events (scored)
  GET  /hotspots                  grid-aggregated risk heatmap
  GET  /active                    mock live feed of active events
  GET  /aggregates                form options + priors
  POST /forecast                  impact score + factor breakdown + duration
  POST /recommend                 forecast + manpower/barricade/diversion plan
  GET  /learning                  predicted-vs-actual metrics

The deployed web app uses Next.js API routes (see web/app/api) that port the
same lightweight logic; this server is for local experimentation and demos.
"""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from service import GridSense

app = FastAPI(title="GridSense API", version="1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
gs = GridSense()


class EventInput(BaseModel):
    cause: str = "others"
    corridor: str = "Non-corridor"
    zone: Optional[str] = "Unknown"
    veh_type: Optional[str] = "Unknown"
    junction: Optional[str] = None
    priority: str = "High"
    requires_road_closure: bool = False
    is_planned: bool = True
    hour: int = 19
    dow: int = 5
    is_weekend: bool = True
    is_peak: bool = True
    affected_junctions: int = 1
    lat: Optional[float] = None
    lon: Optional[float] = None


@app.get("/health")
def health():
    return {"ok": True, "n_events": gs.a.agg["n_events"], "mocks": ["MapmyIndia", "ASTraM feed"]}


@app.get("/events")
def events(status: Optional[str] = None, limit: int = 1500):
    out = gs.a.scored
    if status:
        out = [e for e in out if e.get("status") == status]
    return out[:limit]


@app.get("/hotspots")
def hotspots(limit: int = 400):
    return gs.a.hotspots[:limit]


@app.get("/active")
def active(limit: int = 60):
    return gs.feed.active_events(limit)


@app.get("/aggregates")
def aggregates():
    a = gs.a.agg
    return {
        "causes": a["causes"], "corridors": a["corridors"], "zones": a["zones"],
        "veh_types": a["veh_types"], "n_events": a["n_events"],
        "date_min": a["date_min"], "date_max": a["date_max"],
        "model": gs.a.meta,
    }


@app.post("/forecast")
def forecast(inp: EventInput):
    return gs.forecast(inp.model_dump())


@app.post("/recommend")
def recommend(inp: EventInput):
    return gs.recommend(inp.model_dump())


@app.get("/learning")
def learning():
    return gs.a.learning
