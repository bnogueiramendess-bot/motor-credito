from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.core.security import CurrentUser
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_governance_request_approval import (
    CreditDecisionPolicyGovernanceRequestApproval,
)
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.services.credit_decision_policy_governance_workflow import (
    PolicyGovernanceWorkflowForbiddenError,
    PolicyGovernanceWorkflowNotFoundError,
    can_user_decide_governance_request,
    get_governance_request_model,
)

APPROVAL_ITEM_TYPE_CREDIT_POLICY = "CREDIT_POLICY"

ACTION_LABELS = {
    "policy_create": "Criacao",
    "policy_edit": "Edicao",
    "policy_publish": "Publicacao",
    "policy_archive": "Arquivamento",
}

PILLAR_LABELS = {
    "financial_stability_liquidity": "Estabilidade Financeira e Liquidez",
    "guarantees_credit_insurance": "Garantias / Seguro de Credito",
    "market_conditions": "Condicoes de Mercado",
    "payment_history": "Historico de Pagamento",
    "relationship_history": "Historico de Relacionamento",
}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _format_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _format_percent(value: Any) -> str:
    if isinstance(value, Decimal):
        normalized = value.normalize()
        text = format(normalized, "f")
    else:
        text = str(value)
    return f"{text}%"


def _policy_to_dict(policy: CreditDecisionPolicy | None, *, company_id: int) -> dict[str, Any] | None:
    if policy is None:
        return None
    return {
        "id": policy.id,
        "code": policy.code,
        "name": policy.name,
        "version": policy.version,
        "status": policy.status,
        "company_id": company_id,
        "description": policy.description,
        "effective_from": policy.effective_from,
        "effective_to": policy.effective_to,
        "activated_at": policy.activated_at,
    }


def _requester_to_dict(user: User | None, user_id: int | None) -> dict[str, Any] | None:
    if user is None:
        if user_id is None:
            return None
        return {"id": user_id, "name": None, "email": None}
    return {"id": user.id, "name": user.full_name, "email": user.email}


def _load_requester(db: Session, request: CreditDecisionPolicyGovernanceRequest) -> User | None:
    if request.requested_by_user_id is None:
        return None
    return db.get(User, request.requested_by_user_id)


def _load_policy(db: Session, policy_id: int | None) -> CreditDecisionPolicy | None:
    if policy_id is None:
        return None
    return db.get(CreditDecisionPolicy, policy_id)


def _load_normalized_structure(db: Session, policy_id: int) -> tuple[list[CreditDecisionPolicyPillar], list[str]]:
    warnings: list[str] = []
    try:
        pillars = list(
            db.scalars(
                select(CreditDecisionPolicyPillar)
                .options(
                    selectinload(CreditDecisionPolicyPillar.subgroups)
                    .selectinload(CreditDecisionPolicySubgroup.indicators)
                    .selectinload(CreditDecisionPolicyIndicator.score_ranges)
                )
                .where(CreditDecisionPolicyPillar.policy_id == policy_id)
                .order_by(CreditDecisionPolicyPillar.sort_order.asc(), CreditDecisionPolicyPillar.id.asc())
            ).all()
        )
    except SQLAlchemyError:
        warnings.append("Nao foi possivel carregar a estrutura normalizada de score da politica.")
        return [], warnings
    return pillars, warnings


def _structure_to_snapshot(pillars: list[CreditDecisionPolicyPillar]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for pillar in pillars:
        enabled_subgroups = [item for item in pillar.subgroups if item.is_enabled]
        enabled_indicators = [
            indicator
            for subgroup in enabled_subgroups
            for indicator in subgroup.indicators
            if indicator.is_enabled
        ]
        result.append(
            {
                "code": pillar.code,
                "name": pillar.name,
                "weight": float(pillar.weight_percent),
                "status": "configured" if pillar.is_enabled else "disabled",
                "subgroups_count": len(enabled_subgroups),
                "indicators_count": len(enabled_indicators),
            }
        )
    return result


def _config_pillar_snapshot(config_json: dict[str, Any]) -> list[dict[str, Any]]:
    pillar_weights = _as_dict(config_json.get("pillar_weights"))
    return [
        {
            "code": str(code),
            "name": PILLAR_LABELS.get(str(code), str(code)),
            "weight": weight,
            "status": "configured",
            "subgroups_count": 0,
            "indicators_count": 0,
        }
        for code, weight in sorted(pillar_weights.items())
    ]


def build_policy_snapshot_summary(
    db: Session,
    policy: CreditDecisionPolicy | None,
) -> dict[str, Any]:
    if policy is None:
        return {
            "pillars": [],
            "total_weight": 0,
            "configured_pillars": 0,
            "planned_pillars": 0,
            "warnings": ["Politica alvo nao informada ou nao localizada."],
        }

    warnings: list[str] = []
    pillars, structure_warnings = _load_normalized_structure(db, policy.id)
    warnings.extend(structure_warnings)
    pillar_items = _structure_to_snapshot(pillars)
    if not pillar_items:
        config_json = _as_dict(policy.config_json)
        pillar_items = _config_pillar_snapshot(config_json)
        if not pillar_items:
            warnings.append("Politica sem pilares configurados em config_json ou estrutura normalizada.")

    total_weight = sum(float(item.get("weight") or 0) for item in pillar_items)
    configured = len([item for item in pillar_items if item.get("status") == "configured"])
    expected = max(configured, 5 if configured else 0)
    return {
        "pillars": pillar_items,
        "total_weight": total_weight,
        "configured_pillars": configured,
        "planned_pillars": max(expected - configured, 0),
        "warnings": warnings,
    }


def _pillar_index(db: Session, policy: CreditDecisionPolicy | None) -> tuple[dict[str, dict[str, Any]], list[str]]:
    if policy is None:
        return {}, []
    warnings: list[str] = []
    pillars, structure_warnings = _load_normalized_structure(db, policy.id)
    warnings.extend(structure_warnings)
    if pillars:
        return {
            item.code: {
                "code": item.code,
                "name": item.name,
                "weight": item.weight_percent,
            }
            for item in pillars
            if item.is_enabled
        }, warnings
    config_json = _as_dict(policy.config_json)
    pillar_weights = _as_dict(config_json.get("pillar_weights"))
    return {
        str(code): {
            "code": str(code),
            "name": PILLAR_LABELS.get(str(code), str(code)),
            "weight": weight,
        }
        for code, weight in pillar_weights.items()
    }, warnings


def _subgroup_codes(db: Session, policy: CreditDecisionPolicy | None) -> tuple[set[str], list[str]]:
    if policy is None:
        return set(), []
    try:
        items = db.scalars(
            select(CreditDecisionPolicySubgroup.code).where(
                CreditDecisionPolicySubgroup.policy_id == policy.id,
                CreditDecisionPolicySubgroup.is_enabled.is_(True),
            )
        ).all()
    except SQLAlchemyError:
        return set(), ["Nao foi possivel comparar subgrupos da estrutura normalizada."]
    return {str(item) for item in items}, []


def _indicator_codes(db: Session, policy: CreditDecisionPolicy | None) -> tuple[set[str], list[str]]:
    if policy is None:
        return set(), []
    try:
        items = db.scalars(
            select(CreditDecisionPolicyIndicator.code).where(
                CreditDecisionPolicyIndicator.policy_id == policy.id,
                CreditDecisionPolicyIndicator.is_enabled.is_(True),
            )
        ).all()
    except SQLAlchemyError:
        return set(), ["Nao foi possivel comparar indicadores da estrutura normalizada."]
    return {str(item) for item in items}, []


def _score_range_signature(db: Session, policy: CreditDecisionPolicy | None) -> tuple[set[tuple[Any, ...]], list[str]]:
    if policy is None:
        return set(), []
    try:
        rows = db.execute(
            select(
                CreditDecisionPolicyIndicator.code,
                CreditDecisionPolicyScoreRange.operator,
                CreditDecisionPolicyScoreRange.threshold_value,
                CreditDecisionPolicyScoreRange.threshold_value_to,
                CreditDecisionPolicyScoreRange.score,
            )
            .join(CreditDecisionPolicyIndicator, CreditDecisionPolicyIndicator.id == CreditDecisionPolicyScoreRange.indicator_id)
            .where(
                CreditDecisionPolicyScoreRange.policy_id == policy.id,
                CreditDecisionPolicyScoreRange.is_enabled.is_(True),
            )
        ).all()
    except SQLAlchemyError:
        return set(), ["Nao foi possivel comparar faixas de score da estrutura normalizada."]
    return {tuple(row) for row in rows}, []


def _add_field_change(
    changes: list[dict[str, Any]],
    *,
    area: str,
    label: str,
    before: Any,
    after: Any,
    change_type: str,
    severity: str,
) -> None:
    if before != after:
        changes.append(
            {
                "change_type": change_type,
                "area": area,
                "label": label,
                "before": before,
                "after": after,
                "severity": severity,
            }
        )


def compare_policy_versions(
    db: Session,
    *,
    base_policy: CreditDecisionPolicy | None,
    target_policy: CreditDecisionPolicy | None,
) -> dict[str, Any]:
    warnings: list[str] = []
    changes: list[dict[str, Any]] = []
    if base_policy is None or target_policy is None:
        return {
            "has_comparison": False,
            "base_policy_id": base_policy.id if base_policy is not None else None,
            "target_policy_id": target_policy.id if target_policy is not None else None,
            "summary": [],
            "critical_changes": [],
            "warnings": ["Nao foi possivel localizar versao base para comparacao."],
        }

    _add_field_change(
        changes,
        area="Politica",
        label="Codigo",
        before=base_policy.code,
        after=target_policy.code,
        change_type="code_changed",
        severity="low",
    )
    _add_field_change(
        changes,
        area="Politica",
        label="Nome",
        before=base_policy.name,
        after=target_policy.name,
        change_type="name_changed",
        severity="low",
    )
    _add_field_change(
        changes,
        area="Politica",
        label="Versao",
        before=base_policy.version,
        after=target_policy.version,
        change_type="version_changed",
        severity="low",
    )
    _add_field_change(
        changes,
        area="Politica",
        label="Status",
        before=base_policy.status,
        after=target_policy.status,
        change_type="status_changed",
        severity="high",
    )
    _add_field_change(
        changes,
        area="Politica",
        label="Vigencia inicial",
        before=_format_datetime(base_policy.effective_from),
        after=_format_datetime(target_policy.effective_from),
        change_type="effective_from_changed",
        severity="medium",
    )
    _add_field_change(
        changes,
        area="Politica",
        label="Vigencia final",
        before=_format_datetime(base_policy.effective_to),
        after=_format_datetime(target_policy.effective_to),
        change_type="effective_to_changed",
        severity="medium",
    )

    base_config = _as_dict(base_policy.config_json)
    target_config = _as_dict(target_policy.config_json)
    if base_config != target_config:
        changes.append(
            {
                "change_type": "config_changed",
                "area": "Configuracao",
                "label": "config_json",
                "before": "Configuracao anterior",
                "after": "Configuracao proposta",
                "severity": "medium",
            }
        )

    base_pillars, pillar_warnings = _pillar_index(db, base_policy)
    warnings.extend(pillar_warnings)
    target_pillars, pillar_warnings = _pillar_index(db, target_policy)
    warnings.extend(pillar_warnings)
    for code in sorted(set(base_pillars) | set(target_pillars)):
        before = base_pillars.get(code)
        after = target_pillars.get(code)
        label = (after or before or {}).get("name", code)
        if before is None:
            changes.append(
                {
                    "change_type": "pillar_added",
                    "area": "Pilar",
                    "label": label,
                    "before": None,
                    "after": _format_percent(after.get("weight")),
                    "severity": "medium",
                }
            )
        elif after is None:
            changes.append(
                {
                    "change_type": "pillar_removed",
                    "area": "Pilar",
                    "label": label,
                    "before": _format_percent(before.get("weight")),
                    "after": None,
                    "severity": "high",
                }
            )
        elif before.get("weight") != after.get("weight"):
            changes.append(
                {
                    "change_type": "weight_changed",
                    "area": "Pilar",
                    "label": label,
                    "before": _format_percent(before.get("weight")),
                    "after": _format_percent(after.get("weight")),
                    "severity": "high",
                }
            )

    base_subgroups, subgroup_warnings = _subgroup_codes(db, base_policy)
    warnings.extend(subgroup_warnings)
    target_subgroups, subgroup_warnings = _subgroup_codes(db, target_policy)
    warnings.extend(subgroup_warnings)
    if base_subgroups != target_subgroups:
        changes.append(
            {
                "change_type": "subgroups_changed",
                "area": "Subgrupo",
                "label": "Subgrupos de score",
                "before": sorted(base_subgroups),
                "after": sorted(target_subgroups),
                "severity": "medium",
            }
        )

    base_indicators, indicator_warnings = _indicator_codes(db, base_policy)
    warnings.extend(indicator_warnings)
    target_indicators, indicator_warnings = _indicator_codes(db, target_policy)
    warnings.extend(indicator_warnings)
    if base_indicators != target_indicators:
        changes.append(
            {
                "change_type": "indicators_changed",
                "area": "Indicador",
                "label": "Indicadores de score",
                "before": sorted(base_indicators),
                "after": sorted(target_indicators),
                "severity": "medium",
            }
        )

    base_ranges, score_warnings = _score_range_signature(db, base_policy)
    warnings.extend(score_warnings)
    target_ranges, score_warnings = _score_range_signature(db, target_policy)
    warnings.extend(score_warnings)
    if base_ranges != target_ranges:
        changes.append(
            {
                "change_type": "score_ranges_changed",
                "area": "Faixa de score",
                "label": "Faixas de score",
                "before": len(base_ranges),
                "after": len(target_ranges),
                "severity": "medium",
            }
        )

    return {
        "has_comparison": True,
        "base_policy_id": base_policy.id,
        "target_policy_id": target_policy.id,
        "summary": changes,
        "critical_changes": [item for item in changes if item.get("severity") == "high"],
        "warnings": sorted(set(warnings)),
    }


def _find_base_policy_from_metadata(db: Session, request: CreditDecisionPolicyGovernanceRequest) -> CreditDecisionPolicy | None:
    metadata = _as_dict(request.metadata_json)
    base_id = metadata.get("base_policy_id") or metadata.get("previous_policy_id")
    if base_id is None:
        return None
    try:
        return db.get(CreditDecisionPolicy, int(base_id))
    except (TypeError, ValueError):
        return None


def _find_latest_active_policy(
    db: Session,
    *,
    target_policy: CreditDecisionPolicy | None,
) -> CreditDecisionPolicy | None:
    if target_policy is None:
        return None
    return db.scalar(
        select(CreditDecisionPolicy)
        .where(
            CreditDecisionPolicy.code == target_policy.code,
            CreditDecisionPolicy.status == "active",
            CreditDecisionPolicy.id != target_policy.id,
        )
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )


def build_policy_change_summary(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    target_policy: CreditDecisionPolicy | None,
) -> dict[str, Any]:
    if request.action_type == "policy_create":
        return {
            "has_comparison": False,
            "base_policy_id": None,
            "target_policy_id": target_policy.id if target_policy is not None else None,
            "summary": [
                {
                    "change_type": "policy_created",
                    "area": "Politica",
                    "label": "Nova politica",
                    "before": None,
                    "after": target_policy.name if target_policy is not None else "Politica em criacao",
                    "severity": "medium",
                }
            ],
            "critical_changes": [],
            "warnings": [],
        }
    if request.action_type == "policy_edit":
        base_policy = _find_base_policy_from_metadata(db, request)
        if base_policy is None:
            return {
                "has_comparison": False,
                "base_policy_id": None,
                "target_policy_id": target_policy.id if target_policy is not None else None,
                "summary": [],
                "critical_changes": [],
                "warnings": ["Nao foi possivel localizar versao base para comparacao."],
            }
        return compare_policy_versions(db, base_policy=base_policy, target_policy=target_policy)
    if request.action_type == "policy_publish":
        base_policy = _find_latest_active_policy(db, target_policy=target_policy)
        if base_policy is None:
            return {
                "has_comparison": False,
                "base_policy_id": None,
                "target_policy_id": target_policy.id if target_policy is not None else None,
                "summary": [],
                "critical_changes": [],
                "warnings": ["Nao existe politica ativa anterior para comparacao."],
            }
        return compare_policy_versions(db, base_policy=base_policy, target_policy=target_policy)
    if request.action_type == "policy_archive":
        return {
            "has_comparison": False,
            "base_policy_id": target_policy.id if target_policy is not None else None,
            "target_policy_id": target_policy.id if target_policy is not None else None,
            "summary": [
                {
                    "change_type": "policy_archive_requested",
                    "area": "Governanca",
                    "label": "Arquivamento",
                    "before": target_policy.status if target_policy is not None else None,
                    "after": "archived",
                    "severity": "high",
                }
            ],
            "critical_changes": [],
            "warnings": [],
        }
    return {
        "has_comparison": False,
        "base_policy_id": None,
        "target_policy_id": target_policy.id if target_policy is not None else None,
        "summary": [],
        "critical_changes": [],
        "warnings": ["Acao de governanca sem comparacao implementada."],
    }


def _current_user_workflow_role_ids(db: Session, *, current_user: User) -> set[int]:
    return set(
        db.scalars(
            select(UserWorkflowRole.workflow_role_id).where(UserWorkflowRole.user_id == current_user.id)
        ).all()
    )


def _can_view_request(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    current: CurrentUser,
) -> bool:
    if current.user.company_id != request.company_id:
        return False
    if current.is_administrator or "credit.policy.manage" in current.permissions:
        return True
    if request.requested_by_user_id == current.user.id:
        return True
    user_role_ids = _current_user_workflow_role_ids(db, current_user=current.user)
    return any(approval.workflow_role_id in user_role_ids for approval in request.approvals)


def build_policy_approval_summary(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    current_user: User,
) -> dict[str, Any]:
    approvals = sorted(request.approvals, key=lambda item: item.workflow_role.code)
    decision_roles = sorted(
        item.workflow_role.code
        for item in can_user_decide_governance_request(db, request=request, current_user=current_user)
    )
    return {
        "required_roles": [item.workflow_role.code for item in approvals],
        "approved_roles": [item.workflow_role.code for item in approvals if item.decision == "approved"],
        "pending_roles": [item.workflow_role.code for item in approvals if item.decision is None],
        "rejected_roles": [item.workflow_role.code for item in approvals if item.decision == "rejected"],
        "can_current_user_decide": bool(decision_roles),
        "current_user_decision_roles": decision_roles,
        "approvals": [
            {
                "workflow_role_code": item.workflow_role.code,
                "decision": item.decision,
                "approved_by_user_id": item.approved_by_user_id,
                "justification": item.justification,
                "decided_at": item.decided_at,
            }
            for item in approvals
        ],
    }


def _executive_summary(request: CreditDecisionPolicyGovernanceRequest, policy: CreditDecisionPolicy | None) -> dict[str, Any]:
    policy_name = policy.name if policy is not None else "Politica de Credito"
    version = f" v{policy.version}" if policy is not None else ""
    action_label = ACTION_LABELS.get(request.action_type, request.action_type)
    impact_summary = [
        "Politica ainda nao esta conectada ao motor oficial.",
        "Publicacao exige aprovacao de governanca.",
        "Nao ha ativacao automatica sem request aprovado.",
    ]
    if request.action_type == "policy_create":
        impact_summary.append("Solicitacao representa criacao de nova politica.")
    if request.action_type == "policy_archive":
        impact_summary.append("Arquivamento remove a politica da lista ativa, mas nao altera decisoes ja registradas.")
    return {
        "title": f"{action_label} da {policy_name}{version}",
        "description": "Solicitacao de governanca de politica parametrizavel de credito.",
        "action_label": action_label,
        "risk_level": "high" if request.action_type == "policy_archive" else "medium",
        "impact_summary": impact_summary,
    }


def get_policy_governance_executive_summary(
    db: Session,
    *,
    company_id: int,
    request_id: int,
    current: CurrentUser,
) -> dict[str, Any]:
    request = get_governance_request_model(db, company_id=company_id, request_id=request_id)
    if request.approval_item_type != APPROVAL_ITEM_TYPE_CREDIT_POLICY:
        raise PolicyGovernanceWorkflowNotFoundError("Solicitacao de politica de credito nao encontrada.")
    if not _can_view_request(db, request=request, current=current):
        raise PolicyGovernanceWorkflowForbiddenError("Usuario sem permissao para visualizar esta solicitacao.")

    policy = _load_policy(db, request.policy_id)
    requester = _load_requester(db, request)
    snapshot = build_policy_snapshot_summary(db, policy)
    changes = build_policy_change_summary(db, request=request, target_policy=policy)
    if request.action_type == "policy_archive" and policy is not None and policy.status == "active":
        changes["warnings"] = sorted(set(changes.get("warnings", []) + ["Politica relacionada esta ativa."]))

    return {
        "request": {
            "id": request.id,
            "approval_item_type": request.approval_item_type,
            "action_type": request.action_type,
            "status": request.status,
            "requested_at": request.requested_at,
            "requested_by": _requester_to_dict(requester, request.requested_by_user_id),
            "justification": request.justification,
            "metadata_json": request.metadata_json,
        },
        "policy": _policy_to_dict(policy, company_id=request.company_id),
        "governance": build_policy_approval_summary(db, request=request, current_user=current.user),
        "executive_summary": _executive_summary(request, policy),
        "policy_snapshot": snapshot,
        "changes": changes,
    }
