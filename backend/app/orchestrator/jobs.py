"""In-memory job store.

Deliberately not a database. This service is an optional, stateless-ish
remote engine that NHSE calls out to for heavy validation work; NHSE's own
content-addressed store is the durable source of truth for habitats and
results (see lib/nhse/snapshot.ts on the frontend). This store only needs
to hold recent job results long enough for the caller to poll them, so an
in-memory OrderedDict with a size cap is the honest amount of persistence
for what this actually does.

If this service later needs to survive restarts or be horizontally scaled,
swap this module for SQLite (single instance) or Redis (multi-instance) --
the router layer only depends on the four functions below, so that's a
localized change.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict

from app.models import Job, JobStatus, ValidationReport

_lock = threading.Lock()
_jobs: "OrderedDict[str, Job]" = OrderedDict()
_max_retained = 500


def configure(max_retained: int) -> None:
    global _max_retained
    _max_retained = max_retained


def create_job(validator_id: str, label: str | None) -> Job:
    job = Job(validator_id=validator_id, label=label, status=JobStatus.QUEUED)
    with _lock:
        _jobs[job.id] = job
        while len(_jobs) > _max_retained:
            _jobs.popitem(last=False)
    return job


def mark_running(job_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = JobStatus.RUNNING


def complete_job(
    job_id: str,
    status: JobStatus,
    report: ValidationReport | None,
    started_at: float,
    error: str | None = None,
) -> Job | None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        job.status = status
        job.report = report
        job.error = error
        job.finished_at = time.time()
        job.duration_seconds = job.finished_at - started_at
        return job


def get_job(job_id: str) -> Job | None:
    with _lock:
        return _jobs.get(job_id)


def list_jobs(limit: int = 50) -> list[Job]:
    with _lock:
        return list(_jobs.values())[-limit:][::-1]
