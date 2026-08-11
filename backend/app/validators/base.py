"""Validator plugin interface.

A validator is a pure function of (payload, seed) -> ValidationReport. It
must not touch the filesystem, network, or any process-wide mutable state --
that is what app/orchestrator/sandbox.py is for. Keeping validators pure
means they can be unit-tested directly (see tests/test_validators.py) AND
run inside the isolated subprocess sandbox with identical behavior.

To add a new validator:
  1. Create app/validators/<name>.py implementing `Validator`.
  2. Register an instance in REGISTRY at the bottom of app/validators/__init__.py.
That's the entire extension surface -- routers, sandbox, and job store never
need to change.
"""
from __future__ import annotations

from typing import Any, Protocol

from app.models import ValidationReport


class Validator(Protocol):
    id: str
    description: str

    def payload_schema(self) -> dict[str, Any]:
        """A minimal JSON-Schema-ish dict describing expected payload keys.
        Not enforced strictly -- it's for the frontend to render a form and
        for humans reading the API, not a hard contract."""
        ...

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        ...
