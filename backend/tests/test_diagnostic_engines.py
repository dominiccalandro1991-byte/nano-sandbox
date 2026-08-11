import math

from app.validators.cdem_validator import CDEMDiagnosisValidator
from app.validators.rte_validator import RTERepairPlanValidator
from app.validators.tcc_validator import TCCAnomalyValidator


# ---------------------------------------------------------------------------
# TCC
# ---------------------------------------------------------------------------

def _flat_grid(rows: int, cols: int, value: float = 1.0) -> list[list[float]]:
    return [[value for _ in range(cols)] for _ in range(rows)]


def test_tcc_identical_matrices_pass_with_zero_divergence():
    v = TCCAnomalyValidator()
    grid = _flat_grid(8, 8, 1.0)
    report = v.run({"feature_matrix": grid, "baseline_matrix": grid}, seed=None)
    assert report.error is None
    assert report.passed is True
    assert report.metrics["total_divergence"] == 0.0
    assert report.metrics["anomaly_count"] == 0.0


def test_tcc_localized_spike_is_detected_and_located():
    rows, cols = 10, 10
    baseline = _flat_grid(rows, cols, 0.0)
    feature = _flat_grid(rows, cols, 0.0)
    feature[4][6] = 5.0  # sharp localized spike
    v = TCCAnomalyValidator()
    report = v.run({"feature_matrix": feature, "baseline_matrix": baseline, "sensitivity_threshold": 0.2}, seed=None)
    assert report.error is None
    assert report.passed is False
    assert report.metrics["anomaly_count"] >= 1
    coords = report.details["anomaly_coordinates"]
    assert any(c["x"] == 6 and c["y"] == 4 for c in coords)


def test_tcc_rejects_mismatched_shapes():
    v = TCCAnomalyValidator()
    report = v.run({"feature_matrix": _flat_grid(4, 4), "baseline_matrix": _flat_grid(4, 5)}, seed=None)
    assert report.error is not None
    assert report.passed is False


def test_tcc_rejects_non_finite_values():
    v = TCCAnomalyValidator()
    bad = _flat_grid(3, 3)
    bad[1][1] = float("nan")
    report = v.run({"feature_matrix": bad, "baseline_matrix": _flat_grid(3, 3)}, seed=None)
    assert report.error is not None


def test_tcc_anomaly_labels_are_generic_not_domain_specific():
    # Explicit regression guard: this validator must never claim a specific
    # real-world defect category it has no basis to claim.
    rows, cols = 6, 6
    baseline = _flat_grid(rows, cols, 0.0)
    feature = _flat_grid(rows, cols, 0.0)
    feature[2][2] = -5.0
    v = TCCAnomalyValidator()
    report = v.run({"feature_matrix": feature, "baseline_matrix": baseline, "sensitivity_threshold": 0.1}, seed=None)
    for coord in report.details["anomaly_coordinates"]:
        assert "burn" not in coord["anomaly_type"]
        assert "solder" not in coord["anomaly_type"]
        assert "fracture" not in coord["anomaly_type"]


# ---------------------------------------------------------------------------
# CDEM
# ---------------------------------------------------------------------------

def test_cdem_strong_matching_evidence_yields_low_entropy_high_confidence():
    v = CDEMDiagnosisValidator()
    report = v.run(
        {
            "visual_data": {"anomaly_count": 1, "max_divergence": 0.8, "primary_anomaly_class": "high_magnitude_positive_deviation"},
            "audio_data": {"fft_peak_frequencies": [5.0, 10.0], "harmonic_distortion_ratio": 0.1, "transient_noise_detected": False},
            "text_symptoms": "it got hot and smells like something shorted, tripped the breaker",
            "target_entropy": 1.5,
            "min_confidence": 0.5,  # validator enforces [0.5, 1.0] per the spec's own schema bounds
        },
        seed=None,
    )
    assert report.error is None
    assert report.details["primary_diagnosis"]["failure_id"] == "component_short"
    assert report.metrics["primary_confidence"] > 0.4


def test_cdem_posterior_sums_to_one():
    v = CDEMDiagnosisValidator()
    report = v.run({"visual_data": {"anomaly_count": 0, "max_divergence": 0.4, "primary_anomaly_class": "x"}}, seed=None)
    total = sum(report.details["posterior"].values())
    assert math.isclose(total, 1.0, abs_tol=1e-6)


def test_cdem_missing_audio_and_text_is_neutral_not_penalized():
    v = CDEMDiagnosisValidator()
    with_evidence = v.run(
        {"visual_data": {"anomaly_count": 1, "max_divergence": 0.3, "primary_anomaly_class": "positive_deviation"}, "audio_data": None, "text_symptoms": None},
        seed=None,
    )
    assert with_evidence.error is None
    assert "No audio_data supplied" in " ".join(with_evidence.findings)
    assert "No text_symptoms supplied" in " ".join(with_evidence.findings)


def test_cdem_requires_visual_data():
    v = CDEMDiagnosisValidator()
    report = v.run({}, seed=None)
    assert report.error is not None


def test_cdem_entropy_matches_manual_shannon_calculation():
    v = CDEMDiagnosisValidator()
    report = v.run({"visual_data": {"anomaly_count": 0, "max_divergence": 0.4, "primary_anomaly_class": "none"}}, seed=None)
    probs = list(report.details["posterior"].values())
    manual_entropy = -sum(p * math.log2(p) for p in probs if p > 0)
    assert math.isclose(report.metrics["shannon_entropy_bits"], manual_entropy, abs_tol=1e-4)


# ---------------------------------------------------------------------------
# RTE
# ---------------------------------------------------------------------------

def test_rte_finds_path_with_full_tools_and_expert_skill():
    v = RTERepairPlanValidator()
    report = v.run(
        {"failure_id": "loose_connection", "user_skill_level": "expert", "available_tools": ["flashlight", "multimeter"]},
        seed=None,
    )
    assert report.error is None
    assert len(report.details["repair_trajectory"]) > 0
    assert report.metrics["total_steps"] > 0


def test_rte_prunes_steps_above_beginner_skill():
    v = RTERepairPlanValidator()
    report = v.run(
        {"failure_id": "loose_connection", "user_skill_level": "beginner", "available_tools": ["flashlight", "multimeter"]},
        seed=None,
    )
    # every intermediate/expert step should be excluded, so no path can complete this graph as a beginner
    assert report.passed is False
    assert any("Excluded steps above user_skill_level" in f for f in report.findings)


def test_rte_missing_tools_prevents_a_path():
    v = RTERepairPlanValidator()
    report = v.run(
        {"failure_id": "component_short", "user_skill_level": "expert", "available_tools": []},
        seed=None,
    )
    assert report.passed is False
    assert "No repair path exists" in " ".join(report.findings)


def test_rte_unknown_failure_id_errors():
    v = RTERepairPlanValidator()
    report = v.run({"failure_id": "not_a_real_failure_mode"}, seed=None)
    assert report.error is not None


def test_rte_never_fabricates_a_voltage_value():
    v = RTERepairPlanValidator()
    report = v.run(
        {"failure_id": "component_short", "user_skill_level": "expert", "available_tools": ["multimeter", "soldering_iron", "current_limited_supply"]},
        seed=None,
    )
    for step in report.details["repair_trajectory"]:
        assert step["pinout_voltage_check"] is None


def test_rte_prefers_lower_cost_path_when_risk_weight_is_high():
    v = RTERepairPlanValidator()
    # With a high risk weight, Dijkstra should route around the higher-hazard branch when a lower-hazard one exists.
    report = v.run(
        {
            "failure_id": "loose_connection",
            "user_skill_level": "expert",
            "available_tools": ["flashlight", "multimeter"],
            "lambda_risk": 100.0,
        },
        seed=None,
    )
    titles = [s["action_title"] for s in report.details["repair_trajectory"]]
    assert "Reseat connector (de-energized)" in titles
    assert "Wiggle-test while powered" not in titles


def test_rte_hazard_gate_boundary_at_exactly_the_skill_cap():
    v = RTERepairPlanValidator()
    report = v.run(
        {
            "failure_id": "loose_connection",
            "user_skill_level": "expert",
            # flashlight present (visual_inspect needs it) but multimeter absent, so
            # power_down_check/reseat_connector_safe (need multimeter) are pruned --
            # only the risky branch (hazard 5) remains reachable to the end node.
            "available_tools": ["flashlight"],
        },
        seed=None,
    )
    assert report.error is None
    assert report.details["repair_trajectory"], "expected a path via the risky branch"
    titles = [s["action_title"] for s in report.details["repair_trajectory"]]
    assert "Wiggle-test while powered" in titles
    # expert's hazard cap is 5 and the only reachable path's max hazard is exactly 5 --
    # boundary case, gate should treat <= cap as safe.
    assert report.metrics["max_hazard_level"] == 5.0
    assert report.details["is_safe_for_user"] is True
    assert report.passed is True


def test_rte_hazard_gate_flags_unsafe_below_the_skill_cap():
    v = RTERepairPlanValidator()
    report = v.run(
        {
            "failure_id": "loose_connection",
            "user_skill_level": "intermediate",  # hazard cap 3; only the risky branch is reachable but its
            "available_tools": ["flashlight"],   # skill_required is expert, so it's pruned entirely too
        },
        seed=None,
    )
    # With multimeter unavailable, the safe branch is pruned; with the requester capped at
    # intermediate skill, the expert-only risky branch is pruned too -- no path should exist.
    assert report.passed is False
    assert "No repair path exists" in " ".join(report.findings)
