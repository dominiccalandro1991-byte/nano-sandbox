"""Job submission and retrieval.

POST /jobs runs synchronously: it submits, executes inside the sandbox, and
returns the completed Job in one response. That's a deliberate simplicity
choice given the default 10s job timeout -- callers (including NHSE's
remote-engine client) don't need to poll for the common case. GET /jobs/{id}
and GET /jobs still exist so a slower validator (raise job_timeout_seconds
in config) or a future async queue can be added later without breaking the
read side of this API.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.models import Job, ValidationRequest
from app.orchestrator import jobs as job_store
from app.orchestrator.sandbox import run_in_sandbox
from app.validators import get_validator

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=Job)
def submit_job(request: ValidationRequest, settings: Settings = Depends(get_settings)) -> Job:
    if get_validator(request.validator_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown validator_id '{request.validator_id}'. See GET /validators.")

    job = job_store.create_job(request.validator_id, request.label)
    job_store.mark_running(job.id)

    started_at = time.time()
    result = run_in_sandbox(
        validator_id=request.validator_id,
        payload=request.payload,
        seed=request.seed,
        timeout_seconds=settings.job_timeout_seconds,
        memory_limit_bytes=settings.job_memory_limit_bytes,
    )

    completed = job_store.complete_job(job.id, result.status, result.report, started_at, error=result.error)
    if completed is None:
        raise HTTPException(status_code=500, detail="Job vanished from the store between creation and completion.")

    return completed


@router.get("", response_model=list[Job])
def get_jobs(limit: int = 50) -> list[Job]:
    return job_store.list_jobs(limit=limit)


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No job with id '{job_id}'.")
    return job
