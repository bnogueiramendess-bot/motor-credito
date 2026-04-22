from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import ScoreBand
from app.models.external_data_entry import ExternalDataEntry
from app.models.score_result import ScoreResult
from app.services.credit_policy import (
    ActiveCreditPolicy,
    build_runtime_policy_from_entity,
    ensure_active_policy,
)


class ScoreCalculationError(Exception):
    pass


def _find_policy_rule(
    rules: list[CreditPolicyRule],
    *,
    field: str,
    score_band: ScoreBand | None = None,
    operator: str | None = None,
    threshold: Decimal | None = None,
    points: int | None = None,
) -> CreditPolicyRule | None:
    for rule in rules:
        if not rule.is_active:
            continue
        if rule.field != field:
            continue
        if score_band is not None and rule.score_band != score_band:
            continue
        if operator is not None and rule.operator != operator:
            continue
        if threshold is not None:
            rule_threshold = Decimal(str(rule.value))
            if rule_threshold != threshold:
                continue
        if points is not None and rule.points != points:
            continue
        return rule
    return None


def _rule_explanation_item(
    *,
    rule: CreditPolicyRule | None,
    expected_value: Any,
    actual_value: Any,
    matched: bool,
    impact_points: int,
    impact_type: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "rule_id": rule.id if rule is not None else None,
        "label": rule.label if rule is not None else "Regra derivada",
        "pillar": rule.pillar if rule is not None else None,
        "score_band": rule.score_band.value if rule is not None and rule.score_band is not None else None,
        "field": rule.field if rule is not None else None,
        "operator": rule.operator if rule is not None else None,
        "expected_value": expected_value,
        "actual_value": actual_value,
        "matched": matched,
        "impact_points": impact_points,
        "impact_type": impact_type,
        "reason": reason,
    }


def _resolve_score_band_with_explanations(
    *,
    score: int,
    policy: ActiveCreditPolicy,
    rules: list[CreditPolicyRule],
) -> tuple[ScoreBand, list[dict[str, Any]]]:
    evaluated_items: list[dict[str, Any]] = []

    for band in (ScoreBand.A, ScoreBand.B, ScoreBand.C, ScoreBand.D):
        threshold = policy.score.score_bands[band]
        min_ok = threshold.min_score is None or score >= threshold.min_score
        max_ok = threshold.max_score is None or score <= threshold.max_score

        min_rule = _find_policy_rule(rules, field="score.band.min", score_band=band, operator="gte")
        max_rule = _find_policy_rule(rules, field="score.band.max", score_band=band, operator="lte")

        evaluated_items.append(
            _rule_explanation_item(
                rule=min_rule,
                expected_value=threshold.min_score,
                actual_value=score,
                matched=min_ok,
                impact_points=0,
                impact_type="score_band_threshold",
                reason=(
                    f"Score {score} atende o mínimo da faixa {band.value}."
                    if min_ok
                    else f"Score {score} não atinge o mínimo da faixa {band.value}."
                ),
            )
        )
        evaluated_items.append(
            _rule_explanation_item(
                rule=max_rule,
                expected_value=threshold.max_score,
                actual_value=score,
                matched=max_ok,
                impact_points=0,
                impact_type="score_band_threshold",
                reason=(
                    f"Score {score} atende o máximo da faixa {band.value}."
                    if max_ok
                    else f"Score {score} excede o máximo da faixa {band.value}."
                ),
            )
        )

        if min_ok and max_ok:
            return band, evaluated_items

    return ScoreBand.D, evaluated_items


def _build_summary(
    *,
    rules_explanation: list[dict[str, Any]],
    base_score: int,
    final_score: int,
    score_band: ScoreBand,
) -> dict[str, Any]:
    matched_rules = sum(1 for item in rules_explanation if item["matched"] is True)
    not_matched_rules = sum(1 for item in rules_explanation if item["matched"] is False)
    total_impact_points = sum(int(item.get("impact_points", 0)) for item in rules_explanation)

    return {
        "base_score": base_score,
        "final_score": final_score,
        "score_band": score_band.value,
        "evaluated_rules": len(rules_explanation),
        "matched_rules": matched_rules,
        "not_matched_rules": not_matched_rules,
        "total_impact_points": total_impact_points,
    }


def _apply_adjustment(adjustments: list[dict[str, Any]], score: int, points: int, reason: str, detail: str) -> int:
    adjustments.append({"reason": reason, "points": points, "detail": detail})
    return score + points


def calculate_and_upsert_score(
    db: Session, analysis_id: int
) -> tuple[ScoreResult, ExternalDataEntry, bool]:
    active_policy_entity = ensure_active_policy(db)
    policy = build_runtime_policy_from_entity(active_policy_entity)
    active_rules = [rule for rule in active_policy_entity.rules if rule.is_active]

    source_entry = db.scalar(
        select(ExternalDataEntry)
        .where(ExternalDataEntry.credit_analysis_id == analysis_id)
        .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
    )
    if source_entry is None:
        raise ScoreCalculationError("No external data found for this analysis.")

    base_score = policy.score.base_score
    score = base_score
    applied_adjustments: list[dict[str, Any]] = []
    rules_explanation: list[dict[str, Any]] = []

    base_rule = _find_policy_rule(active_rules, field="score.base", operator="eq")
    rules_explanation.append(
        _rule_explanation_item(
            rule=base_rule,
            expected_value=policy.score.base_score,
            actual_value=base_score,
            matched=True,
            impact_points=0,
            impact_type="score_base",
            reason="Pontuação base da política aplicada.",
        )
    )

    restrictions_rule = _find_policy_rule(active_rules, field="score.penalty.restrictions", operator="eq")
    restrictions_expected = False
    restrictions_matched = source_entry.has_restrictions == restrictions_expected
    restrictions_impact = 0
    if source_entry.has_restrictions:
        restrictions_impact = policy.score.restrictions_penalty
        score = _apply_adjustment(
            applied_adjustments,
            score,
            restrictions_impact,
            "has_restrictions",
            "Restrições ativas identificadas",
        )
    rules_explanation.append(
        _rule_explanation_item(
            rule=restrictions_rule,
            expected_value=restrictions_expected,
            actual_value=source_entry.has_restrictions,
            matched=restrictions_matched,
            impact_points=restrictions_impact,
            impact_type="score_penalty",
            reason=(
                "Sem restrições ativas, sem penalidade."
                if restrictions_matched
                else "Restrições ativas encontradas, penalidade aplicada."
            ),
        )
    )

    protests_rule = _find_policy_rule(active_rules, field="score.penalty.protests_per_item", operator="per_item")
    protests_expected = 0
    protests_matched = source_entry.protests_count == protests_expected
    protests_impact = 0
    if source_entry.protests_count > 0:
        protests_impact = policy.score.protests_penalty_per_item * source_entry.protests_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            protests_impact,
            "protests_count",
            f"{source_entry.protests_count} protesto(s) encontrado(s)",
        )
    rules_explanation.append(
        _rule_explanation_item(
            rule=protests_rule,
            expected_value=protests_expected,
            actual_value=source_entry.protests_count,
            matched=protests_matched,
            impact_points=protests_impact,
            impact_type="score_penalty",
            reason=(
                "Sem protestos, sem penalidade."
                if protests_matched
                else "Protestos encontrados, penalidade proporcional aplicada."
            ),
        )
    )

    lawsuits_rule = _find_policy_rule(active_rules, field="score.penalty.lawsuits_per_item", operator="per_item")
    lawsuits_expected = 0
    lawsuits_matched = source_entry.lawsuits_count == lawsuits_expected
    lawsuits_impact = 0
    if source_entry.lawsuits_count > 0:
        lawsuits_impact = policy.score.lawsuits_penalty_per_item * source_entry.lawsuits_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            lawsuits_impact,
            "lawsuits_count",
            f"{source_entry.lawsuits_count} ação(ões) judicial(is) encontrada(s)",
        )
    rules_explanation.append(
        _rule_explanation_item(
            rule=lawsuits_rule,
            expected_value=lawsuits_expected,
            actual_value=source_entry.lawsuits_count,
            matched=lawsuits_matched,
            impact_points=lawsuits_impact,
            impact_type="score_penalty",
            reason=(
                "Sem ações judiciais, sem penalidade."
                if lawsuits_matched
                else "Ações judiciais encontradas, penalidade proporcional aplicada."
            ),
        )
    )

    bounced_checks_rule = _find_policy_rule(
        active_rules,
        field="score.penalty.bounced_checks_per_item",
        operator="per_item",
    )
    bounced_checks_expected = 0
    bounced_checks_matched = source_entry.bounced_checks_count == bounced_checks_expected
    bounced_checks_impact = 0
    if source_entry.bounced_checks_count > 0:
        bounced_checks_impact = policy.score.bounced_checks_penalty_per_item * source_entry.bounced_checks_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            bounced_checks_impact,
            "bounced_checks_count",
            f"{source_entry.bounced_checks_count} cheque(s) sem fundo encontrado(s)",
        )
    rules_explanation.append(
        _rule_explanation_item(
            rule=bounced_checks_rule,
            expected_value=bounced_checks_expected,
            actual_value=source_entry.bounced_checks_count,
            matched=bounced_checks_matched,
            impact_points=bounced_checks_impact,
            impact_type="score_penalty",
            reason=(
                "Sem cheques sem fundo, sem penalidade."
                if bounced_checks_matched
                else "Cheques sem fundo encontrados, penalidade proporcional aplicada."
            ),
        )
    )

    if (
        source_entry.declared_indebtedness is not None
        and source_entry.declared_revenue is not None
        and source_entry.declared_indebtedness > 0
        and source_entry.declared_revenue > 0
    ):
        debt_ratio = source_entry.declared_indebtedness / source_entry.declared_revenue
        for penalty in policy.score.debt_ratio_penalties:
            debt_ratio_rule = _find_policy_rule(
                active_rules,
                field="score.penalty.debt_ratio",
                operator="gt",
                threshold=penalty.threshold,
                points=penalty.points,
            )
            matched = debt_ratio <= penalty.threshold
            impact = 0
            if debt_ratio > penalty.threshold:
                impact = penalty.points
                score = _apply_adjustment(
                    applied_adjustments,
                    score,
                    impact,
                    "debt_ratio",
                    f"Índice de endividamento {debt_ratio:.4f} acima de {penalty.threshold}",
                )
                rules_explanation.append(
                    _rule_explanation_item(
                        rule=debt_ratio_rule,
                        expected_value=f"<= {penalty.threshold}",
                        actual_value=f"{debt_ratio:.4f}",
                        matched=False,
                        impact_points=impact,
                        impact_type="score_penalty",
                        reason=f"Índice de endividamento acima do limite {penalty.threshold}, penalidade aplicada.",
                    )
                )
                break

            rules_explanation.append(
                _rule_explanation_item(
                    rule=debt_ratio_rule,
                    expected_value=f"<= {penalty.threshold}",
                    actual_value=f"{debt_ratio:.4f}",
                    matched=matched,
                    impact_points=0,
                    impact_type="score_penalty",
                    reason=f"Índice de endividamento dentro do limite {penalty.threshold}.",
                )
            )
    else:
        debt_ratio_rule = _find_policy_rule(active_rules, field="score.penalty.debt_ratio", operator="gt")
        rules_explanation.append(
            _rule_explanation_item(
                rule=debt_ratio_rule,
                expected_value="receita e endividamento informados",
                actual_value=None,
                matched=False,
                impact_points=0,
                impact_type="score_penalty",
                reason="Dados insuficientes para avaliar penalidade por endividamento.",
            )
        )

    pre_clamp_score = score
    min_rule = _find_policy_rule(active_rules, field="score.min", operator="eq")
    max_rule = _find_policy_rule(active_rules, field="score.max", operator="eq")

    min_matched = pre_clamp_score >= policy.score.min_final_score
    max_matched = pre_clamp_score <= policy.score.max_final_score
    final_score = max(policy.score.min_final_score, min(policy.score.max_final_score, pre_clamp_score))

    rules_explanation.append(
        _rule_explanation_item(
            rule=min_rule,
            expected_value=policy.score.min_final_score,
            actual_value=pre_clamp_score,
            matched=min_matched,
            impact_points=final_score - pre_clamp_score if pre_clamp_score < policy.score.min_final_score else 0,
            impact_type="score_bound",
            reason=(
                "Score respeitou o limite mínimo."
                if min_matched
                else f"Score ajustado para o mínimo permitido ({policy.score.min_final_score})."
            ),
        )
    )
    rules_explanation.append(
        _rule_explanation_item(
            rule=max_rule,
            expected_value=policy.score.max_final_score,
            actual_value=pre_clamp_score,
            matched=max_matched,
            impact_points=final_score - pre_clamp_score if pre_clamp_score > policy.score.max_final_score else 0,
            impact_type="score_bound",
            reason=(
                "Score respeitou o limite máximo."
                if max_matched
                else f"Score ajustado para o máximo permitido ({policy.score.max_final_score})."
            ),
        )
    )

    score_band, band_explanations = _resolve_score_band_with_explanations(
        score=final_score,
        policy=policy,
        rules=active_rules,
    )
    rules_explanation.extend(band_explanations)

    summary = _build_summary(
        rules_explanation=rules_explanation,
        base_score=base_score,
        final_score=final_score,
        score_band=score_band,
    )

    calculation_memory_json = {
        "base_score": base_score,
        "applied_adjustments": applied_adjustments,
        "final_score": final_score,
        "score_band": score_band.value,
        "source_entry_id": source_entry.id,
        "source_type": source_entry.source_type.value,
        "summary": (
            f"Score final {final_score} na faixa {score_band.value}. "
            f"Foram avaliadas {summary['evaluated_rules']} regras da política ativa."
        ),
        "explainability": {
            "policy": {
                "policy_id": active_policy_entity.id,
                "policy_name": active_policy_entity.name,
                "policy_version": active_policy_entity.version,
                "policy_status": active_policy_entity.status.value,
                "published_at": active_policy_entity.published_at.isoformat() if active_policy_entity.published_at else None,
            },
            "score_summary": summary,
            "rules_evaluated": rules_explanation,
        },
    }

    score_result = db.scalar(select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id))
    recalculated = score_result is not None

    if score_result is None:
        score_result = ScoreResult(
            credit_analysis_id=analysis_id,
            base_score=base_score,
            final_score=final_score,
            score_band=score_band,
            calculation_memory_json=calculation_memory_json,
        )
        db.add(score_result)
    else:
        score_result.base_score = base_score
        score_result.final_score = final_score
        score_result.score_band = score_band
        score_result.calculation_memory_json = calculation_memory_json

    return score_result, source_entry, recalculated
