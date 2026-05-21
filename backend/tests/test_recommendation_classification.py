from decimal import Decimal

from app.models.enums import MotorResult
from app.services.recommendation import classify_recommendation


def test_existing_customer_maintains_current_limit() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("4500000"),
        coface_coverage_limit=Decimal("4500000"),
        engine_recommended_limit=Decimal("4500000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["label"] == "Manutenção do limite atual recomendada"
    assert result["final_suggested_limit"] == "4500000.00"
    assert result["is_existing_customer"] is True
    assert result["show_current_limit"] is True
    assert result["justification"] == "Cliente já possui limite vigente compatível com a cobertura COFACE atual. A recomendação mantém o limite aprovado e não concede o aumento solicitado."


def test_existing_customer_partial_approval_with_increase() -> None:
    result = classify_recommendation(
        requested_limit=Decimal("5000000"),
        current_approved_limit=Decimal("3000000"),
        coface_coverage_limit=Decimal("4500000"),
        engine_recommended_limit=Decimal("3000000"),
        is_existing_customer=True,
        motor_result=MotorResult.MANUAL_REVIEW,
    )
    assert result["label"] == "Aprovação parcial recomendada"


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
        requested_limit=Decimal("1000000"),
        current_approved_limit=None,
        coface_coverage_limit=None,
        engine_recommended_limit=Decimal("1000000"),
        is_existing_customer=False,
        motor_result=MotorResult.APPROVED,
    )
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
