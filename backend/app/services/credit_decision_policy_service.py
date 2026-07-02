from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.effective_credit_policy import get_effective_credit_policy

from app.models.audit_log import AuditLog
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.services.credit_decision_policy_score_seed import ensure_default_score_structure

REQUIRED_SCENARIO = "existing_customer_with_coface"
REQUIRED_RULE_CODES = {
    "coface_equals_current_limit",
    "coface_below_current_limit",
    "requested_above_coface",
    "requested_within_coface",
}
REQUIRED_RULE_FIELDS = {"code", "condition", "recommendation_code", "recommended_limit_source", "label"}


DEFAULT_COFACE_FIRST_DECISION_POLICY_CONFIG: dict[str, Any] = {
    "decision_scenarios": {
        "existing_customer_with_coface": {
            "enabled": True,
            "requires_financial_calculation": False,
            "rules": [
                {
                    "code": "coface_equals_current_limit",
                    "condition": "coface_limit == current_limit",
                    "recommendation_code": "maintain_current_limit",
                    "recommended_limit_source": "current_limit",
                    "label": "Manutencao do Limite Atual",
                },
                {
                    "code": "coface_below_current_limit",
                    "condition": "coface_limit < current_limit",
                    "recommendation_code": "reduce_to_coface_limit",
                    "recommended_limit_source": "coface_limit",
                    "label": "Reducao de Limite devido Exposicao com a COFACE",
                },
                {
                    "code": "requested_above_coface",
                    "condition": "coface_limit > current_limit && requested_limit > coface_limit",
                    "recommendation_code": "increase_to_coface_limit",
                    "recommended_limit_source": "coface_limit",
                    "label": "Aumento do Limite conforme Cobertura da COFACE",
                },
                {
                    "code": "requested_within_coface",
                    "condition": "coface_limit > current_limit && requested_limit <= coface_limit",
                    "recommendation_code": "approve_requested_with_coface",
                    "recommended_limit_source": "requested_limit",
                    "label": "Aprovacao do Limite Solicitado conforme Cobertura da COFACE",
                },
            ],
        }
    },
    "pillar_weights": {
        "financial_stability_liquidity": 55,
        "guarantees_credit_insurance": 20,
        "market_conditions": 15,
        "payment_history": 5,
        "relationship_history": 5,
    },
}


class CreditDecisionPolicyServiceError(Exception):
    pass


class CreditDecisionPolicyNotFoundError(CreditDecisionPolicyServiceError):
    pass


class CreditDecisionPolicyValidationError(CreditDecisionPolicyServiceError):
    pass


class CreditDecisionPolicyDraftExistsError(CreditDecisionPolicyValidationError):
    def __init__(self, existing_policy_id: int):
        super().__init__(
            "Ja existe uma versao em rascunho para esta politica. Continue editando a versao existente ou arquive-a antes de criar outra."
        )
        self.existing_policy_id = existing_policy_id


SCORE_RANGE_OPERATORS = {">=", ">", "<=", "<", "=", "between"}


def _validate_config_json(config_json: dict[str, Any]) -> None:
    scenarios = config_json.get("decision_scenarios")
    if not isinstance(scenarios, dict):
        raise CreditDecisionPolicyValidationError("config_json must include 'decision_scenarios'.")

    pillar_weights = config_json.get("pillar_weights")
    if not isinstance(pillar_weights, dict):
        raise CreditDecisionPolicyValidationError("config_json must include 'pillar_weights'.")

    weights_sum = sum(int(value) for value in pillar_weights.values())
    if weights_sum != 100:
        raise CreditDecisionPolicyValidationError("pillar_weights total must be 100.")

    required_scenario = scenarios.get(REQUIRED_SCENARIO)
    if not isinstance(required_scenario, dict):
        raise CreditDecisionPolicyValidationError(
            f"decision_scenarios must include '{REQUIRED_SCENARIO}'."
        )

    rules = required_scenario.get("rules")
    if not isinstance(rules, list):
        raise CreditDecisionPolicyValidationError(f"scenario '{REQUIRED_SCENARIO}' must include a rules list.")

    indexed_rules: dict[str, dict[str, Any]] = {}
    for rule in rules:
        if not isinstance(rule, dict):
            raise CreditDecisionPolicyValidationError("Each scenario rule must be an object.")
        missing = [field for field in REQUIRED_RULE_FIELDS if field not in rule or rule.get(field) in (None, "")]
        if missing:
            raise CreditDecisionPolicyValidationError(
                f"Rule is missing required fields: {', '.join(sorted(missing))}."
            )
        indexed_rules[str(rule["code"])] = rule

    missing_rule_codes = sorted(REQUIRED_RULE_CODES - set(indexed_rules.keys()))
    if missing_rule_codes:
        raise CreditDecisionPolicyValidationError(
            f"Scenario '{REQUIRED_SCENARIO}' is missing required rules: {', '.join(missing_rule_codes)}."
        )


def get_active_credit_decision_policy(db: Session) -> CreditDecisionPolicy:
    resolution = get_effective_credit_policy(db)
    if resolution.conflict:
        ids = ", ".join(str(item["policy_id"]) for item in resolution.candidates)
        raise CreditDecisionPolicyNotFoundError(
            f"Conflito de politicas ativas/vigentes: {ids}."
        )
    if resolution.policy is None:
        raise CreditDecisionPolicyNotFoundError("No active credit decision policy found.")
    return resolution.policy


def list_credit_decision_policies(db: Session) -> list[CreditDecisionPolicy]:
    return list(
        db.scalars(select(CreditDecisionPolicy).order_by(CreditDecisionPolicy.created_at.desc(), CreditDecisionPolicy.id.desc())).all()
    )


def get_credit_decision_policy(db: Session, policy_id: int) -> CreditDecisionPolicy:
    policy = db.get(CreditDecisionPolicy, policy_id)
    if policy is None:
        raise CreditDecisionPolicyNotFoundError("Credit decision policy not found.")
    return policy


def _next_version_for_code(db: Session, code: str) -> int:
    last = db.scalar(
        select(CreditDecisionPolicy)
        .where(CreditDecisionPolicy.code == code)
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if last is None:
        return 1
    return int(last.version) + 1


def create_credit_decision_policy(
    db: Session,
    payload: Any,
    current_user: User,
) -> CreditDecisionPolicy:
    _validate_config_json(payload.config_json)

    policy = CreditDecisionPolicy(
        code=payload.code.strip(),
        name=payload.name.strip(),
        version=_next_version_for_code(db, payload.code.strip()),
        status="draft",
        description=payload.description,
        config_json=payload.config_json,
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.add(policy)
    db.flush()
    return policy


def _decimal(value: Any, *, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CreditDecisionPolicyValidationError(f"{field_name} must be numeric.") from exc


def _validate_decimal_bounds(value: Any, *, field_name: str, minimum: Decimal, maximum: Decimal) -> Decimal:
    decimal_value = _decimal(value, field_name=field_name)
    if decimal_value < minimum or decimal_value > maximum:
        raise CreditDecisionPolicyValidationError(f"{field_name} must be between {minimum} and {maximum}.")
    return decimal_value


def _ensure_draft_policy(policy: CreditDecisionPolicy) -> None:
    if policy.status != "draft":
        raise CreditDecisionPolicyValidationError("Only draft credit decision policies can be edited.")


def _load_policy_child(db: Session, model: type[Any], *, policy_id: int, item_id: int, label: str) -> Any:
    item = db.scalar(select(model).where(model.id == item_id, model.policy_id == policy_id))
    if item is None:
        raise CreditDecisionPolicyNotFoundError(f"{label} not found for this policy.")
    return item


def _validate_score_range_values(score_range: CreditDecisionPolicyScoreRange) -> None:
    if score_range.operator not in SCORE_RANGE_OPERATORS:
        raise CreditDecisionPolicyValidationError("score range operator is invalid.")
    _validate_decimal_bounds(score_range.score, field_name="score", minimum=Decimal("0"), maximum=Decimal("10"))
    if score_range.operator == "between":
        if score_range.threshold_value_to is None:
            raise CreditDecisionPolicyValidationError("between score range requires threshold_value_to.")
        if _decimal(score_range.threshold_value_to, field_name="threshold_value_to") < _decimal(
            score_range.threshold_value,
            field_name="threshold_value",
        ):
            raise CreditDecisionPolicyValidationError("threshold_value_to must be greater than or equal to threshold_value.")
    elif score_range.threshold_value_to is not None:
        raise CreditDecisionPolicyValidationError("threshold_value_to must be empty when operator is not between.")


def update_credit_decision_policy_score_structure(
    db: Session,
    policy_id: int,
    payload: Any,
    current_user: User,
) -> CreditDecisionPolicy:
    policy = get_credit_decision_policy(db, policy_id)
    _ensure_draft_policy(policy)

    changes: dict[str, list[dict[str, Any]]] = {
        "pillars": [],
        "subgroups": [],
        "indicators": [],
        "score_ranges": [],
    }

    for patch in payload.pillars:
        pillar = _load_policy_child(db, CreditDecisionPolicyPillar, policy_id=policy.id, item_id=patch.id, label="Pillar")
        if patch.weight_percent is not None:
            pillar.weight_percent = _validate_decimal_bounds(
                patch.weight_percent,
                field_name="pillar weight_percent",
                minimum=Decimal("0"),
                maximum=Decimal("100"),
            )
        if patch.is_enabled is not None:
            pillar.is_enabled = patch.is_enabled
        changes["pillars"].append({"id": pillar.id, "code": pillar.code})

    for patch in payload.subgroups:
        subgroup = _load_policy_child(db, CreditDecisionPolicySubgroup, policy_id=policy.id, item_id=patch.id, label="Subgroup")
        if patch.weight_percent is not None:
            subgroup.weight_percent = _validate_decimal_bounds(
                patch.weight_percent,
                field_name="subgroup weight_percent",
                minimum=Decimal("0"),
                maximum=Decimal("100"),
            )
        if patch.is_enabled is not None:
            subgroup.is_enabled = patch.is_enabled
        changes["subgroups"].append({"id": subgroup.id, "code": subgroup.code})

    for patch in payload.indicators:
        indicator = _load_policy_child(db, CreditDecisionPolicyIndicator, policy_id=policy.id, item_id=patch.id, label="Indicator")
        if patch.weight_percent is not None:
            indicator.weight_percent = _validate_decimal_bounds(
                patch.weight_percent,
                field_name="indicator weight_percent",
                minimum=Decimal("0"),
                maximum=Decimal("100"),
            )
        if patch.is_enabled is not None:
            indicator.is_enabled = patch.is_enabled
        changes["indicators"].append({"id": indicator.id, "code": indicator.code})

    for patch in payload.score_ranges:
        score_range = _load_policy_child(db, CreditDecisionPolicyScoreRange, policy_id=policy.id, item_id=patch.id, label="Score range")
        if patch.operator is not None:
            score_range.operator = patch.operator
        if patch.threshold_value is not None:
            score_range.threshold_value = _decimal(patch.threshold_value, field_name="threshold_value")
        if "threshold_value_to" in patch.model_fields_set:
            score_range.threshold_value_to = (
                None if patch.threshold_value_to is None else _decimal(patch.threshold_value_to, field_name="threshold_value_to")
            )
        if patch.score is not None:
            score_range.score = _validate_decimal_bounds(
                patch.score,
                field_name="score",
                minimum=Decimal("0"),
                maximum=Decimal("10"),
            )
        if "label" in patch.model_fields_set:
            score_range.label = patch.label
        if patch.sort_order is not None:
            score_range.sort_order = patch.sort_order
        if patch.is_enabled is not None:
            score_range.is_enabled = patch.is_enabled
        _validate_score_range_values(score_range)
        changes["score_ranges"].append({"id": score_range.id, "indicator_id": score_range.indicator_id})

    policy.updated_by_user_id = current_user.id
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="policy_draft_updated",
            resource="credit_decision_policy",
            resource_id=str(policy.id),
            metadata_json={
                "policy_id": policy.id,
                "policy_version": policy.version,
                "updated_by": current_user.id,
                "changes": changes,
            },
        )
    )
    db.flush()
    return policy


def _clone_score_structure(db: Session, *, base_policy_id: int, new_policy_id: int) -> None:
    pillar_id_map: dict[int, int] = {}
    subgroup_id_map: dict[int, int] = {}
    indicator_id_map: dict[int, int] = {}

    base_pillars = list(
        db.scalars(
            select(CreditDecisionPolicyPillar)
            .where(CreditDecisionPolicyPillar.policy_id == base_policy_id)
            .order_by(CreditDecisionPolicyPillar.sort_order.asc(), CreditDecisionPolicyPillar.id.asc())
        ).all()
    )
    for base in base_pillars:
        cloned = CreditDecisionPolicyPillar(
            policy_id=new_policy_id,
            code=base.code,
            name=base.name,
            description=base.description,
            weight_percent=base.weight_percent,
            sort_order=base.sort_order,
            is_enabled=base.is_enabled,
        )
        db.add(cloned)
        db.flush()
        pillar_id_map[base.id] = cloned.id

    base_subgroups = list(
        db.scalars(
            select(CreditDecisionPolicySubgroup)
            .where(CreditDecisionPolicySubgroup.policy_id == base_policy_id)
            .order_by(CreditDecisionPolicySubgroup.sort_order.asc(), CreditDecisionPolicySubgroup.id.asc())
        ).all()
    )
    for base in base_subgroups:
        cloned = CreditDecisionPolicySubgroup(
            policy_id=new_policy_id,
            pillar_id=pillar_id_map[base.pillar_id],
            code=base.code,
            name=base.name,
            description=base.description,
            weight_percent=base.weight_percent,
            sort_order=base.sort_order,
            is_enabled=base.is_enabled,
        )
        db.add(cloned)
        db.flush()
        subgroup_id_map[base.id] = cloned.id

    base_indicators = list(
        db.scalars(
            select(CreditDecisionPolicyIndicator)
            .where(CreditDecisionPolicyIndicator.policy_id == base_policy_id)
            .order_by(CreditDecisionPolicyIndicator.sort_order.asc(), CreditDecisionPolicyIndicator.id.asc())
        ).all()
    )
    for base in base_indicators:
        cloned = CreditDecisionPolicyIndicator(
            policy_id=new_policy_id,
            subgroup_id=subgroup_id_map[base.subgroup_id],
            code=base.code,
            name=base.name,
            description=base.description,
            source_key=base.source_key,
            value_type=base.value_type,
            weight_percent=base.weight_percent,
            aggregation_method=base.aggregation_method,
            missing_data_behavior=base.missing_data_behavior,
            sort_order=base.sort_order,
            is_enabled=base.is_enabled,
        )
        db.add(cloned)
        db.flush()
        indicator_id_map[base.id] = cloned.id

    base_ranges = list(
        db.scalars(
            select(CreditDecisionPolicyScoreRange)
            .where(CreditDecisionPolicyScoreRange.policy_id == base_policy_id)
            .order_by(CreditDecisionPolicyScoreRange.sort_order.asc(), CreditDecisionPolicyScoreRange.id.asc())
        ).all()
    )
    for base in base_ranges:
        db.add(
            CreditDecisionPolicyScoreRange(
                policy_id=new_policy_id,
                indicator_id=indicator_id_map[base.indicator_id],
                operator=base.operator,
                threshold_value=base.threshold_value,
                threshold_value_to=base.threshold_value_to,
                score=base.score,
                label=base.label,
                sort_order=base.sort_order,
                is_enabled=base.is_enabled,
            )
        )


def create_credit_decision_policy_version(
    db: Session,
    base_policy_id: int,
    current_user: User,
    *,
    justification: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> CreditDecisionPolicy:
    base_policy = get_credit_decision_policy(db, base_policy_id)
    existing_draft = db.scalar(
        select(CreditDecisionPolicy)
        .where(
            CreditDecisionPolicy.code == base_policy.code,
            CreditDecisionPolicy.status == "draft",
        )
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if existing_draft is not None:
        raise CreditDecisionPolicyDraftExistsError(existing_draft.id)

    new_policy = CreditDecisionPolicy(
        code=base_policy.code,
        name=base_policy.name,
        version=_next_version_for_code(db, base_policy.code),
        status="draft",
        description=base_policy.description,
        base_policy_id=base_policy.id,
        config_json=deepcopy(base_policy.config_json),
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.add(new_policy)
    db.flush()

    _clone_score_structure(db, base_policy_id=base_policy.id, new_policy_id=new_policy.id)
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="policy_version_created",
            resource="credit_decision_policy",
            resource_id=str(new_policy.id),
            metadata_json={
                "base_policy_id": base_policy.id,
                "base_policy_version": base_policy.version,
                "new_policy_id": new_policy.id,
                "new_policy_version": new_policy.version,
                "created_by": current_user.id,
                "metadata_json": metadata_json or {},
            },
            notes=justification,
        )
    )
    db.flush()
    return new_policy


def activate_credit_decision_policy(db: Session, policy_id: int, current_user: User) -> CreditDecisionPolicy:
    target = get_credit_decision_policy(db, policy_id)
    if target.status == "archived":
        raise CreditDecisionPolicyValidationError("Archived policy cannot be activated.")

    if target.status != "active":
        _validate_config_json(target.config_json)
        previous_active_policies = db.scalars(
            select(CreditDecisionPolicy)
            .where(
                CreditDecisionPolicy.status == "active",
                CreditDecisionPolicy.id != target.id,
            )
            .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
        ).all()
        for previous_active in previous_active_policies:
            previous_active.status = "archived"
            previous_active.effective_to = datetime.now(timezone.utc)
            previous_active.updated_by_user_id = current_user.id

        target.status = "active"
        target.effective_from = datetime.now(timezone.utc)
        target.effective_to = None
        target.activated_at = datetime.now(timezone.utc)
        target.activated_by_user_id = current_user.id
        target.updated_by_user_id = current_user.id
        db.flush()

    return target


def archive_credit_decision_policy(db: Session, policy_id: int, current_user: User) -> CreditDecisionPolicy:
    target = get_credit_decision_policy(db, policy_id)
    if target.status == "archived":
        return target

    target.status = "archived"
    target.effective_to = datetime.now(timezone.utc)
    target.updated_by_user_id = current_user.id
    return target


def _has_governance_request_for_policy(db: Session, policy_id: int) -> bool:
    return db.scalar(
        select(CreditDecisionPolicyGovernanceRequest.id)
        .where(
            CreditDecisionPolicyGovernanceRequest.policy_id == policy_id,
            CreditDecisionPolicyGovernanceRequest.status.in_(("pending", "approved")),
        )
        .limit(1)
    ) is not None


def _has_analysis_policy_snapshot(db: Session, policy_id: int) -> bool:
    rows = db.scalars(select(CreditAnalysis.decision_memory_json).where(CreditAnalysis.decision_memory_json.is_not(None))).all()
    for memory in rows:
        if not isinstance(memory, dict):
            continue
        snapshot = memory.get("policy_snapshot")
        if isinstance(snapshot, dict) and snapshot.get("policy_id") == policy_id:
            return True
    return False


def delete_credit_decision_policy_draft(db: Session, policy_id: int, current_user: User) -> None:
    target = get_credit_decision_policy(db, policy_id)
    if target.status != "draft":
        raise CreditDecisionPolicyValidationError("Somente versÃµes em rascunho podem ser excluÃ­das.")
    if _has_governance_request_for_policy(db, target.id):
        raise CreditDecisionPolicyValidationError("NÃ£o Ã© possÃ­vel excluir rascunho com solicitaÃ§Ã£o de governanÃ§a em andamento.")
    if _has_analysis_policy_snapshot(db, target.id):
        raise CreditDecisionPolicyValidationError("NÃ£o Ã© possÃ­vel excluir rascunho utilizado por snapshot de anÃ¡lise.")

    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="policy_draft_deleted",
            resource="credit_decision_policy",
            resource_id=str(target.id),
            metadata_json={
                "policy_id": target.id,
                "policy_code": target.code,
                "policy_version": target.version,
                "base_policy_id": target.base_policy_id,
            },
        )
    )
    db.delete(target)
    db.flush()




def _archive_dev_versioning_policy_conflicts(db: Session) -> None:
    now = datetime.now(timezone.utc)
    dev_policies = list(
        db.scalars(
            select(CreditDecisionPolicy).where(
                CreditDecisionPolicy.status == "active",
                CreditDecisionPolicy.publication_status == "UNPUBLISHED",
                CreditDecisionPolicy.code.like("versioning_%"),
            )
        ).all()
    )
    for policy in dev_policies:
        policy.status = "archived"
        policy.effective_to = policy.effective_to or now

def _ensure_seed_policy_governed_publication(db: Session, policy: CreditDecisionPolicy) -> None:
    if policy.code != "coface_first" or policy.status != "active" or policy.effective_to is not None:
        return
    if getattr(policy, "publication_status", "UNPUBLISHED") == "PUBLISHED":
        return

    from app.models.credit_decision_policy_governance_request_approval import (
        CreditDecisionPolicyGovernanceRequestApproval,
    )
    from app.models.workflow_role import WorkflowRole
    from app.services.credit_decision_policy_publication import execute_policy_publication

    seed_user = db.scalar(select(User).where(User.is_active.is_(True)).order_by(User.id.asc()))
    if seed_user is None:
        return
    approver_role = db.scalar(select(WorkflowRole).where(WorkflowRole.code == "HEAD_FINANCE", WorkflowRole.is_active.is_(True)))
    if approver_role is None:
        return

    request = None
    if policy.governance_request_id is not None:
        request = db.get(CreditDecisionPolicyGovernanceRequest, policy.governance_request_id)
    if request is None or request.action_type != "policy_publish" or request.status != "approved":
        request = CreditDecisionPolicyGovernanceRequest(
            company_id=seed_user.company_id,
            policy_id=policy.id,
            action_type="policy_publish",
            approval_item_type="CREDIT_POLICY",
            requested_by_user_id=seed_user.id,
            status="approved",
            justification="Publicacao governada automatica da politica seed em ambiente dev.",
            metadata_json={"source": "credit_decision_policy_seed", "dev_publication": True},
            approved_at=datetime.now(timezone.utc),
        )
        db.add(request)
        db.flush()
        db.add(
            CreditDecisionPolicyGovernanceRequestApproval(
                request_id=request.id,
                workflow_role_id=approver_role.id,
                approved_by_user_id=seed_user.id,
                decision="approved",
                justification="Aprovacao seed/dev para politica padrao.",
                decided_at=datetime.now(timezone.utc),
            )
        )
        db.flush()

    execute_policy_publication(
        db,
        company_id=seed_user.company_id,
        policy_id=policy.id,
        request_id=request.id,
        current_user=seed_user,
    )

def ensure_active_credit_decision_policy_seed(db: Session) -> CreditDecisionPolicy:
    _archive_dev_versioning_policy_conflicts(db)
    active = db.scalar(
        select(CreditDecisionPolicy)
        .where(CreditDecisionPolicy.code == "coface_first", CreditDecisionPolicy.status == "active")
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if active is not None:
        ensure_default_score_structure(db, active)
        _ensure_seed_policy_governed_publication(db, active)
        return active

    policy = CreditDecisionPolicy(
        code="coface_first",
        name="Politica Padrao COFACE-first",
        version=_next_version_for_code(db, "coface_first"),
        status="active",
        description="Politica default para fundacao configuravel COFACE-first.",
        config_json=DEFAULT_COFACE_FIRST_DECISION_POLICY_CONFIG,
        effective_from=datetime.now(timezone.utc),
        activated_at=datetime.now(timezone.utc),
    )
    db.add(policy)
    db.flush()
    ensure_default_score_structure(db, policy)
    _ensure_seed_policy_governed_publication(db, policy)
    return policy



