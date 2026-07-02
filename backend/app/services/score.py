import logging
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_analysis import CreditAnalysis
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import ScoreBand
from app.models.external_data_entry import ExternalDataEntry
from app.models.score_result import ScoreResult
from app.models.user import User
from app.services.credit_decision_policy_score_structure import (
    PLANNED_NO_EFFECT_PILLARS,
    get_score_structure,
    simulate_pillar_five_score,
    simulate_pillar_four_score,
    simulate_pillar_one_score,
    simulate_pillar_two_score,
    validate_score_structure,
)
from app.services.credit_policy import (
    ActiveCreditPolicy,
    build_runtime_policy_from_entity,
    ensure_active_policy,
)
from app.services.effective_credit_policy import (
    CONFIGURABLE_EFFECTIVE_WEIGHT,
    get_effective_credit_policy,
    has_pending_publication_or_archive_request,
    is_policy_published,
    publication_state_diagnostics,
)

logger = logging.getLogger(__name__)
CONFIGURABLE_SCORE_SOURCE = "configurable_policy"
LEGACY_SCORE_SOURCE = "legacy_policy"
POLICY_SNAPSHOT_KEY = "policy_snapshot"
BLOCKING_CONFIGURABLE_POLICY_REASONS = {
    "active_effective_policy_conflict",
    "active_policy_without_governed_publication",
    "policy_not_activated",
    "policy_has_pending_governance_request",
}


class ScoreCalculationError(Exception):
    pass


class ConfigurableScorePolicyUnavailable(ScoreCalculationError):
    def __init__(self, reason: str, details: dict[str, Any] | None = None):
        super().__init__(reason)
        self.reason = reason
        self.details = details or {}


def _policy_unavailable_message(reason: str, details: dict[str, Any] | None = None) -> str:
    labels = {
        "active_effective_policy_conflict": "Conflito de politicas ativas/vigentes: existe mais de uma politica elegivel para a data da analise.",
        "active_policy_without_governed_publication": "Politica ativa encontrada, mas ainda nao publicada via governanca.",
        "policy_not_activated": "Politica ativa sem data de ativacao/publicacao.",
        "policy_has_pending_governance_request": "Politica ativa possui solicitacao de publicacao ou arquivamento pendente.",
        "policy_not_found": "Nenhuma politica configuravel ativa/vigente encontrada.",
        "policy_not_operationally_configured": "Politica configuravel ativa nao esta operacionalmente configurada.",
        "invalid_effective_weight": "Politica configuravel ativa possui peso efetivo invalido.",
        "pillar_three_must_remain_planned": "Politica configuravel invalida: o pilar de condicoes de mercado deve permanecer planejado e sem efeito.",
    }
    if reason == "active_policy_without_governed_publication" and details:
        return (
            f"Politica id={details.get('policy_id')} status={details.get('status')}, "
            f"mas publication_status={details.get('publication_status')}."
        )
    return labels.get(reason, reason)



def _resolve_analysis_company_id(db: Session, analysis: CreditAnalysis | None, explicit_company_id: int | None = None) -> int | None:
    if explicit_company_id is not None:
        return explicit_company_id
    if analysis is None:
        return None
    owner_user_id = getattr(analysis, "current_owner_user_id", None)
    if owner_user_id is not None:
        owner = db.get(User, owner_user_id)
        if owner is not None:
            return owner.company_id
    return None
def _json_safe_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _get_policy_snapshot(analysis: CreditAnalysis | None) -> dict[str, Any] | None:
    if analysis is None or not isinstance(analysis.decision_memory_json, dict):
        return None
    snapshot = analysis.decision_memory_json.get(POLICY_SNAPSHOT_KEY)
    return snapshot if isinstance(snapshot, dict) else None


def _set_policy_snapshot(analysis: CreditAnalysis, snapshot: dict[str, Any]) -> None:
    memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
    memory[POLICY_SNAPSHOT_KEY] = snapshot
    analysis.decision_memory_json = memory


def _build_legacy_policy_snapshot(
    policy: Any | None,
    *,
    captured_at: datetime,
    fallback_used: bool = False,
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    snapshot = {
        "engine": LEGACY_SCORE_SOURCE,
        "policy_id": getattr(policy, "id", None),
        "policy_name": getattr(policy, "name", "Politica legado"),
        "policy_version": getattr(policy, "version", 1),
        "captured_at": captured_at.isoformat(),
        "fallback_used": fallback_used,
        "fallback_reason": fallback_reason,
    }
    return snapshot


def _build_configurable_policy_snapshot(
    policy: CreditDecisionPolicy,
    *,
    captured_at: datetime,
) -> dict[str, Any]:
    return {
        "engine": CONFIGURABLE_SCORE_SOURCE,
        "policy_id": policy.id,
        "policy_code": policy.code,
        "policy_name": policy.name,
        "policy_version": policy.version,
        "policy_status": getattr(policy, "status", None),
        "captured_at": captured_at.isoformat(),
        "published_at": _json_safe_datetime(getattr(policy, "published_at", None)),
        "publication_status": getattr(policy, "publication_status", "UNPUBLISHED"),
        "governance_request_id": getattr(policy, "governance_request_id", None),
        "effective_from": _json_safe_datetime(getattr(policy, "effective_from", None)),
        "effective_to": _json_safe_datetime(getattr(policy, "effective_to", None)),
        "effective_weight": int(CONFIGURABLE_EFFECTIVE_WEIGHT),
        "valid": True,
        "fallback_used": False,
        "fallback_reason": None,
    }


def _build_blocked_configurable_policy_snapshot(
    *,
    captured_at: datetime,
    reason: str,
) -> dict[str, Any]:
    return {
        "engine": CONFIGURABLE_SCORE_SOURCE,
        "policy_id": None,
        "policy_version": None,
        "captured_at": captured_at.isoformat(),
        "valid": False,
        "blocked": True,
        "fallback_used": False,
        "fallback_reason": reason,
    }


def capture_analysis_policy_snapshot(
    db: Session,
    analysis: CreditAnalysis,
    *,
    captured_at: datetime | None = None,
) -> dict[str, Any]:
    existing = _get_policy_snapshot(analysis)
    if existing is not None:
        return existing

    captured_at = captured_at or datetime.now(timezone.utc)
    try:
        company_id = _resolve_analysis_company_id(db, analysis)
        policy = _load_active_configurable_policy(
            db, analysis_date=getattr(analysis, "created_at", None) or captured_at, company_id=company_id
        )
        _validate_configurable_policy_ready(db, policy, company_id=company_id)
        snapshot = _build_configurable_policy_snapshot(policy, captured_at=captured_at)
    except ConfigurableScorePolicyUnavailable as exc:
        if exc.reason in BLOCKING_CONFIGURABLE_POLICY_REASONS:
            snapshot = _build_blocked_configurable_policy_snapshot(captured_at=captured_at, reason=exc.reason)
            memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
            memory[POLICY_SNAPSHOT_KEY] = snapshot
            analysis.decision_memory_json = memory
            return snapshot
        reason = exc.reason
        legacy_policy = ensure_active_policy(db)
        snapshot = _build_legacy_policy_snapshot(
            legacy_policy,
            captured_at=captured_at,
            fallback_used=True,
            fallback_reason=reason,
        )
    except Exception as exc:
        reason = exc.reason if isinstance(exc, ConfigurableScorePolicyUnavailable) else exc.__class__.__name__
        legacy_policy = ensure_active_policy(db)
        snapshot = _build_legacy_policy_snapshot(
            legacy_policy,
            captured_at=captured_at,
            fallback_used=True,
            fallback_reason=reason,
        )

    memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
    memory[POLICY_SNAPSHOT_KEY] = snapshot
    analysis.decision_memory_json = memory
    return snapshot


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
                    f"Score {score} atende o mÃ­nimo da faixa {band.value}."
                    if min_ok
                    else f"Score {score} nÃ£o atinge o mÃ­nimo da faixa {band.value}."
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
                    f"Score {score} atende o mÃ¡ximo da faixa {band.value}."
                    if max_ok
                    else f"Score {score} excede o mÃ¡ximo da faixa {band.value}."
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


def _calculate_and_upsert_legacy_score(
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
            reason="PontuaÃ§Ã£o base da polÃ­tica aplicada.",
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
            "RestriÃ§Ãµes ativas identificadas",
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
                "Sem restriÃ§Ãµes ativas, sem penalidade."
                if restrictions_matched
                else "RestriÃ§Ãµes ativas encontradas, penalidade aplicada."
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
            f"{source_entry.lawsuits_count} aÃ§Ã£o(Ãµes) judicial(is) encontrada(s)",
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
                "Sem aÃ§Ãµes judiciais, sem penalidade."
                if lawsuits_matched
                else "AÃ§Ãµes judiciais encontradas, penalidade proporcional aplicada."
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
                    f"Ãndice de endividamento {debt_ratio:.4f} acima de {penalty.threshold}",
                )
                rules_explanation.append(
                    _rule_explanation_item(
                        rule=debt_ratio_rule,
                        expected_value=f"<= {penalty.threshold}",
                        actual_value=f"{debt_ratio:.4f}",
                        matched=False,
                        impact_points=impact,
                        impact_type="score_penalty",
                        reason=f"Ãndice de endividamento acima do limite {penalty.threshold}, penalidade aplicada.",
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
                    reason=f"Ãndice de endividamento dentro do limite {penalty.threshold}.",
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
                "Score respeitou o limite mÃ­nimo."
                if min_matched
                else f"Score ajustado para o mÃ­nimo permitido ({policy.score.min_final_score})."
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
                "Score respeitou o limite mÃ¡ximo."
                if max_matched
                else f"Score ajustado para o mÃ¡ximo permitido ({policy.score.max_final_score})."
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
        "score_source": LEGACY_SCORE_SOURCE,
        "policy_id": active_policy_entity.id,
        "policy_name": active_policy_entity.name,
        "policy_version": active_policy_entity.version,
        "fallback_used": False,
        "fallback_reason": None,
        "summary": (
            f"Score final {final_score} na faixa {score_band.value}. "
            f"Foram avaliadas {summary['evaluated_rules']} regras da polÃ­tica ativa."
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
        "engine_trace": {
            "engine": LEGACY_SCORE_SOURCE,
            "policy_id": active_policy_entity.id,
            "policy_name": active_policy_entity.name,
            "policy_version": active_policy_entity.version,
            "source": "analysis_policy_snapshot" if _get_policy_snapshot(db.get(CreditAnalysis, analysis_id)) else "legacy_active_policy",
            "fallback_used": False,
            "fallback_reason": None,
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


def _score_band_from_configurable_score(final_score: int) -> ScoreBand:
    if final_score >= 800:
        return ScoreBand.A
    if final_score >= 700:
        return ScoreBand.B
    if final_score >= 600:
        return ScoreBand.C
    return ScoreBand.D


def _decimal_from_result(result: dict[str, Any], key: str) -> Decimal:
    return Decimal(str(result.get(key, "0")))


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


def _load_active_configurable_policy(
    db: Session,
    *,
    analysis_date: datetime | None = None,
    company_id: int | None = None,
) -> CreditDecisionPolicy:
    resolution = get_effective_credit_policy(db, company_id=company_id, analysis_date=analysis_date)
    if resolution.conflict or resolution.policy is None:
        raise ConfigurableScorePolicyUnavailable(
            resolution.reason or "policy_not_found",
            publication_state_diagnostics(resolution.policy, company_id=company_id),
        )
    return resolution.policy


def _validate_configurable_policy_ready(
    db: Session,
    policy: CreditDecisionPolicy,
    *,
    allow_inactive_snapshot: bool = False,
    company_id: int | None = None,
) -> dict[str, Any]:
    if not allow_inactive_snapshot:
        if policy.status != "active":
            raise ConfigurableScorePolicyUnavailable("policy_not_active")
        if policy.activated_at is None:
            raise ConfigurableScorePolicyUnavailable("policy_not_activated")
        if not is_policy_published(policy):
            raise ConfigurableScorePolicyUnavailable(
                "active_policy_without_governed_publication",
                publication_state_diagnostics(policy, company_id=company_id),
            )
        if has_pending_publication_or_archive_request(db, policy.id):
            raise ConfigurableScorePolicyUnavailable("policy_has_pending_governance_request")

    validation = validate_score_structure(db, policy.id)
    if validation.get("operational_status") != "configured":
        raise ConfigurableScorePolicyUnavailable("policy_not_operationally_configured")
    if Decimal(str(validation.get("effective_pillars_weight", "0"))) != CONFIGURABLE_EFFECTIVE_WEIGHT:
        raise ConfigurableScorePolicyUnavailable("invalid_effective_weight")

    structure = get_score_structure(db, policy.id, source="active")
    pillar_three = next(
        (
            item
            for item in structure.get("pillar_roadmap", [])
            if item.get("code") == "market_conditions"
        ),
        PLANNED_NO_EFFECT_PILLARS["market_conditions"],
    )
    if (
        pillar_three.get("status") != "planned"
        or pillar_three.get("is_effective") is not False
        or pillar_three.get("affects_score") is not False
    ):
        raise ConfigurableScorePolicyUnavailable("pillar_three_must_remain_planned")
    return structure


def _resolve_configurable_policy_for_analysis(
    db: Session,
    analysis: CreditAnalysis,
    *,
    company_id: int | None = None,
) -> tuple[CreditDecisionPolicy, dict[str, Any], dict[str, Any] | None]:
    snapshot = _get_policy_snapshot(analysis)
    if snapshot is not None and snapshot.get("engine") == CONFIGURABLE_SCORE_SOURCE:
        if snapshot.get("blocked") is True or snapshot.get("valid") is False:
            policy = _load_active_configurable_policy(
                db, analysis_date=getattr(analysis, "created_at", None), company_id=company_id
            )
            structure = _validate_configurable_policy_ready(db, policy, company_id=company_id)
            refreshed_snapshot = _build_configurable_policy_snapshot(policy, captured_at=datetime.now(timezone.utc))
            _set_policy_snapshot(analysis, refreshed_snapshot)
            return policy, structure, refreshed_snapshot
        policy_id = snapshot.get("policy_id")
        policy = db.get(CreditDecisionPolicy, policy_id) if policy_id is not None else None
        if policy is None:
            raise ConfigurableScorePolicyUnavailable("snapshot_policy_not_found")
        structure = _validate_configurable_policy_ready(db, policy, allow_inactive_snapshot=True, company_id=company_id)
        return policy, structure, snapshot

    policy = _load_active_configurable_policy(
        db, analysis_date=getattr(analysis, "created_at", None), company_id=company_id
    )
    structure = _validate_configurable_policy_ready(db, policy, company_id=company_id)
    snapshot = _build_configurable_policy_snapshot(policy, captured_at=datetime.now(timezone.utc))
    _set_policy_snapshot(analysis, snapshot)
    return policy, structure, snapshot


def _calculate_configurable_pillar_results(
    db: Session,
    *,
    policy: CreditDecisionPolicy,
    analysis: CreditAnalysis,
) -> list[dict[str, Any]]:
    customer_document = getattr(analysis.customer, "document_number", None)
    return [
        simulate_pillar_one_score(db, policy_id=policy.id, analysis_id=analysis.id),
        simulate_pillar_two_score(
            db,
            policy_id=policy.id,
            requested_limit_amount=analysis.requested_limit,
            analysis_id=analysis.id,
        ),
        simulate_pillar_four_score(
            db,
            policy_id=policy.id,
            cnpj=customer_document,
            analysis_id=analysis.id,
        ),
        simulate_pillar_five_score(
            db,
            policy_id=policy.id,
            cnpj=customer_document,
            analysis_id=analysis.id,
        ),
    ]


def _calculate_and_upsert_configurable_score(
    db: Session, analysis_id: int, *, company_id: int | None = None
) -> tuple[ScoreResult, ExternalDataEntry, bool]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise ScoreCalculationError("Credit analysis not found.")

    source_entry = db.scalar(
        select(ExternalDataEntry)
        .where(ExternalDataEntry.credit_analysis_id == analysis_id)
        .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
    )
    if source_entry is None:
        raise ScoreCalculationError("No external data found for this analysis.")

    resolved_company_id = _resolve_analysis_company_id(db, analysis, company_id)
    policy, structure, policy_snapshot = _resolve_configurable_policy_for_analysis(
        db, analysis, company_id=resolved_company_id
    )
    pillar_results = _calculate_configurable_pillar_results(db, policy=policy, analysis=analysis)
    safe_pillar_results = _json_safe(pillar_results)
    weighted_score = sum((_decimal_from_result(result, "weighted_score") for result in pillar_results), Decimal("0"))
    normalized_score = (weighted_score * Decimal("10") / CONFIGURABLE_EFFECTIVE_WEIGHT).quantize(
        Decimal("0.0001"),
        rounding=ROUND_HALF_UP,
    )
    final_score = int((normalized_score * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    final_score = max(0, min(1000, final_score))
    score_band = _score_band_from_configurable_score(final_score)

    calculation_memory_json = {
        "base_score": 0,
        "applied_adjustments": [],
        "final_score": final_score,
        "score_band": score_band.value,
        "source_entry_id": source_entry.id,
        "source_type": source_entry.source_type.value,
        "score_source": CONFIGURABLE_SCORE_SOURCE,
        "policy_id": policy.id,
        "policy_code": policy.code,
        "policy_version": policy.version,
        "effective_weight": int(CONFIGURABLE_EFFECTIVE_WEIGHT),
        "fallback_used": False,
        "summary": f"Score configuravel {final_score} na faixa {score_band.value}.",
        "explainability": {
            "policy": {
                "policy_id": policy.id,
                "policy_code": policy.code,
                "policy_name": policy.name,
                "policy_version": policy.version,
                "policy_status": getattr(policy, "status", None),
                "published_at": policy.published_at.isoformat() if getattr(policy, "published_at", None) else None,
                "publication_status": getattr(policy, "publication_status", "UNPUBLISHED"),
                "governance_request_id": getattr(policy, "governance_request_id", None),
            },
            "score_summary": {
                "base_score": 0,
                "weighted_score": str(weighted_score.quantize(Decimal("0.0001"))),
                "normalized_score": str(normalized_score),
                "final_score": final_score,
                "score_band": score_band.value,
                "effective_weight": int(CONFIGURABLE_EFFECTIVE_WEIGHT),
            },
            "pillars_evaluated": safe_pillar_results,
            "score_structure": {
                "effective_pillars_weight": _json_safe(structure["policy_progress"]["effective_pillars_weight"]),
                "planned_pillars_weight": _json_safe(structure["policy_progress"]["planned_pillars_weight"]),
                "pillar_roadmap": _json_safe(structure["pillar_roadmap"]),
            },
        },
        "engine_trace": {
            "engine": CONFIGURABLE_SCORE_SOURCE,
            "policy_id": policy.id,
            "policy_code": policy.code,
            "policy_version": policy.version,
            "effective_weight": int(CONFIGURABLE_EFFECTIVE_WEIGHT),
            "source": "analysis_policy_snapshot" if policy_snapshot is not None else "active_configurable_policy",
            "fallback_used": False,
        },
    }

    score_result = db.scalar(select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id))
    recalculated = score_result is not None
    if score_result is None:
        score_result = ScoreResult(
            credit_analysis_id=analysis_id,
            base_score=0,
            final_score=final_score,
            score_band=score_band,
            calculation_memory_json=calculation_memory_json,
        )
        db.add(score_result)
    else:
        score_result.base_score = 0
        score_result.final_score = final_score
        score_result.score_band = score_band
        score_result.calculation_memory_json = calculation_memory_json

    logger.info(
        "configurable_score_policy_used",
        extra={
            "analysis_id": analysis_id,
            "policy_id": policy.id,
            "policy_code": policy.code,
            "policy_version": policy.version,
            "final_score": final_score,
            "score_band": score_band.value,
        },
    )
    return score_result, source_entry, recalculated


def _policy_payload_from_memory(memory: dict[str, Any]) -> dict[str, Any]:
    explainability = memory.get("explainability") if isinstance(memory.get("explainability"), dict) else {}
    policy = explainability.get("policy") if isinstance(explainability.get("policy"), dict) else {}
    return policy if isinstance(policy, dict) else {}


def _engine_trace_from_memory(memory: dict[str, Any]) -> dict[str, Any]:
    trace = memory.get("engine_trace") if isinstance(memory.get("engine_trace"), dict) else {}
    return trace if isinstance(trace, dict) else {}


def build_score_pillars_contract(score_result: ScoreResult) -> dict[str, Any]:
    memory = score_result.calculation_memory_json if isinstance(score_result.calculation_memory_json, dict) else {}
    explainability = memory.get("explainability") if isinstance(memory.get("explainability"), dict) else {}
    pillars = explainability.get("pillars_evaluated") if isinstance(explainability.get("pillars_evaluated"), list) else None
    policy = _policy_payload_from_memory(memory)
    trace = _engine_trace_from_memory(memory)
    engine = str(memory.get("score_source") or trace.get("engine") or "unknown")

    if not pillars:
        fallback_reason = memory.get("fallback_reason") or trace.get("fallback_reason")
        return {
            "engine": engine,
            "available": False,
            "policy_id": policy.get("policy_id") or trace.get("policy_id") or memory.get("policy_id"),
            "policy_code": policy.get("policy_code") or trace.get("policy_code") or memory.get("policy_code"),
            "policy_version": policy.get("policy_version") or trace.get("policy_version") or memory.get("policy_version"),
            "reason": (
                _policy_unavailable_message(str(fallback_reason))
                if fallback_reason
                else "Score calculado pelo motor legado. Detalhamento por pilares configuraveis indisponivel."
                if engine == LEGACY_SCORE_SOURCE
                else "Detalhamento por pilares indisponivel na memoria de calculo do score."
            ),
            "items": [],
        }

    items: list[dict[str, Any]] = []
    for item in pillars:
        if not isinstance(item, dict):
            continue
        items.append({
            "code": item.get("pillar_code"),
            "name": item.get("pillar_name"),
            "score": item.get("score"),
            "max_score": 10,
            "weighted_score": item.get("weighted_score"),
            "weight_percent": item.get("weight_percent"),
            "status": item.get("status"),
            "source": item.get("source"),
            "reason": item.get("reason"),
            "warnings": item.get("warnings") if isinstance(item.get("warnings"), list) else [],
            "calculation_trace": item.get("calculation_trace") if isinstance(item.get("calculation_trace"), list) else [],
        })

    return {
        "engine": CONFIGURABLE_SCORE_SOURCE,
        "available": True,
        "policy_id": policy.get("policy_id") or memory.get("policy_id"),
        "policy_code": policy.get("policy_code") or memory.get("policy_code"),
        "policy_version": policy.get("policy_version") or memory.get("policy_version"),
        "reason": None,
        "items": items,
    }


def _apply_configurable_fallback_memory(
    score_result: ScoreResult,
    *,
    reason: str,
) -> None:
    memory = dict(score_result.calculation_memory_json or {})
    previous_trace = memory.get("engine_trace") if isinstance(memory.get("engine_trace"), dict) else {}
    memory.update(
        {
            "score_source": LEGACY_SCORE_SOURCE,
            "fallback_used": True,
            "fallback_reason": reason,
            "engine_trace": {
                "engine": LEGACY_SCORE_SOURCE,
                "policy_id": memory.get("policy_id"),
                "policy_name": memory.get("policy_name"),
                "policy_version": memory.get("policy_version"),
                "source": previous_trace.get("source", "configurable_policy_fallback"),
                "fallback_used": True,
                "fallback_reason": reason,
            },
        }
    )
    score_result.calculation_memory_json = memory


def calculate_and_upsert_score(
    db: Session, analysis_id: int, *, company_id: int | None = None
) -> tuple[ScoreResult, ExternalDataEntry, bool]:
    analysis = db.get(CreditAnalysis, analysis_id)
    snapshot = _get_policy_snapshot(analysis)
    if snapshot is not None and snapshot.get("engine") == LEGACY_SCORE_SOURCE:
        return _calculate_and_upsert_legacy_score(db, analysis_id)
    existing_score = db.scalar(select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id))
    existing_memory = existing_score.calculation_memory_json if existing_score is not None else None
    if snapshot is None and isinstance(existing_memory, dict) and existing_memory.get("score_source") == LEGACY_SCORE_SOURCE:
        return _calculate_and_upsert_legacy_score(db, analysis_id)

    try:
        return _calculate_and_upsert_configurable_score(db, analysis_id, company_id=company_id)
    except Exception as exc:
        reason = exc.reason if isinstance(exc, ConfigurableScorePolicyUnavailable) else exc.__class__.__name__
        if reason in BLOCKING_CONFIGURABLE_POLICY_REASONS:
            logger.error(
                "configurable_score_policy_blocked",
                extra={"analysis_id": analysis_id, "reason": reason},
            )
            details = exc.details if isinstance(exc, ConfigurableScorePolicyUnavailable) else {}
            raise ScoreCalculationError(_policy_unavailable_message(reason, details)) from exc
        logger.warning(
            "configurable_score_policy_fallback",
            extra={"analysis_id": analysis_id, "fallback_reason": reason},
            exc_info=not isinstance(exc, ConfigurableScorePolicyUnavailable),
        )
        score_result, source_entry, recalculated = _calculate_and_upsert_legacy_score(db, analysis_id)
        _apply_configurable_fallback_memory(score_result, reason=reason)
        return score_result, source_entry, recalculated
