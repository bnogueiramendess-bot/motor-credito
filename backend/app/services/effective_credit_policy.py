from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest


CONFIGURABLE_EFFECTIVE_WEIGHT = Decimal("85")
PUBLISHED_PUBLICATION_STATUS = "PUBLISHED"
UNPUBLISHED_PUBLICATION_STATUS = "UNPUBLISHED"
REVOKED_PUBLICATION_STATUS = "REVOKED"


@dataclass(frozen=True)
class EffectiveCreditPolicyResolution:
    policy: CreditDecisionPolicy | None
    policy_id: int | None
    version: int | None
    status: str | None
    effective_from: datetime | None
    effective_to: datetime | None
    published: bool
    valid: bool
    conflict: bool
    reason: str | None
    candidates: list[dict[str, Any]]
    validation: dict[str, Any] | None
    publication_event: dict[str, Any] | None = None


@dataclass(frozen=True)
class PolicyMotorBindingResolution:
    policy_id: int
    is_bound: bool
    reason: str | None
    label: str
    published: bool
    valid: bool
    conflict: bool
    selected_policy_id: int | None
    selected_policy_version: int | None
    publication_event: dict[str, Any] | None
    candidates: list[dict[str, Any]]


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _is_effective(policy: CreditDecisionPolicy, analysis_date: datetime) -> bool:
    effective_at = _as_aware_utc(analysis_date)
    effective_from = _as_aware_utc(policy.effective_from) if policy.effective_from is not None else None
    effective_to = _as_aware_utc(policy.effective_to) if policy.effective_to is not None else None
    if effective_from is not None and effective_from > effective_at:
        return False
    if effective_to is not None and effective_to < effective_at:
        return False
    return True


def _publication_status(policy: CreditDecisionPolicy) -> str:
    return str(getattr(policy, "publication_status", None) or UNPUBLISHED_PUBLICATION_STATUS)


def is_policy_published(policy: CreditDecisionPolicy) -> bool:
    return _publication_status(policy) == PUBLISHED_PUBLICATION_STATUS


def publication_state_diagnostics(policy: CreditDecisionPolicy | None, *, company_id: int | None = None) -> dict[str, Any]:
    return {
        "policy_id": getattr(policy, "id", None),
        "company_id": company_id,
        "status": getattr(policy, "status", None),
        "publication_status": _publication_status(policy) if policy is not None else None,
    }


def _policy_publication_record(policy: CreditDecisionPolicy) -> dict[str, Any] | None:
    if not is_policy_published(policy):
        return None
    return {
        "policy_id": policy.id,
        "publication_status": _publication_status(policy),
        "published_at": policy.published_at.isoformat() if policy.published_at else None,
        "published_by_user_id": policy.published_by_user_id,
        "governance_request_id": policy.governance_request_id,
    }


def _policy_candidate(policy: CreditDecisionPolicy) -> dict[str, Any]:
    return {
        "policy_id": policy.id,
        "policy_code": policy.code,
        "policy_name": policy.name,
        "policy_version": policy.version,
        "status": policy.status,
        "publication_status": _publication_status(policy),
        "effective_from": policy.effective_from.isoformat() if policy.effective_from else None,
        "effective_to": policy.effective_to.isoformat() if policy.effective_to else None,
        "activated_at": policy.activated_at.isoformat() if policy.activated_at else None,
        "published_at": policy.published_at.isoformat() if policy.published_at else None,
    }


def has_pending_publication_or_archive_request(db: Session, policy_id: int) -> bool:
    return db.scalar(
        select(CreditDecisionPolicyGovernanceRequest.id)
        .where(
            CreditDecisionPolicyGovernanceRequest.policy_id == policy_id,
            CreditDecisionPolicyGovernanceRequest.action_type.in_(["policy_publish", "policy_archive"]),
            CreditDecisionPolicyGovernanceRequest.status == "pending",
        )
        .limit(1)
    ) is not None


def _binding_label(reason: str | None, *, bound: bool) -> str:
    if bound:
        return "Vinculada ao Motor"
    labels = {
        "active_policy_without_governed_publication": "Ativa, mas pendente de publicacao",
        "policy_not_activated": "Ativa, mas sem ativacao",
        "policy_has_pending_governance_request": "Publicacao/arquivamento em aprovacao",
        "active_effective_policy_conflict": "Conflito de politicas ativas",
        "policy_not_operationally_configured": "Estrutura incompleta",
        "invalid_effective_weight": "Peso efetivo invalido",
        "policy_not_found": "Nao vinculada ao Motor",
        "not_selected_by_effective_policy": "Nao vinculada ao Motor",
        "policy_not_active": "Nao vinculada ao Motor",
        "policy_not_effective": "Fora da vigencia",
    }
    return labels.get(reason or "", "Nao vinculada ao Motor")


def get_effective_credit_policy(
    db: Session,
    *,
    company_id: int | None = None,
    analysis_date: datetime | None = None,
) -> EffectiveCreditPolicyResolution:
    del company_id
    effective_at = analysis_date or datetime.now(timezone.utc)
    active_policies = list(
        db.scalars(
            select(CreditDecisionPolicy)
            .where(CreditDecisionPolicy.status == "active")
            .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
        ).all()
    )
    effective_policies = [policy for policy in active_policies if _is_effective(policy, effective_at)]
    published_effective_policies = [policy for policy in effective_policies if is_policy_published(policy)]
    candidates = [_policy_candidate(policy) for policy in published_effective_policies]

    if not effective_policies:
        return EffectiveCreditPolicyResolution(
            policy=None,
            policy_id=None,
            version=None,
            status=None,
            effective_from=None,
            effective_to=None,
            published=False,
            valid=False,
            conflict=False,
            reason="policy_not_found",
            candidates=[],
            validation=None,
            publication_event=None,
        )

    if len(published_effective_policies) > 1:
        return EffectiveCreditPolicyResolution(
            policy=None,
            policy_id=None,
            version=None,
            status="active",
            effective_from=None,
            effective_to=None,
            published=False,
            valid=False,
            conflict=True,
            reason="active_effective_policy_conflict",
            candidates=candidates,
            validation=None,
            publication_event=None,
        )

    from app.services.credit_decision_policy_score_structure import validate_score_structure

    policy = published_effective_policies[0] if published_effective_policies else effective_policies[0]
    publication_event = _policy_publication_record(policy)
    published = is_policy_published(policy)
    validation = validate_score_structure(db, policy.id)
    pending_request = has_pending_publication_or_archive_request(db, policy.id)
    valid = (
        published
        and validation.get("status") != "invalid"
        and not validation.get("errors")
        and Decimal(str(validation.get("effective_pillars_weight", "0"))) > Decimal("0")
        and not pending_request
    )
    reason = None
    if policy.activated_at is None:
        reason = "policy_not_activated"
    elif not published:
        reason = "active_policy_without_governed_publication"
    elif pending_request:
        reason = "policy_has_pending_governance_request"
    elif validation.get("status") == "invalid" or validation.get("errors"):
        reason = "policy_not_operationally_configured"
    elif Decimal(str(validation.get("effective_pillars_weight", "0"))) <= Decimal("0"):
        reason = "invalid_effective_weight"

    return EffectiveCreditPolicyResolution(
        policy=policy,
        policy_id=policy.id,
        version=policy.version,
        status=policy.status,
        effective_from=policy.effective_from,
        effective_to=policy.effective_to,
        published=published,
        valid=valid,
        conflict=False,
        reason=reason,
        candidates=candidates,
        validation=validation,
        publication_event=publication_event,
    )


def get_policy_motor_binding(
    db: Session,
    policy: CreditDecisionPolicy,
    *,
    company_id: int | None = None,
    analysis_date: datetime | None = None,
) -> PolicyMotorBindingResolution:
    resolution = get_effective_credit_policy(db, company_id=company_id, analysis_date=analysis_date)
    publication_event = _policy_publication_record(policy)
    published = is_policy_published(policy)
    if resolution.conflict:
        reason = resolution.reason or "active_effective_policy_conflict"
        return PolicyMotorBindingResolution(
            policy_id=policy.id,
            is_bound=False,
            reason=reason,
            label=_binding_label(reason, bound=False),
            published=published,
            valid=False,
            conflict=True,
            selected_policy_id=None,
            selected_policy_version=None,
            publication_event=publication_event,
            candidates=resolution.candidates,
        )

    if resolution.policy_id != policy.id:
        reason = "not_selected_by_effective_policy"
        if policy.status != "active":
            reason = "policy_not_active"
        elif not _is_effective(policy, analysis_date or datetime.now(timezone.utc)):
            reason = "policy_not_effective"
        return PolicyMotorBindingResolution(
            policy_id=policy.id,
            is_bound=False,
            reason=reason,
            label=_binding_label(reason, bound=False),
            published=published,
            valid=False,
            conflict=False,
            selected_policy_id=resolution.policy_id,
            selected_policy_version=resolution.version,
            publication_event=publication_event,
            candidates=resolution.candidates,
        )

    return PolicyMotorBindingResolution(
        policy_id=policy.id,
        is_bound=resolution.valid,
        reason=resolution.reason,
        label=_binding_label(resolution.reason, bound=resolution.valid),
        published=resolution.published,
        valid=resolution.valid,
        conflict=resolution.conflict,
        selected_policy_id=resolution.policy_id,
        selected_policy_version=resolution.version,
        publication_event=resolution.publication_event,
        candidates=resolution.candidates,
    )
