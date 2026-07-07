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


def _score_result(*, band: ScoreBand, source: str, net_revenue: str | None, reason_code: str | None = None, coface: bool = True, internal: bool = True):
    pillar = {
        "pillar_code": PILLAR_CODE,
        "pillar_name": "Pilar 1",
        "score": Decimal("8.00") if band != ScoreBand.D else Decimal("3.00"),
        "weighted_score": Decimal("4.4000") if band != ScoreBand.D else Decimal("1.6500"),
        "weight_percent": Decimal("55"),
        "status": "calculated",
        "source": source,
        "indicators": [],
        "calculation_trace": [],
    }
    if net_revenue is not None:
        pillar["indicators"].append({
            "code": "ebitda",
            "label": "EBITDA",
            "value": net_revenue,
            "net_revenue": net_revenue,
            "source": source,
            "score": Decimal("8.00") if band != ScoreBand.D else Decimal("3.00"),
            "weight_percent": Decimal("40"),
            "status": "used",
        })
    if reason_code is not None:
        pillar["calculation_trace"].append({"step": "missing_agrisk_financial_analysis", "reason_code": reason_code})

    guarantee_pillar = {
        "pillar_code": "guarantees_credit_insurance",
        "pillar_name": "Pilar 2",
        "score": Decimal("10.00") if coface else Decimal("0.00"),
        "weighted_score": Decimal("2.0000") if coface else Decimal("0.0000"),
        "weight_percent": Decimal("20"),
        "status": "calculated",
        "source": "coface",
        "indicators": [{
            "code": "coface_coverage_requested_ratio",
            "label": "Cobertura COFACE sobre Limite Solicitado",
            "value": Decimal("1.00") if coface else None,
            "source": "coface",
            "score": Decimal("10.00") if coface else None,
            "weight_percent": Decimal("100"),
            "status": "used" if coface else "not_available",
        }],
    }
    internal_pillar = {
        "pillar_code": "payment_history",
        "pillar_name": "Pilar 4",
        "score": Decimal("8.00") if internal else Decimal("0.00"),
        "weighted_score": Decimal("0.4000") if internal else Decimal("0.0000"),
        "weight_percent": Decimal("5"),
        "status": "calculated" if internal else "not_available",
        "source": "ar_aging",
        "indicators": [{
            "code": "current_overdue_ratio",
            "label": "Percentual Vencido Atual",
            "value": Decimal("0.00") if internal else None,
            "source": "internal_portfolio",
            "score": Decimal("10.00") if internal else None,
            "weight_percent": Decimal("100"),
            "status": "used" if internal else "not_available",
        }],
    }

    return SimpleNamespace(
        score_band=band,
        final_score=880 if band != ScoreBand.D else 380,
        calculation_memory_json={
            "score_source": "configurable_policy",
            "sources": {
                "agrisk_financial": source.startswith("agrisk"),
                "agrisk_score": True,
                "coface": coface,
                "internal_portfolio": internal,
                "manual_complement": source.startswith("manual"),
            },
            "explainability": {"pillars_evaluated": [pillar, guarantee_pillar, internal_pillar]},
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



def test_calculate_and_apply_decision_without_coface_routes_to_committee_without_auto_limit():
    analysis = SimpleNamespace(
        id=83,
        requested_limit=Decimal("1000000.00"),
        annual_revenue_estimated=Decimal("5000000.00"),
        decision_memory_json={},
        decision_calculated_at=None,
        motor_result=None,
        suggested_limit=None,
    )
    score_result = _score_result(
        band=ScoreBand.A,
        source="manual_financial_statements",
        net_revenue="4500000.00",
        coface=False,
        internal=True,
    )
    source_entry = _source_entry(declared_revenue=Decimal("8000000.00"), declared_indebtedness=None, has_restrictions=False)

    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.side_effect = [score_result, source_entry]

    with (
        patch("app.services.decision.ensure_active_policy", return_value=_policy_entity()),
        patch("app.services.decision.build_runtime_policy_from_entity", return_value=_runtime_policy("0.20")),
    ):
        updated_analysis, _, _ = decision.calculate_and_apply_decision(db, 83)

    assert updated_analysis.motor_result == MotorResult.MANUAL_REVIEW
    assert updated_analysis.suggested_limit == Decimal("0.00")
    assert "missing_valid_coface_committee_required" in updated_analysis.decision_memory_json["reasons"]
    assert updated_analysis.decision_memory_json["profile_status"]["code"] == "profile_partially_consolidated"
    assert updated_analysis.decision_memory_json["profile_status"]["profile_completion_percent"] >= 35
    assert updated_analysis.decision_memory_json["executive_score"] == 88
    assert updated_analysis.decision_memory_json["requires_committee"] is True
    assert updated_analysis.decision_memory_json["committee_reason"] == decision.COMMITTEE_COFACE_REASON
    assert updated_analysis.decision_memory_json["recommendation"] != "reject"
    assert updated_analysis.decision_memory_json["summary"]["risk_factors"]
    assert updated_analysis.decision_memory_json["summary"]["final_rationale"]


def test_calculate_and_apply_decision_low_score_rejects_when_coface_is_valid():
    analysis = SimpleNamespace(
        id=84,
        requested_limit=Decimal("1000000.00"),
        annual_revenue_estimated=Decimal("5000000.00"),
        decision_memory_json={},
        decision_calculated_at=None,
        motor_result=None,
        suggested_limit=None,
    )
    score_result = _score_result(
        band=ScoreBand.D,
        source="manual_financial_statements",
        net_revenue="4500000.00",
        coface=True,
        internal=True,
    )
    source_entry = _source_entry(declared_revenue=Decimal("8000000.00"), declared_indebtedness=None, has_restrictions=False)

    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.side_effect = [score_result, source_entry]

    with (
        patch("app.services.decision.ensure_active_policy", return_value=_policy_entity()),
        patch("app.services.decision.build_runtime_policy_from_entity", return_value=_runtime_policy("0.20")),
    ):
        updated_analysis, _, _ = decision.calculate_and_apply_decision(db, 84)

    assert updated_analysis.motor_result == MotorResult.REJECTED
    assert updated_analysis.suggested_limit == Decimal("0.00")
    assert "score_band_d" in updated_analysis.decision_memory_json["reasons"]
