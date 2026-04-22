from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_policy import CreditPolicy
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import CreditPolicyStatus, ScoreBand


@dataclass
class CreditPolicyMetadata:
    name: str
    version: str
    policy_type: str
    source: str
    note: str


@dataclass
class ScoreBandThreshold:
    min_score: int | None = None
    max_score: int | None = None


@dataclass
class DebtRatioPenalty:
    threshold: Decimal
    points: int


@dataclass
class ScorePolicyConfig:
    base_score: int
    min_final_score: int
    max_final_score: int
    score_bands: dict[ScoreBand, ScoreBandThreshold]
    restrictions_penalty: int
    protests_penalty_per_item: int
    lawsuits_penalty_per_item: int
    bounced_checks_penalty_per_item: int
    debt_ratio_penalties: tuple[DebtRatioPenalty, ...]


@dataclass
class DecisionPolicyConfig:
    band_limit_caps: dict[ScoreBand, Decimal]
    max_indebtedness_for_auto_approval: Decimal


@dataclass
class CreditPolicyCriteria:
    has_restrictions: bool
    protests_count: bool
    lawsuits_count: bool
    bounced_checks_count: bool
    declared_revenue: bool
    declared_indebtedness: bool


@dataclass
class ActiveCreditPolicy:
    metadata: CreditPolicyMetadata
    score: ScorePolicyConfig
    decision: DecisionPolicyConfig
    criteria: CreditPolicyCriteria


@dataclass
class PolicyDiffSummary:
    created_rules: int
    updated_rules: int
    removed_rules: int


class CreditPolicyServiceError(Exception):
    pass


class CreditPolicyNotFoundError(CreditPolicyServiceError):
    pass


class CreditPolicyValidationError(CreditPolicyServiceError):
    pass


STATIC_ACTIVE_CREDIT_POLICY = ActiveCreditPolicy(
    metadata=CreditPolicyMetadata(
        name="Politica padrao vigente",
        version="v1-static",
        policy_type="static",
        source="backend_code",
        note="Politica vigente centralizada no backend para calculo de score e decisao.",
    ),
    score=ScorePolicyConfig(
        base_score=1000,
        min_final_score=0,
        max_final_score=1000,
        score_bands={
            ScoreBand.A: ScoreBandThreshold(min_score=800, max_score=None),
            ScoreBand.B: ScoreBandThreshold(min_score=700, max_score=799),
            ScoreBand.C: ScoreBandThreshold(min_score=600, max_score=699),
            ScoreBand.D: ScoreBandThreshold(min_score=None, max_score=599),
        },
        restrictions_penalty=-300,
        protests_penalty_per_item=-50,
        lawsuits_penalty_per_item=-40,
        bounced_checks_penalty_per_item=-30,
        debt_ratio_penalties=(
            DebtRatioPenalty(threshold=Decimal("0.8"), points=-150),
            DebtRatioPenalty(threshold=Decimal("0.5"), points=-80),
            DebtRatioPenalty(threshold=Decimal("0.3"), points=-30),
        ),
    ),
    decision=DecisionPolicyConfig(
        band_limit_caps={
            ScoreBand.A: Decimal("0.30"),
            ScoreBand.B: Decimal("0.20"),
            ScoreBand.C: Decimal("0.10"),
            ScoreBand.D: Decimal("0.00"),
        },
        max_indebtedness_for_auto_approval=Decimal("0.5"),
    ),
    criteria=CreditPolicyCriteria(
        has_restrictions=True,
        protests_count=True,
        lawsuits_count=True,
        bounced_checks_count=True,
        declared_revenue=True,
        declared_indebtedness=True,
    ),
)

KNOWN_BOOLEAN_FIELDS = {
    "criteria.has_restrictions",
    "criteria.protests_count",
    "criteria.lawsuits_count",
    "criteria.bounced_checks_count",
    "criteria.declared_revenue",
    "criteria.declared_indebtedness",
}
KNOWN_INTEGER_FIELDS = {
    "score.base",
    "score.min",
    "score.max",
    "score.band.min",
    "score.band.max",
    "score.penalty.restrictions",
    "score.penalty.protests_per_item",
    "score.penalty.lawsuits_per_item",
    "score.penalty.bounced_checks_per_item",
}
KNOWN_DECIMAL_FIELDS = {
    "score.penalty.debt_ratio",
    "decision.band_limit_cap",
    "decision.max_indebtedness_for_auto_approval",
}
KNOWN_FIELDS = KNOWN_BOOLEAN_FIELDS | KNOWN_INTEGER_FIELDS | KNOWN_DECIMAL_FIELDS
MISSING = object()


def _new_rule(
    *,
    policy_id: int,
    score_band: ScoreBand | None,
    pillar: str,
    field: str,
    operator: str,
    value: Any,
    label: str,
    order_index: int,
    points: int | None = None,
    description: str | None = None,
) -> CreditPolicyRule:
    return CreditPolicyRule(
        policy_id=policy_id,
        score_band=score_band,
        pillar=pillar,
        field=field,
        operator=operator,
        value=value,
        points=points,
        label=label,
        description=description,
        is_active=True,
        order_index=order_index,
    )


def _build_seed_rules(policy_id: int) -> list[CreditPolicyRule]:
    score = STATIC_ACTIVE_CREDIT_POLICY.score
    decision = STATIC_ACTIVE_CREDIT_POLICY.decision
    criteria = STATIC_ACTIVE_CREDIT_POLICY.criteria

    rules: list[CreditPolicyRule] = [
        _new_rule(
            policy_id=policy_id,
            score_band=None,
            pillar="internalHistory",
            field="score.base",
            operator="eq",
            value=score.base_score,
            label="Score base",
            order_index=1,
        ),
        _new_rule(
            policy_id=policy_id,
            score_band=None,
            pillar="internalHistory",
            field="score.min",
            operator="eq",
            value=score.min_final_score,
            label="Score minimo",
            order_index=2,
        ),
        _new_rule(
            policy_id=policy_id,
            score_band=None,
            pillar="internalHistory",
            field="score.max",
            operator="eq",
            value=score.max_final_score,
            label="Score maximo",
            order_index=3,
        ),
    ]

    order_index = 4
    for band in (ScoreBand.A, ScoreBand.B, ScoreBand.C, ScoreBand.D):
        threshold = score.score_bands[band]
        rules.append(
            _new_rule(
                policy_id=policy_id,
                score_band=band,
                pillar="internalHistory",
                field="score.band.min",
                operator="gte",
                value=threshold.min_score,
                label=f"Faixa {band.value} minimo",
                order_index=order_index,
            )
        )
        order_index += 1
        rules.append(
            _new_rule(
                policy_id=policy_id,
                score_band=band,
                pillar="internalHistory",
                field="score.band.max",
                operator="lte",
                value=threshold.max_score,
                label=f"Faixa {band.value} maximo",
                order_index=order_index,
            )
        )
        order_index += 1

    rules.extend(
        [
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="externalRisk",
                field="score.penalty.restrictions",
                operator="eq",
                value=score.restrictions_penalty,
                label="Penalidade por restricao ativa",
                order_index=order_index,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="legal",
                field="score.penalty.protests_per_item",
                operator="per_item",
                value=score.protests_penalty_per_item,
                label="Penalidade por protesto",
                order_index=order_index + 1,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="legal",
                field="score.penalty.lawsuits_per_item",
                operator="per_item",
                value=score.lawsuits_penalty_per_item,
                label="Penalidade por acao judicial",
                order_index=order_index + 2,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="internalHistory",
                field="score.penalty.bounced_checks_per_item",
                operator="per_item",
                value=score.bounced_checks_penalty_per_item,
                label="Penalidade por cheque sem fundo",
                order_index=order_index + 3,
            ),
        ]
    )
    order_index += 4

    for penalty in score.debt_ratio_penalties:
        rules.append(
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="financialCapacity",
                field="score.penalty.debt_ratio",
                operator="gt",
                value=float(penalty.threshold),
                points=penalty.points,
                label=f"Penalidade por endividamento > {penalty.threshold}",
                order_index=order_index,
            )
        )
        order_index += 1

    for band in (ScoreBand.A, ScoreBand.B, ScoreBand.C, ScoreBand.D):
        rules.append(
            _new_rule(
                policy_id=policy_id,
                score_band=band,
                pillar="financialCapacity",
                field="decision.band_limit_cap",
                operator="multiplier",
                value=float(decision.band_limit_caps[band]),
                label=f"Cap de limite para faixa {band.value}",
                order_index=order_index,
            )
        )
        order_index += 1

    rules.append(
        _new_rule(
            policy_id=policy_id,
            score_band=None,
            pillar="financialCapacity",
            field="decision.max_indebtedness_for_auto_approval",
            operator="lte",
            value=float(decision.max_indebtedness_for_auto_approval),
            label="Endividamento maximo para aprovacao automatica",
            order_index=order_index,
        )
    )
    order_index += 1

    rules.extend(
        [
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="externalRisk",
                field="criteria.has_restrictions",
                operator="required",
                value=criteria.has_restrictions,
                label="Criterio restricoes",
                order_index=order_index,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="legal",
                field="criteria.protests_count",
                operator="required",
                value=criteria.protests_count,
                label="Criterio protestos",
                order_index=order_index + 1,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="legal",
                field="criteria.lawsuits_count",
                operator="required",
                value=criteria.lawsuits_count,
                label="Criterio acoes judiciais",
                order_index=order_index + 2,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="internalHistory",
                field="criteria.bounced_checks_count",
                operator="required",
                value=criteria.bounced_checks_count,
                label="Criterio cheques sem fundo",
                order_index=order_index + 3,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="financialCapacity",
                field="criteria.declared_revenue",
                operator="required",
                value=criteria.declared_revenue,
                label="Criterio receita declarada",
                order_index=order_index + 4,
            ),
            _new_rule(
                policy_id=policy_id,
                score_band=None,
                pillar="financialCapacity",
                field="criteria.declared_indebtedness",
                operator="required",
                value=criteria.declared_indebtedness,
                label="Criterio endividamento declarado",
                order_index=order_index + 5,
            ),
        ]
    )
    return rules


def _as_decimal(value: Any) -> Decimal:
    return Decimal(str(value))


def _as_int(value: Any) -> int:
    return int(value)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.lower().strip()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    raise CreditPolicyValidationError("Boolean value is required for this field.")


def _next_version(db: Session) -> int:
    last_policy = db.scalar(select(CreditPolicy).order_by(CreditPolicy.version.desc(), CreditPolicy.id.desc()))
    if last_policy is None:
        return 1
    return last_policy.version + 1


def _clone_policy(
    db: Session,
    *,
    source_policy: CreditPolicy,
    target_status: CreditPolicyStatus,
    target_version: int,
    published_at: datetime | None = None,
) -> CreditPolicy:
    cloned = CreditPolicy(
        name=source_policy.name,
        status=target_status,
        version=target_version,
        policy_type=source_policy.policy_type,
        source=source_policy.source,
        note=source_policy.note,
        published_at=published_at,
    )
    db.add(cloned)
    db.flush()

    for rule in source_policy.rules:
        if not rule.is_active:
            continue
        cloned.rules.append(
            CreditPolicyRule(
                policy_id=cloned.id,
                score_band=rule.score_band,
                pillar=rule.pillar,
                field=rule.field,
                operator=rule.operator,
                value=rule.value,
                points=rule.points,
                label=rule.label,
                description=rule.description,
                is_active=rule.is_active,
                order_index=rule.order_index,
            )
        )

    return cloned


def get_active_policy_entity(db: Session) -> CreditPolicy | None:
    return db.scalar(
        select(CreditPolicy)
        .where(CreditPolicy.status == CreditPolicyStatus.ACTIVE)
        .order_by(CreditPolicy.version.desc(), CreditPolicy.id.desc())
    )


def get_draft_policy_entity(db: Session) -> CreditPolicy | None:
    return db.scalar(
        select(CreditPolicy)
        .where(CreditPolicy.status == CreditPolicyStatus.DRAFT)
        .order_by(CreditPolicy.version.desc(), CreditPolicy.id.desc())
    )


def bootstrap_active_policy_if_needed(db: Session) -> CreditPolicy:
    active_policy = get_active_policy_entity(db)
    if active_policy is not None:
        return active_policy

    active_policy = CreditPolicy(
        name=STATIC_ACTIVE_CREDIT_POLICY.metadata.name,
        status=CreditPolicyStatus.ACTIVE,
        version=_next_version(db),
        policy_type="persisted",
        source="bootstrap_static_policy",
        note=STATIC_ACTIVE_CREDIT_POLICY.metadata.note,
        published_at=datetime.now(timezone.utc),
    )
    db.add(active_policy)
    db.flush()

    active_policy.rules.extend(_build_seed_rules(active_policy.id))
    db.flush()
    return active_policy


def ensure_active_policy(db: Session) -> CreditPolicy:
    return bootstrap_active_policy_if_needed(db)


def get_or_create_draft_policy(db: Session) -> CreditPolicy:
    draft = get_draft_policy_entity(db)
    if draft is not None:
        return draft

    active = ensure_active_policy(db)
    draft = _clone_policy(
        db,
        source_policy=active,
        target_status=CreditPolicyStatus.DRAFT,
        target_version=active.version + 1,
    )
    db.flush()
    return draft


def reset_draft_policy(db: Session) -> CreditPolicy:
    current_draft = get_draft_policy_entity(db)
    if current_draft is not None:
        db.delete(current_draft)
        db.flush()
    return get_or_create_draft_policy(db)


def _validate_rule_payload(
    *,
    field: str,
    value: Any,
    points: int | None,
    score_band: ScoreBand | None,
) -> None:
    if field in KNOWN_BOOLEAN_FIELDS:
        _as_bool(value)
        return

    if field in KNOWN_INTEGER_FIELDS:
        if value is None:
            return
        _as_int(value)
        if field.startswith("score.band.") and score_band is None:
            raise CreditPolicyValidationError("score_band is required for score band threshold rules.")
        return

    if field == "score.penalty.debt_ratio":
        _as_decimal(value)
        if points is None:
            raise CreditPolicyValidationError("points is required for debt ratio penalty rules.")
        return

    if field in KNOWN_DECIMAL_FIELDS:
        _as_decimal(value)
        if field == "decision.band_limit_cap" and score_band is None:
            raise CreditPolicyValidationError("score_band is required for decision.band_limit_cap.")
        return

    if not field:
        raise CreditPolicyValidationError("field must not be empty.")


def create_draft_rule(
    db: Session,
    *,
    score_band: ScoreBand | None,
    pillar: str,
    field: str,
    operator: str,
    value: Any,
    points: int | None,
    label: str,
    description: str | None,
    is_active: bool,
    order_index: int | None,
) -> CreditPolicyRule:
    draft = get_or_create_draft_policy(db)
    _validate_rule_payload(field=field, value=value, points=points, score_band=score_band)

    max_order = max((rule.order_index for rule in draft.rules), default=0)
    resolved_order = order_index if order_index is not None else max_order + 1

    rule = CreditPolicyRule(
        policy_id=draft.id,
        score_band=score_band,
        pillar=pillar,
        field=field,
        operator=operator,
        value=value,
        points=points,
        label=label,
        description=description,
        is_active=is_active,
        order_index=resolved_order,
    )
    db.add(rule)
    db.flush()
    return rule


def update_draft_rule(
    db: Session,
    rule_id: int,
    *,
    score_band: ScoreBand | None | object = MISSING,
    pillar: str | None | object = MISSING,
    field: str | None | object = MISSING,
    operator: str | None | object = MISSING,
    value: Any = MISSING,
    points: int | None | object = MISSING,
    label: str | None | object = MISSING,
    description: str | None | object = MISSING,
    is_active: bool | None | object = MISSING,
    order_index: int | None | object = MISSING,
) -> CreditPolicyRule:
    draft = get_or_create_draft_policy(db)
    rule = db.scalar(
        select(CreditPolicyRule).where(
            CreditPolicyRule.id == rule_id,
            CreditPolicyRule.policy_id == draft.id,
        )
    )
    if rule is None:
        raise CreditPolicyNotFoundError("Rule not found in draft.")

    resolved_field = field if field is not MISSING else rule.field
    resolved_value = value if value is not MISSING else rule.value
    resolved_points = points if points is not MISSING else rule.points
    resolved_score_band = score_band if score_band is not MISSING else rule.score_band
    _validate_rule_payload(
        field=resolved_field,
        value=resolved_value,
        points=resolved_points,
        score_band=resolved_score_band,
    )

    if score_band is not MISSING:
        rule.score_band = score_band
    if pillar is not MISSING:
        rule.pillar = pillar
    if field is not MISSING:
        rule.field = field
    if operator is not MISSING:
        rule.operator = operator
    if value is not MISSING:
        rule.value = value
    if points is not MISSING:
        rule.points = points
    if label is not MISSING:
        rule.label = label
    if description is not MISSING:
        rule.description = description
    if is_active is not MISSING:
        rule.is_active = is_active
    if order_index is not MISSING:
        rule.order_index = order_index

    db.flush()
    return rule


def delete_draft_rule(db: Session, rule_id: int) -> None:
    draft = get_or_create_draft_policy(db)
    rule = db.scalar(
        select(CreditPolicyRule).where(
            CreditPolicyRule.id == rule_id,
            CreditPolicyRule.policy_id == draft.id,
        )
    )
    if rule is None:
        raise CreditPolicyNotFoundError("Rule not found in draft.")
    db.delete(rule)
    db.flush()


def publish_draft_policy(db: Session) -> CreditPolicy:
    draft = get_draft_policy_entity(db)
    if draft is None:
        raise CreditPolicyNotFoundError("Draft policy not found.")

    active = ensure_active_policy(db)
    active.status = CreditPolicyStatus.ARCHIVED

    draft.status = CreditPolicyStatus.ACTIVE
    draft.published_at = datetime.now(timezone.utc)
    draft.source = "published_draft"

    db.flush()
    return draft


def get_policy_diff_summary(db: Session) -> PolicyDiffSummary:
    active = ensure_active_policy(db)
    draft = get_or_create_draft_policy(db)

    active_by_key = {
        (rule.score_band.value if rule.score_band else None, rule.field, rule.operator): rule
        for rule in active.rules
        if rule.is_active
    }
    draft_by_key = {
        (rule.score_band.value if rule.score_band else None, rule.field, rule.operator): rule
        for rule in draft.rules
        if rule.is_active
    }

    created = 0
    updated = 0
    removed = 0

    for key, draft_rule in draft_by_key.items():
        active_rule = active_by_key.get(key)
        if active_rule is None:
            created += 1
            continue
        if (
            active_rule.value != draft_rule.value
            or active_rule.points != draft_rule.points
            or active_rule.label != draft_rule.label
            or active_rule.description != draft_rule.description
            or active_rule.pillar != draft_rule.pillar
        ):
            updated += 1

    for key in active_by_key:
        if key not in draft_by_key:
            removed += 1

    return PolicyDiffSummary(created_rules=created, updated_rules=updated, removed_rules=removed)


def _apply_rule_to_policy(rule: CreditPolicyRule, policy: ActiveCreditPolicy) -> None:
    field = rule.field

    if field == "score.base":
        policy.score.base_score = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.min":
        policy.score.min_final_score = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.max":
        policy.score.max_final_score = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.band.min" and rule.score_band is not None:
        policy.score.score_bands[rule.score_band].min_score = (
            _as_int(rule.value) if rule.value is not None else None
        )  # type: ignore[misc]
        return
    if field == "score.band.max" and rule.score_band is not None:
        policy.score.score_bands[rule.score_band].max_score = (
            _as_int(rule.value) if rule.value is not None else None
        )  # type: ignore[misc]
        return
    if field == "score.penalty.restrictions":
        policy.score.restrictions_penalty = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.penalty.protests_per_item":
        policy.score.protests_penalty_per_item = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.penalty.lawsuits_per_item":
        policy.score.lawsuits_penalty_per_item = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.penalty.bounced_checks_per_item":
        policy.score.bounced_checks_penalty_per_item = _as_int(rule.value)  # type: ignore[misc]
        return
    if field == "score.penalty.debt_ratio":
        points = rule.points if rule.points is not None else 0
        policy.score.debt_ratio_penalties.append(  # type: ignore[misc]
            DebtRatioPenalty(
                threshold=_as_decimal(rule.value),
                points=points,
            )
        )
        return
    if field == "decision.band_limit_cap" and rule.score_band is not None:
        policy.decision.band_limit_caps[rule.score_band] = _as_decimal(rule.value)  # type: ignore[misc]
        return
    if field == "decision.max_indebtedness_for_auto_approval":
        policy.decision.max_indebtedness_for_auto_approval = _as_decimal(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.has_restrictions":
        policy.criteria.has_restrictions = _as_bool(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.protests_count":
        policy.criteria.protests_count = _as_bool(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.lawsuits_count":
        policy.criteria.lawsuits_count = _as_bool(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.bounced_checks_count":
        policy.criteria.bounced_checks_count = _as_bool(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.declared_revenue":
        policy.criteria.declared_revenue = _as_bool(rule.value)  # type: ignore[misc]
        return
    if field == "criteria.declared_indebtedness":
        policy.criteria.declared_indebtedness = _as_bool(rule.value)  # type: ignore[misc]


def build_runtime_policy_from_entity(policy: CreditPolicy) -> ActiveCreditPolicy:
    runtime_policy = ActiveCreditPolicy(
        metadata=CreditPolicyMetadata(
            name=policy.name,
            version=f"v{policy.version}",
            policy_type=policy.policy_type,
            source=policy.source,
            note=policy.note,
        ),
        score=ScorePolicyConfig(
            base_score=STATIC_ACTIVE_CREDIT_POLICY.score.base_score,
            min_final_score=STATIC_ACTIVE_CREDIT_POLICY.score.min_final_score,
            max_final_score=STATIC_ACTIVE_CREDIT_POLICY.score.max_final_score,
            score_bands={
                ScoreBand.A: ScoreBandThreshold(
                    min_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.A].min_score,
                    max_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.A].max_score,
                ),
                ScoreBand.B: ScoreBandThreshold(
                    min_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.B].min_score,
                    max_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.B].max_score,
                ),
                ScoreBand.C: ScoreBandThreshold(
                    min_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.C].min_score,
                    max_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.C].max_score,
                ),
                ScoreBand.D: ScoreBandThreshold(
                    min_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.D].min_score,
                    max_score=STATIC_ACTIVE_CREDIT_POLICY.score.score_bands[ScoreBand.D].max_score,
                ),
            },
            restrictions_penalty=STATIC_ACTIVE_CREDIT_POLICY.score.restrictions_penalty,
            protests_penalty_per_item=STATIC_ACTIVE_CREDIT_POLICY.score.protests_penalty_per_item,
            lawsuits_penalty_per_item=STATIC_ACTIVE_CREDIT_POLICY.score.lawsuits_penalty_per_item,
            bounced_checks_penalty_per_item=STATIC_ACTIVE_CREDIT_POLICY.score.bounced_checks_penalty_per_item,
            debt_ratio_penalties=[],
        ),
        decision=DecisionPolicyConfig(
            band_limit_caps=dict(STATIC_ACTIVE_CREDIT_POLICY.decision.band_limit_caps),
            max_indebtedness_for_auto_approval=STATIC_ACTIVE_CREDIT_POLICY.decision.max_indebtedness_for_auto_approval,
        ),
        criteria=CreditPolicyCriteria(
            has_restrictions=STATIC_ACTIVE_CREDIT_POLICY.criteria.has_restrictions,
            protests_count=STATIC_ACTIVE_CREDIT_POLICY.criteria.protests_count,
            lawsuits_count=STATIC_ACTIVE_CREDIT_POLICY.criteria.lawsuits_count,
            bounced_checks_count=STATIC_ACTIVE_CREDIT_POLICY.criteria.bounced_checks_count,
            declared_revenue=STATIC_ACTIVE_CREDIT_POLICY.criteria.declared_revenue,
            declared_indebtedness=STATIC_ACTIVE_CREDIT_POLICY.criteria.declared_indebtedness,
        ),
    )

    for rule in policy.rules:
        if not rule.is_active:
            continue
        _apply_rule_to_policy(rule, runtime_policy)

    runtime_policy.score.debt_ratio_penalties.sort(key=lambda item: item.threshold, reverse=True)
    runtime_policy.score.debt_ratio_penalties = tuple(runtime_policy.score.debt_ratio_penalties)
    return runtime_policy


def get_active_credit_policy(db: Session | None = None) -> ActiveCreditPolicy:
    if db is None:
        return STATIC_ACTIVE_CREDIT_POLICY

    active_policy = ensure_active_policy(db)
    return build_runtime_policy_from_entity(active_policy)
