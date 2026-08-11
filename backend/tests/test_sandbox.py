from app.models import JobStatus
from app.orchestrator.sandbox import run_in_sandbox


def test_sandbox_runs_valid_job_end_to_end():
    result = run_in_sandbox(
        validator_id="soft-body-physics",
        payload={"rows": 3, "cols": 3, "steps": 100},
        seed=1,
        timeout_seconds=10.0,
        memory_limit_bytes=512 * 1024 * 1024,
    )
    assert result.status in (JobStatus.PASSED, JobStatus.FAILED)
    assert result.report is not None
    assert result.error is None
    assert result.duration_seconds > 0


def test_sandbox_reports_timeout():
    # Ask for far more physics steps than the timeout can possibly cover.
    result = run_in_sandbox(
        validator_id="soft-body-physics",
        payload={"rows": 10, "cols": 10, "steps": 5_000_000},
        seed=1,
        timeout_seconds=0.5,
        memory_limit_bytes=512 * 1024 * 1024,
    )
    assert result.status == JobStatus.TIMEOUT
    assert result.report is None
    assert "timeout" in (result.error or "").lower()


def test_sandbox_reports_unknown_validator_as_error():
    result = run_in_sandbox(
        validator_id="does-not-exist",
        payload={},
        seed=None,
        timeout_seconds=5.0,
        memory_limit_bytes=512 * 1024 * 1024,
    )
    assert result.status == JobStatus.ERROR
    assert result.error is not None
