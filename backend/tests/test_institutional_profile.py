from app.models.enums import MotorResult
from app.services.institutional_profile import (
    build_recommendation_summary,
    build_score_calculation,
    calculate_profile_status,
    has_valid_coface_from_score_memory,
    score_1000_to_100,
)


def _indicator(code, *, value=1.2, score="6.00", status="used", source="agrisk_financial"):
    return {
        "code": code,
        "label": code.replace("_", " ").title(),
        "value": value,
        "source": source,
        "score": score,
        "weight_percent": 10,
        "status": status,
    }


def _memory(*, financial=True, coface=True, internal=True, agrisk_score=True, manual=True):
    pillars = []
    pillars.append({
        "pillar_code": "financial_stability_liquidity",
        "score": "8.00" if financial else "0.00",
        "weighted_score": "4.4000" if financial else "0.0000",
        "weight_percent": 55,
        "status": "calculated" if financial else "not_available",
        "source": "agrisk_financial_analysis" if financial else "not_available",
        "indicators": [
            _indicator("liquidity_ratio", value=1.2, score="6.00", status="used" if financial else "not_available"),
            _indicator("ebitda_margin", value=None, score=None, status="not_available", source="manual_complement"),
        ],
    })
    pillars.append({
        "pillar_code": "guarantees_credit_insurance",
        "score": "10.00" if coface else "0.00",
        "weighted_score": "2.0000" if coface else "0.0000",
        "weight_percent": 20,
        "status": "calculated",
        "source": "coface",
        "indicators": [_indicator("coface_coverage_requested_ratio", value=1 if coface else None, score="10.00" if coface else None, source="coface", status="used" if coface else "not_available")],
    })
    pillars.append({
        "pillar_code": "payment_history",
        "score": "8.00" if internal else "0.00",
        "weighted_score": "0.4000" if internal else "0.0000",
        "weight_percent": 5,
        "status": "calculated" if internal else "not_available",
        "source": "ar_aging",
        "indicators": [_indicator("current_overdue_ratio", value=0, score="10.00" if internal else None, source="internal_portfolio", status="used" if internal else "not_available")],
    })
    return {
        "sources": {
            "agrisk_financial": financial,
            "agrisk_score": agrisk_score,
            "coface": coface,
            "internal_portfolio": internal,
            "manual_complement": manual,
        },
        "explainability": {"pillars_evaluated": pillars},
    }


def test_score_1000_to_100_uses_single_rounding_rule():
    assert score_1000_to_100(385) == 39
    assert score_1000_to_100(384) == 38
    assert score_1000_to_100(None) is None


def test_profile_status_consolidated_when_minimum_sources_are_available():
    status = calculate_profile_status(_memory(financial=True, coface=True, internal=True, agrisk_score=True, manual=True))
    assert status["code"] == "profile_consolidated"
    assert status["profile_completion_percent"] >= 85
    assert status["missing_sources"] == []
    assert status["score_is_definitive"] is True


def test_profile_status_partial_without_coface_but_with_score_inputs():
    memory = _memory(financial=True, coface=False, internal=True, agrisk_score=True, manual=True)
    status = calculate_profile_status(memory)
    assert status["code"] == "profile_partially_consolidated"
    assert status["profile_completion_percent"] == 75
    assert "coface" in status["missing_sources"]
    assert has_valid_coface_from_score_memory(memory) is False


def test_profile_status_not_consolidated_with_few_sources():
    status = calculate_profile_status(_memory(financial=False, coface=False, internal=True, agrisk_score=False, manual=False))
    assert status["code"] == "profile_not_consolidated"
    assert status["profile_completion_percent"] < 35
    assert status["score_is_definitive"] is False


def test_score_calculation_returns_auditable_breakdown_with_indicators():
    result = build_score_calculation(680, _memory(financial=True, coface=True, internal=True))
    financial = result["calculation"]["financial_stability_liquidity"]
    assert result["score"] == 68
    assert result["engine_score"] == 680
    assert financial["weight"] == 55.0
    assert financial["contribution"] == 4.4
    assert financial["indicators"][0]["code"] == "liquidity_ratio"
    assert financial["indicators"][0]["source"] == "agrisk_financial"
    assert financial["indicators"][0]["status"] == "used"
    assert financial["indicators"][1]["status"] == "not_available"


def test_recommendation_summary_is_structured_for_executive_dossier():
    profile_status = calculate_profile_status(_memory(financial=True, coface=False, internal=True))
    summary = build_recommendation_summary(
        score_100=58,
        profile_status=profile_status,
        has_valid_coface=False,
        has_internal_history=True,
        motor_result=MotorResult.MANUAL_REVIEW,
        reasons=["missing_valid_coface_committee_required"],
    )
    assert set(summary) == {"positive_factors", "negative_factors", "risk_factors", "mitigating_factors", "final_rationale"}
    assert "Ausência de cobertura COFACE válida impede recomendação automática de limite." in summary["risk_factors"]
    assert "Comitê" in summary["final_rationale"]


def test_score_1000_to_10_executive_scale():
    from app.services.institutional_profile import score_1000_to_10

    assert score_1000_to_10(190) == 1.9
    assert score_1000_to_10(1000) == 10.0
    assert score_1000_to_10(None) is None


def test_build_score_calculation_exposes_executive_score_10_without_changing_engine_score():
    result = build_score_calculation(190, _memory(financial=True, coface=True, internal=True))

    assert result["engine_score"] == 190
    assert result["executive_score_10"] == 1.9
    assert result["executive_scale"] == "0-10"
