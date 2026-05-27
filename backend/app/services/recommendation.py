from decimal import Decimal, ROUND_HALF_UP

from app.models.enums import MotorResult

DECIMAL_ZERO = Decimal("0")


def _to_decimal(value: Decimal | int | float | str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _build_classification_payload(
    *,
    code: str,
    label: str,
    justification: str,
    requested: Decimal,
    current_approved: Decimal | None,
    coface_coverage: Decimal | None,
    engine_recommended: Decimal,
    final_suggested: Decimal,
    is_existing_customer: bool,
) -> dict[str, object]:
    financial_impact = None
    if current_approved is not None:
        financial_impact = str(_money(final_suggested - current_approved))
    return {
        "code": code,
        "label": label,
        "justification": justification,
        "show_current_limit": is_existing_customer and current_approved is not None and current_approved > DECIMAL_ZERO,
        "requested_limit": str(requested),
        "current_approved_limit": str(current_approved) if current_approved is not None else None,
        "coface_coverage_limit": str(coface_coverage) if coface_coverage is not None else None,
        "engine_recommended_limit": str(engine_recommended),
        "final_suggested_limit": str(final_suggested),
        "financial_impact": financial_impact,
        "is_existing_customer": is_existing_customer,
    }


def classify_recommendation(
    *,
    requested_limit: Decimal | int | float | str | None,
    engine_recommended_limit: Decimal | int | float | str | None,
    coface_coverage_limit: Decimal | int | float | str | None,
    current_approved_limit: Decimal | int | float | str | None,
    is_existing_customer: bool,
    motor_result: MotorResult | None,
) -> dict[str, object]:
    requested = _to_decimal(requested_limit) or DECIMAL_ZERO
    engine_recommended = _to_decimal(engine_recommended_limit) or DECIMAL_ZERO
    coface_coverage = _to_decimal(coface_coverage_limit)
    current_approved = _to_decimal(current_approved_limit)

    final_suggested = engine_recommended
    if coface_coverage is not None and coface_coverage > DECIMAL_ZERO and engine_recommended > coface_coverage:
        final_suggested = coface_coverage

    final_suggested = _money(max(DECIMAL_ZERO, final_suggested))
    requested = _money(max(DECIMAL_ZERO, requested))
    current_approved = _money(max(DECIMAL_ZERO, current_approved)) if current_approved is not None else None

    if final_suggested <= DECIMAL_ZERO or motor_result == MotorResult.REJECTED:
        return _build_classification_payload(
            code="rejection",
            label="Reprovação recomendada",
            justification="A política vigente não sustenta concessão de limite para esta solicitação.",
            requested=requested,
            current_approved=current_approved,
            coface_coverage=coface_coverage,
            engine_recommended=engine_recommended,
            final_suggested=final_suggested,
            is_existing_customer=is_existing_customer,
        )

    if requested > DECIMAL_ZERO and final_suggested >= requested:
        return _build_classification_payload(
            code="full_approval",
            label="Aprovação integral recomendada",
            justification="O limite sugerido final atende integralmente ao valor solicitado.",
            requested=requested,
            current_approved=current_approved,
            coface_coverage=coface_coverage,
            engine_recommended=engine_recommended,
            final_suggested=final_suggested,
            is_existing_customer=is_existing_customer,
        )

    if is_existing_customer and current_approved is not None and current_approved > DECIMAL_ZERO:
        if final_suggested == current_approved:
            return _build_classification_payload(
                code="maintain_current_limit",
                label="Manutenção do Limite Atual",
                justification="A recomendação final mantém o limite vigente, respeitando a cobertura COFACE disponível.",
                requested=requested,
                current_approved=current_approved,
                coface_coverage=coface_coverage,
                engine_recommended=engine_recommended,
                final_suggested=final_suggested,
                is_existing_customer=is_existing_customer,
            )
        if final_suggested < current_approved:
            return _build_classification_payload(
                code="reduction",
                label="Redução recomendada",
                justification="A recomendação final reduz o limite atual para respeitar os limites técnicos e de cobertura disponível.",
                requested=requested,
                current_approved=current_approved,
                coface_coverage=coface_coverage,
                engine_recommended=engine_recommended,
                final_suggested=final_suggested,
                is_existing_customer=is_existing_customer,
            )

    return _build_classification_payload(
        code="partial_approval",
        label="Aprovação parcial recomendada",
        justification="O limite sugerido final é inferior ao valor solicitado, com aprovação parcial da demanda.",
        requested=requested,
        current_approved=current_approved,
        coface_coverage=coface_coverage,
        engine_recommended=engine_recommended,
        final_suggested=final_suggested,
        is_existing_customer=is_existing_customer,
    )

