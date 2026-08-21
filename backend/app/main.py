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
from app.routers import health, jobs, validators, nase, openrouter_llm, shares, search, media, workspace, auth, proofpatch, incidentdojo, scopeshield, keyharbor
from app.nase.vault_db import init_engine

settings = get_settings()
job_store.configure(settings.max_retained_jobs)

# Auto-migrate nase_vault_blobs on startup. Failures are recorded but do not
# prevent /health from serving when credentials are Missing in the environment.
try:
    init_engine(settings.database_url, settings.database_read_url)
except Exception as _vault_init_exc:  # noqa: BLE001
    import logging
    logging.getLogger("nase.vault").error(
        "vault_db init failed (scheme=%s): %s",
        settings.database_url.split(':', 1)[0],
        _vault_init_exc,
    )

try:
    from app import workspace_db as _wsdb
    _wsdb.init_workspace(settings.database_url)
except Exception as _ws_init_exc:  # noqa: BLE001
    import logging
    logging.getLogger("workspace").error("workspace_db init failed: %s", _ws_init_exc)

try:
    from app.incidentdojo.store import init_incidentdojo as _init_idojo
    _init_idojo(settings.database_url)
except Exception as _idojo_init_exc:  # noqa: BLE001
    import logging
    logging.getLogger("incidentdojo").error("incidentdojo init failed: %s", _idojo_init_exc)

try:
    from app.scopeshield.engine import preflight as _scopeshield_preflight
    _ss = _scopeshield_preflight("nano-sandbox", skip_liveness=True)
    import logging as _logging
    _logging.getLogger("scopeshield").info(
        "preflight ok=%s failures=%s",
        _ss.get("ok"),
        [f.get("name") + ":" + f.get("reason", "") for f in (_ss.get("failures") or [])],
    )
except Exception as _ss_exc:  # noqa: BLE001
    import logging
    logging.getLogger("scopeshield").error("preflight skipped: %s", _ss_exc)

try:
    from app.keyharbor.boot import boot as _kh_boot
    _kh_n = _kh_boot()
    import logging as _khlog
    _khlog.getLogger("keyharbor").info("vault keys=%s", _kh_n)
except Exception as _kh_exc:  # noqa: BLE001
    import logging
    logging.getLogger("keyharbor").error("vault boot skipped: %s", _kh_exc)

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
app.include_router(openrouter_llm.router)
app.include_router(shares.router)
app.include_router(search.router)
app.include_router(media.router)
app.include_router(workspace.router)
app.include_router(auth.router)
app.include_router(proofpatch.router)
app.include_router(incidentdojo.router)
app.include_router(scopeshield.router)
app.include_router(keyharbor.router)
