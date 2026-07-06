from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.models.enums import MotorResult, ScoreBand
from app.services import decision
from app.services.credit_decision_policy_score_seed import PILLAR_CODE
from app.services.manual_financial_statements import FINANCIAL_DATA_NOT_AVAILABLE_REASON
from app.services.decision import _apply_score_engine_trace


def test_decision_memory_registers_configurable_engine_trace():
    memory = {"score_final": 910}
    trace = {
        "engine": "configurable_policy",
        "policy_id": 759,
        "policy_code": "coface_first",
        "policy_version": 17,
        "effective_weight": 85,
        "fallback_used": False,
    }

    _apply_score_engine_trace(memory, trace)

    assert memory["score_source"] == "configurable_policy"
    assert memory["policy_id"] == 759
    assert memory["policy_code"] == "coface_first"
    assert memory["policy_version"] == 17
    assert memory["effective_weight"] == 85
    assert memory["fallback_used"] is False
    assert memory["engine_trace"] == trace


def test_decision_memory_registers_fallback_engine_trace():
    memory = {"score_final": 710}
    trace = {
        "engine": "legacy_policy",
        "fallback_used": True,
        "fallback_reason": "policy_not_published",
    }

    _apply_score_engine_trace(memory, trace)

    assert memory["score_source"] == "legacy_policy"
    assert memory["fallback_used"] is True
    assert memory["fallback_reason"] == "policy_not_published"
    assert memory["engine_trace"] == trace


def test_decision_memory_is_unchanged_without_engine_trace():
    memory = {"score_final": 710}

    _apply_score_engine_trace(memory, None)

    assert memory == {"score_final": 710}


def _policy_entity():
    return SimpleNamespace(
        id=91,
        name="Legacy Decision Policy",
        version=3,
        status=SimpleNamespace(value="active"),
        published_at=None,
        rules=[],
    )


def _runtime_policy(cap_ratio: str = "0.20"):
    return SimpleNamespace(
        decision=SimpleNamespace(
            band_limit_caps={
                ScoreBand.A: Decimal(cap_ratio),
                ScoreBand.B: Decimal(cap_ratio),
                ScoreBand.C: Decimal(cap_ratio),
                ScoreBand.D: Decimal(cap_ratio),
            },
            max_indebtedness_for_auto_approval=Decimal("0.50"),
        )
    )


def _source_entry(*, declared_revenue=None, declared_indebtedness=None, has_restrictions=False):
    return SimpleNamespace(
        id=17,
        source_type=SimpleNamespace(value="manual_entry"),
        declared_revenue=declared_revenue,
        declared_indebtedness=declared_indebtedness,
        has_restrictions=has_restrictions,
    )


def _score_result(*, band: ScoreBand, source: str, net_revenue: str | None, reason_code: str | None = None):
    pillar = {
        "pillar_code": PILLAR_CODE,
        "pillar_name": "Pilar 1",
        "source": source,
        "indicators": [],
        "calculation_trace": [],
    }
    if net_revenue is not None:
        pillar["indicators"].append({"code": "ebitda", "net_revenue": net_revenue})
    if reason_code is not None:
        pillar["calculation_trace"].append({"step": "missing_agrisk_financial_analysis", "reason_code": reason_code})

    return SimpleNamespace(
        score_band=band,
        final_score=880,
        calculation_memory_json={
            "score_source": "configurable_policy",
            "explainability": {"pillars_evaluated": [pillar]},
            "engine_trace": {"engine": "configurable_policy", "policy_id": 11, "policy_code": "coface_first", "policy_version": 5, "effective_weight": 85},
        },
    )


def test_calculate_and_apply_decision_uses_manual_financial_revenue_basis_from_score_result():
    analysis = SimpleNamespace(
        id=81,
        requested_limit=Decimal("1000000.00"),
        annual_revenue_estimated=Decimal("123.00"),
        decision_memory_json={},
        decision_calculated_at=None,
        motor_result=None,
        suggested_limit=None,
    )
    score_result = _score_result(
        band=ScoreBand.A,
        source="manual_financial_statements",
        net_revenue="4500000.00",
    )
    source_entry = _source_entry(declared_revenue=Decimal("999.00"), declared_indebtedness=None, has_restrictions=False)

    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.side_effect = [score_result, source_entry]

    with (
        patch("app.services.decision.ensure_active_policy", return_value=_policy_entity()),
        patch("app.services.decision.build_runtime_policy_from_entity", return_value=_runtime_policy("0.20")),
    ):
        updated_analysis, _, recalculated = decision.calculate_and_apply_decision(db, 81)

    assert recalculated is False
    assert updated_analysis.motor_result == MotorResult.APPROVED
    assert updated_analysis.suggested_limit == Decimal("900000.00")
    assert updated_analysis.decision_memory_json["revenue_basis_type"] == "manual_financial_statements_net_revenue"
    assert updated_analysis.decision_memory_json["revenue_basis_value"] == "4500000.00"


def test_calculate_and_apply_decision_does_not_block_when_financial_data_is_not_available():
    analysis = SimpleNamespace(
        id=82,
        requested_limit=Decimal("1000000.00"),
        annual_revenue_estimated=Decimal("5000000.00"),
        decision_memory_json={},
        decision_calculated_at=None,
        motor_result=None,
        suggested_limit=None,
    )
    score_result = _score_result(
        band=ScoreBand.B,
        source="not_available",
        net_revenue=None,
        reason_code=FINANCIAL_DATA_NOT_AVAILABLE_REASON,
    )
    source_entry = _source_entry(declared_revenue=Decimal("8000000.00"), declared_indebtedness=Decimal("100000.00"), has_restrictions=False)

    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.side_effect = [score_result, source_entry]

    with (
        patch("app.services.decision.ensure_active_policy", return_value=_policy_entity()),
        patch("app.services.decision.build_runtime_policy_from_entity", return_value=_runtime_policy("0.20")),
    ):
        updated_analysis, _, recalculated = decision.calculate_and_apply_decision(db, 82)

    assert recalculated is False
    assert updated_analysis.motor_result == MotorResult.MANUAL_REVIEW
    assert updated_analysis.suggested_limit == Decimal("0.00")
    assert updated_analysis.decision_memory_json["revenue_basis_type"] == FINANCIAL_DATA_NOT_AVAILABLE_REASON
    assert updated_analysis.decision_memory_json["revenue_basis_value"] == "0.00"
