from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.user import User

REQUIRED_SCENARIO = "existing_customer_with_coface"
REQUIRED_RULE_CODES = {
    "coface_equals_current_limit",
    "coface_below_current_limit",
    "requested_above_coface",
    "requested_within_coface",
}
REQUIRED_RULE_FIELDS = {"code", "condition", "recommendation_code", "recommended_limit_source", "label"}


class CreditDecisionPolicyServiceError(Exception):
    pass


class CreditDecisionPolicyNotFoundError(CreditDecisionPolicyServiceError):
    pass


class CreditDecisionPolicyValidationError(CreditDecisionPolicyServiceError):
    pass


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
    policy = db.scalar(
        select(CreditDecisionPolicy)
        .where(CreditDecisionPolicy.status == "active")
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if policy is None:
        raise CreditDecisionPolicyNotFoundError("No active credit decision policy found.")
    return policy


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


def activate_credit_decision_policy(db: Session, policy_id: int, current_user: User) -> CreditDecisionPolicy:
    target = get_credit_decision_policy(db, policy_id)
    if target.status == "archived":
        raise CreditDecisionPolicyValidationError("Archived policy cannot be activated.")

    if target.status != "active":
        _validate_config_json(target.config_json)
        previous_active = db.scalar(
            select(CreditDecisionPolicy)
            .where(
                CreditDecisionPolicy.status == "active",
                CreditDecisionPolicy.id != target.id,
            )
            .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
        )
        if previous_active is not None:
            previous_active.status = "archived"
            previous_active.effective_to = datetime.now(timezone.utc)
            previous_active.updated_by_user_id = current_user.id

        target.status = "active"
        target.effective_from = datetime.now(timezone.utc)
        target.effective_to = None
        target.activated_at = datetime.now(timezone.utc)
        target.activated_by_user_id = current_user.id
        target.updated_by_user_id = current_user.id

    return target


def archive_credit_decision_policy(db: Session, policy_id: int, current_user: User) -> CreditDecisionPolicy:
    target = get_credit_decision_policy(db, policy_id)
    if target.status == "archived":
        return target

    target.status = "archived"
    target.effective_to = datetime.now(timezone.utc)
    target.updated_by_user_id = current_user.id
    return target
