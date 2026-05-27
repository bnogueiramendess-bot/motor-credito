from decimal import Decimal

from app.models.enums import MotorResult
from app.services.recommendation import classify_recommendation


def test_existing_customer_maintains_current_limit() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("4500000"),
        coface_coverage_limit=Decimal("4500000"),
        engine_recommended_limit=Decimal("6000000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["code"] == "maintain_current_limit"
    assert result["label"] == "Manutenção do Limite Atual"
    assert result["final_suggested_limit"] == "4500000.00"
    assert result["financial_impact"] == "0.00"
    assert result["is_existing_customer"] is True
    assert result["show_current_limit"] is True
    assert result["justification"] == "A recomendação final mantém o limite vigente, respeitando a cobertura COFACE disponível."


def test_existing_customer_partial_approval_with_increase() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("3000000"),
        coface_coverage_limit=Decimal("4500000"),
        engine_recommended_limit=Decimal("4200000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["code"] == "partial_approval"
    assert result["label"] == "Aprovação parcial recomendada"


def test_existing_customer_reduction_when_final_below_current() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("4500000"),
        coface_coverage_limit=Decimal("3000000"),
        engine_recommended_limit=Decimal("3000000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["code"] == "reduction"
    assert result["label"] == "Redução recomendada"
    assert result["final_suggested_limit"] == "3000000.00"


def test_new_customer_partial_with_coface_below_requested() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("3500000"),
        current_approved_limit=None,
        coface_coverage_limit=Decimal("3000000"),
        engine_recommended_limit=Decimal("2500000"),
        is_existing_customer=False,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["label"] == "Aprovação parcial recomendada"


def test_new_customer_full_approval() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=None,
        coface_coverage_limit=None,
        engine_recommended_limit=Decimal("5000000"),
        is_existing_customer=False,
        motor_result=MotorResult.APPROVED,
    )
    assert result["code"] == "full_approval"
    assert result["label"] == "Aprovação integral recomendada"


def test_new_customer_rejection_zero_limit() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("1000000"),
        current_approved_limit=None,
        coface_coverage_limit=None,
        engine_recommended_limit=Decimal("0"),
        is_existing_customer=False,
        motor_result=MotorResult.REJECTED,
    )
    assert result["label"] == "Reprovação recomendada"


def test_existing_customer_maintenance_when_engine_above_coface_at_current_limit() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("4500000"),
        coface_coverage_limit=Decimal("4500000"),
        engine_recommended_limit=Decimal("5000000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["code"] == "maintain_current_limit"
    assert result["final_suggested_limit"] == "4500000.00"
    assert result["financial_impact"] == "0.00"


def test_coface_does_not_reduce_when_coverage_is_above_engine_limit() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("3000000"),
        coface_coverage_limit=Decimal("6000000"),
        engine_recommended_limit=Decimal("4200000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["final_suggested_limit"] == "4200000.00"
    assert result["code"] == "partial_approval"
