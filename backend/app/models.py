"""Shared request/response schemas for the validation API."""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"       # validator/sandbox itself raised -- distinct from a
                            # validation that ran cleanly and returned FAILED.
    TIMEOUT = "timeout"


class ValidationRequest(BaseModel):
    """A single unit of work submitted by an agent (or by a human) for
    validation. `validator_id` selects which registered validator runs it;
    `payload` is validator-specific input (game/agent code, sim params, etc).
    """

    validator_id: str = Field(..., description="Registered validator to run, e.g. 'soft-body-physics'.")
    payload: dict[str, Any] = Field(default_factory=dict)
    label: str | None = Field(default=None, description="Human-readable label for this job, e.g. an agent/run name.")
    seed: int | None = Field(default=None, description="Optional deterministic seed passed through to the validator.")


class ValidationReport(BaseModel):
    """What a validator hands back. `passed` is the single merge-gate bit;
    `score` and `metrics` carry the actual evidence behind that bit so a
    human (or Phase 4's CI gate) can see *why*, not just the verdict.
    """

    passed: bool
    score: float | None = None
    metrics: dict[str, float] = Field(default_factory=dict)
    findings: list[str] = Field(default_factory=list)
    error: str | None = None
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured, validator-specific output that doesn't fit the flat metrics dict "
        "(e.g. anomaly coordinates, repair steps, hypothesis lists). Optional; older validators "
        "that never set this simply return an empty dict.",
    )


class Job(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    validator_id: str
    label: str | None = None
    status: JobStatus = JobStatus.QUEUED
    submitted_at: float = Field(default_factory=time.time)
    finished_at: float | None = None
    duration_seconds: float | None = None
    report: ValidationReport | None = None
    error: str | None = Field(default=None, description="Sandbox-level failure (timeout/crash), distinct from a validator's own ValidationReport.error.")


class ValidatorInfo(BaseModel):
    id: str
    description: str
    payload_schema: dict[str, Any] = Field(default_factory=dict)
