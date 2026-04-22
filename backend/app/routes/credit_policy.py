from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.credit_policy import CreditPolicy
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import ScoreBand
from app.schemas.credit_policy import (
    CreditPolicyCriteriaRead,
    CreditPolicyDebtRatioPenaltyRead,
    CreditPolicyDecisionRead,
    CreditPolicyDiffSummaryRead,
    CreditPolicyDraftRuleCreate,
    CreditPolicyDraftRuleUpdate,
    CreditPolicyRead,
    CreditPolicyRuleRead,
    CreditPolicyScoreAdjustmentsRead,
    CreditPolicyScoreBandRead,
    CreditPolicyScoreBandsRead,
)
from app.services.credit_policy import (
    CreditPolicyNotFoundError,
    CreditPolicyValidationError,
    MISSING,
    build_runtime_policy_from_entity,
    get_or_create_draft_policy,
    get_policy_diff_summary,
    create_draft_rule,
    delete_draft_rule,
    ensure_active_policy,
    publish_draft_policy,
    reset_draft_policy,
    update_draft_rule,
)

router = APIRouter(prefix="/credit-policy", tags=["credit-policy"])


def _sort_policy_rules(rules: list[CreditPolicyRule]) -> list[CreditPolicyRule]:
    return sorted(rules, key=lambda item: (item.order_index, item.id))


def _build_policy_response(
    policy: CreditPolicy,
    *,
    include_diff: bool,
    db: Session,
) -> CreditPolicyRead:
    runtime_policy = build_runtime_policy_from_entity(policy)

    score = runtime_policy.score
    decision = runtime_policy.decision
    criteria = runtime_policy.criteria

    score_bands = {
        band: CreditPolicyScoreBandRead(
            min_score=score.score_bands[band].min_score,
            max_score=score.score_bands[band].max_score,
        )
        for band in (ScoreBand.A, ScoreBand.B, ScoreBand.C, ScoreBand.D)
    }

    diff_summary = None
    if include_diff:
        diff = get_policy_diff_summary(db)
        diff_summary = CreditPolicyDiffSummaryRead(
            created_rules=diff.created_rules,
            updated_rules=diff.updated_rules,
            removed_rules=diff.removed_rules,
        )

    return CreditPolicyRead(
        policy_id=policy.id,
        policy_status=policy.status.value,
        version_number=policy.version,
        published_at=policy.published_at,
        policy_name=policy.name,
        policy_version=f"v{policy.version}",
        policy_type=policy.policy_type,
        policy_source=policy.source,
        note=policy.note,
        score_base=score.base_score,
        score_min=score.min_final_score,
        score_max=score.max_final_score,
        score_bands=CreditPolicyScoreBandsRead(
            A=score_bands[ScoreBand.A],
            B=score_bands[ScoreBand.B],
            C=score_bands[ScoreBand.C],
            D=score_bands[ScoreBand.D],
        ),
        score_adjustments=CreditPolicyScoreAdjustmentsRead(
            restrictions_points=score.restrictions_penalty,
            protests_points_per_item=score.protests_penalty_per_item,
            lawsuits_points_per_item=score.lawsuits_penalty_per_item,
            bounced_checks_points_per_item=score.bounced_checks_penalty_per_item,
            debt_ratio_points=[
                CreditPolicyDebtRatioPenaltyRead(threshold=item.threshold, points=item.points)
                for item in score.debt_ratio_penalties
            ],
        ),
        decision=CreditPolicyDecisionRead(
            band_limit_caps={band.value: cap for band, cap in decision.band_limit_caps.items()},
            max_indebtedness_for_auto_approval=decision.max_indebtedness_for_auto_approval,
        ),
        criteria=CreditPolicyCriteriaRead(
            has_restrictions=criteria.has_restrictions,
            protests_count=criteria.protests_count,
            lawsuits_count=criteria.lawsuits_count,
            bounced_checks_count=criteria.bounced_checks_count,
            declared_revenue=criteria.declared_revenue,
            declared_indebtedness=criteria.declared_indebtedness,
        ),
        rules=[CreditPolicyRuleRead.model_validate(rule) for rule in _sort_policy_rules(policy.rules)],
        diff_summary=diff_summary,
    )


@router.get("/active", response_model=CreditPolicyRead)
def get_active_policy(db: Session = Depends(get_db)) -> CreditPolicyRead:
    policy = ensure_active_policy(db)
    db.commit()
    db.refresh(policy)
    return _build_policy_response(policy, include_diff=False, db=db)


@router.get("/draft", response_model=CreditPolicyRead)
def get_draft_policy(db: Session = Depends(get_db)) -> CreditPolicyRead:
    policy = get_or_create_draft_policy(db)
    db.commit()
    db.refresh(policy)
    return _build_policy_response(policy, include_diff=True, db=db)


@router.post("/draft/rules", response_model=CreditPolicyRuleRead, status_code=status.HTTP_201_CREATED)
def create_policy_draft_rule(
    payload: CreditPolicyDraftRuleCreate,
    db: Session = Depends(get_db),
) -> CreditPolicyRule:
    try:
        rule = create_draft_rule(
            db,
            score_band=payload.score_band,
            pillar=payload.pillar,
            field=payload.field,
            operator=payload.operator,
            value=payload.value,
            points=payload.points,
            label=payload.label,
            description=payload.description,
            is_active=payload.is_active,
            order_index=payload.order_index,
        )
        db.commit()
    except (CreditPolicyValidationError, CreditPolicyNotFoundError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to create draft rule.") from exc

    db.refresh(rule)
    return rule


@router.patch("/draft/rules/{rule_id}", response_model=CreditPolicyRuleRead)
def update_policy_draft_rule(
    rule_id: int,
    payload: CreditPolicyDraftRuleUpdate,
    db: Session = Depends(get_db),
) -> CreditPolicyRule:
    fields_set = payload.model_fields_set
    try:
        rule = update_draft_rule(
            db,
            rule_id,
            score_band=payload.score_band if "score_band" in fields_set else MISSING,
            pillar=payload.pillar if "pillar" in fields_set else MISSING,
            field=payload.field if "field" in fields_set else MISSING,
            operator=payload.operator if "operator" in fields_set else MISSING,
            value=payload.value if "value" in fields_set else MISSING,
            points=payload.points if "points" in fields_set else MISSING,
            label=payload.label if "label" in fields_set else MISSING,
            description=payload.description if "description" in fields_set else MISSING,
            is_active=payload.is_active if "is_active" in fields_set else MISSING,
            order_index=payload.order_index if "order_index" in fields_set else MISSING,
        )
        db.commit()
    except CreditPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CreditPolicyValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to update draft rule.") from exc

    db.refresh(rule)
    return rule


@router.delete("/draft/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy_draft_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    try:
        delete_draft_rule(db, rule_id)
        db.commit()
    except CreditPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to delete draft rule.") from exc


@router.post("/draft/publish", response_model=CreditPolicyRead)
def publish_policy_draft(db: Session = Depends(get_db)) -> CreditPolicyRead:
    try:
        active = publish_draft_policy(db)
        db.commit()
    except CreditPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to publish draft policy.") from exc

    db.refresh(active)
    return _build_policy_response(active, include_diff=False, db=db)


@router.post("/draft/reset", response_model=CreditPolicyRead)
def reset_policy_draft(db: Session = Depends(get_db)) -> CreditPolicyRead:
    try:
        draft = reset_draft_policy(db)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to reset draft policy.") from exc

    db.refresh(draft)
    return _build_policy_response(draft, include_diff=True, db=db)
