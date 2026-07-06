from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.services.credit_decision_policy_score_structure import simulate_pillar_one_score
from app.services.manual_financial_statements import FINANCIAL_DATA_NOT_AVAILABLE_REASON


def _result(*, source: str, status: str = "calculated", score: str = "7.00") -> dict:
    return {
        "pillar_code": "financial_stability_liquidity",
        "pillar_name": "Pilar 1",
        "score": Decimal(score),
        "weighted_score": Decimal("3.8500" if score != "0.00" else "0.0000"),
        "weight_percent": 55,
        "status": status,
        "source": source,
        "reason": None,
        "warnings": [],
        "calculation_trace": [],
        "mapper_trace": [],
        "mapper_warnings": [],
    }


def test_simulate_pillar_one_score_prefers_agrisk_over_manual_data():
    db = MagicMock()
    agrisk_payload = {"report_type": "AGRISK_FINANCIAL_ANALYSIS"}
    manual_payload = {"source": "manual_financial_statements"}
    agrisk_result = _result(source="agrisk_financial_analysis")

    with (
        patch("app.services.credit_decision_policy_score_structure._load_policy"),
        patch("app.services.credit_decision_policy_score_structure._find_agrisk_financial_payload_for_analysis", return_value=agrisk_payload),
        patch("app.services.credit_decision_policy_score_structure._find_manual_financial_payload_for_analysis", return_value=manual_payload),
        patch("app.services.credit_decision_policy_score_structure.calculate_pillar_one_from_agrisk_payload", return_value=agrisk_result) as agrisk_calc,
        patch("app.services.credit_decision_policy_score_structure.calculate_pillar_one_score") as manual_calc,
    ):
        result = simulate_pillar_one_score(db, policy_id=99, analysis_id=81)

    agrisk_calc.assert_called_once_with(
        db=db,
        policy_id=99,
        has_valid_coface=False,
        agrisk_financial_payload=agrisk_payload,
        analysis_id=81,
    )
    manual_calc.assert_not_called()
    assert result["simulation"]["financial_source"] == "agrisk_financial_analysis"


def test_simulate_pillar_one_score_uses_manual_data_when_agrisk_is_missing():
    db = MagicMock()
    manual_payload = {"source": "manual_financial_statements", "financial_indicators": {"liquidity_general": Decimal("2.50")}}
    manual_result = _result(source="manual_financial_statements")

    with (
        patch("app.services.credit_decision_policy_score_structure._load_policy"),
        patch("app.services.credit_decision_policy_score_structure._find_agrisk_financial_payload_for_analysis", return_value=None),
        patch("app.services.credit_decision_policy_score_structure._find_manual_financial_payload_for_analysis", return_value=manual_payload),
        patch("app.services.credit_decision_policy_score_structure.calculate_pillar_one_score", return_value=manual_result) as manual_calc,
    ):
        result = simulate_pillar_one_score(db, policy_id=99, analysis_id=81)

    manual_calc.assert_called_once_with(
        db=db,
        policy_id=99,
        has_valid_coface=False,
        agrisk_financial_data=manual_payload,
        financial_data_source="manual_financial_statements",
        analysis_id=81,
    )
    assert result["simulation"]["financial_source"] == "manual_financial_statements"


def test_simulate_pillar_one_score_zeroes_pillar_when_financial_sources_are_missing():
    db = MagicMock()
    unavailable_result = _result(source="not_available", status="not_available", score="0.00")

    with (
        patch("app.services.credit_decision_policy_score_structure._load_policy"),
        patch("app.services.credit_decision_policy_score_structure._find_agrisk_financial_payload_for_analysis", return_value=None),
        patch("app.services.credit_decision_policy_score_structure._find_manual_financial_payload_for_analysis", return_value=None),
        patch("app.services.credit_decision_policy_score_structure.calculate_pillar_one_score", return_value=unavailable_result) as unavailable_calc,
    ):
        result = simulate_pillar_one_score(db, policy_id=99, analysis_id=81)

    unavailable_calc.assert_called_once_with(
        db=db,
        policy_id=99,
        has_valid_coface=False,
        agrisk_financial_data=None,
        not_available_reason_code=FINANCIAL_DATA_NOT_AVAILABLE_REASON,
        analysis_id=81,
    )
    assert result["score"] == Decimal("0.00")
    assert result["simulation"]["financial_source"] == "not_available"
    assert result["warnings"] == [{"reason": "financial_data_not_available"}]
