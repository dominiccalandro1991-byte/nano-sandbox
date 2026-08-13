from app.nadre.monitor import NadreMonitor
from app.validators import get_validator
from app.validators.nadre_monitor_validator import NadreMonitorValidator


def test_budget_invariant_pass():
    m = NadreMonitor()
    r = m.evaluate({"resident_bytes": 100, "budget_bytes": 1000, "predictor_hits": 0, "predictor_misses": 0, "predictor_transitions": 0})
    assert r["passed"] is True


def test_budget_invariant_fail_suggests_evict():
    m = NadreMonitor()
    r = m.evaluate({"resident_bytes": 5000, "budget_bytes": 1000, "predictor_hits": 0, "predictor_misses": 0, "predictor_transitions": 0,
                    "expected_hash": "a", "actual_hash": "a"})
    assert r["passed"] is False
    assert any(x["action"] == "governor.evictTo" for x in r["repairs"])


def test_merkle_mismatch_without_quarantine():
    m = NadreMonitor()
    r = m.evaluate({"resident_bytes": 1, "budget_bytes": 10, "predictor_hits": 0, "predictor_misses": 0, "predictor_transitions": 0,
                    "expected_hash": "a", "actual_hash": "b", "quarantined": False})
    assert r["passed"] is False


def test_validator_registered():
    assert get_validator("nadre-monitor") is not None
    report = NadreMonitorValidator().run({"resident_bytes": 1, "budget_bytes": 10, "predictor_hits": 10, "predictor_misses": 2, "predictor_transitions": 10, "expected_hash": "x", "actual_hash": "x"})
    assert report.passed is True
