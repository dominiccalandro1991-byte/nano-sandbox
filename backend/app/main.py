"""nano-sandbox remote validation engine -- FastAPI entrypoint.

Run locally:
    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

Then in NHSE's "Remote" tab, point it at http://localhost:8000 (or wherever
this ends up deployed). If you never set a remote engine URL in NHSE, this
service is never called -- NHSE is fully self-contained without it.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.orchestrator import jobs as job_store
from app.routers import health, jobs, validators, nase

settings = get_settings()
job_store.configure(settings.max_retained_jobs)

app = FastAPI(
    title="nano-sandbox remote engine",
    description="Optional remote validation engine for the NanoHabitat Sandbox Engine (NHSE).",
    version="0.1.0",
)

allow_origins = ["*"] if settings.cors_allow_origins.strip() == "*" else [
    o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(validators.router)
app.include_router(jobs.router)
app.include_router(nase.router)
