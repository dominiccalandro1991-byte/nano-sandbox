from app.validators.multi_agent_interaction import MultiAgentInteractionValidator
from app.validators.soft_body_physics import SoftBodyPhysicsValidator


def test_soft_body_stable_config_passes():
    v = SoftBodyPhysicsValidator()
    report = v.run({"rows": 4, "cols": 4, "stiffness": 120.0, "damping": 0.8, "dt": 1 / 120, "steps": 400}, seed=1)
    assert report.error is None
    assert report.passed is True
    assert report.metrics["final_energy"] <= report.metrics["peak_energy"] + 1e-6


def test_soft_body_unstable_config_fails_via_explosion_or_energy():
    # Negative-effective damping is a classic way to inject energy into a
    # spring-damper system; this must be caught by the passivity check.
    v = SoftBodyPhysicsValidator()
    report = v.run({"rows": 3, "cols": 3, "stiffness": 200.0, "damping": -5.0, "dt": 1 / 60, "steps": 300}, seed=2)
    assert report.passed is False


def test_soft_body_huge_timestep_is_unstable():
    # A wildly oversized dt for this stiffness is a textbook explicit-Euler
    # instability -- this is a real numerical-methods failure mode, not a
    # contrived one.
    v = SoftBodyPhysicsValidator()
    report = v.run({"rows": 3, "cols": 3, "stiffness": 500.0, "damping": 0.1, "dt": 1.0, "steps": 50}, seed=3)
    assert report.passed is False


def test_soft_body_rejects_degenerate_grid():
    v = SoftBodyPhysicsValidator()
    report = v.run({"rows": 1, "cols": 4}, seed=1)
    assert report.error is not None
    assert report.passed is False


def test_soft_body_deterministic_given_seed():
    v = SoftBodyPhysicsValidator()
    payload = {"rows": 3, "cols": 3, "steps": 100}
    r1 = v.run(payload, seed=42)
    r2 = v.run(payload, seed=42)
    assert r1.metrics == r2.metrics


def test_multi_agent_converges_and_is_deterministic():
    v = MultiAgentInteractionValidator()
    report = v.run({"agent_count": 6, "steps": 400, "convergence_threshold": 0.5}, seed=7)
    assert report.error is None
    assert report.metrics["deterministic"] == 1.0
    assert report.passed is True


def test_multi_agent_too_few_steps_fails_convergence_not_determinism():
    v = MultiAgentInteractionValidator()
    report = v.run({"agent_count": 6, "steps": 2, "convergence_threshold": 0.99}, seed=7)
    assert report.metrics["deterministic"] == 1.0
    assert report.passed is False


def test_multi_agent_rejects_zero_agents():
    v = MultiAgentInteractionValidator()
    report = v.run({"agent_count": 0}, seed=1)
    assert report.error is not None
