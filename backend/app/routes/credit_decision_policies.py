from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, require_permissions
from app.db.session import get_db
from app.schemas.credit_decision_policy import (
    CreditDecisionPolicyActivateResponse,
    CreditDecisionPolicyArchiveResponse,
    CreditDecisionPolicyCreate,
    CreditDecisionPolicyListItem,
    CreditDecisionPolicyPreviewResult,
    CreditDecisionPolicyRead,
)
from app.services.credit_decision_policy_preview import (
    CreditDecisionPolicyPreviewNotFoundError,
    resolve_credit_decision_policy_preview,
)
from app.services.credit_decision_policy_service import (
    CreditDecisionPolicyNotFoundError,
    CreditDecisionPolicyValidationError,
    activate_credit_decision_policy,
    archive_credit_decision_policy,
    create_credit_decision_policy,
    get_active_credit_decision_policy,
    get_credit_decision_policy,
    list_credit_decision_policies,
)

router = APIRouter(prefix="/credit-decision-policies", tags=["credit-decision-policies"])


@router.get("/active", response_model=CreditDecisionPolicyRead)
def get_active_policy(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> CreditDecisionPolicyRead:
    try:
        policy = get_active_credit_decision_policy(db)
        return CreditDecisionPolicyRead.model_validate(policy)
    except CreditDecisionPolicyNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("", response_model=list[CreditDecisionPolicyListItem])
def list_policies(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> list[CreditDecisionPolicyListItem]:
    return [CreditDecisionPolicyListItem.model_validate(item) for item in list_credit_decision_policies(db)]


@router.get("/preview/{analysis_id}", response_model=CreditDecisionPolicyPreviewResult)
def get_policy_preview(
    analysis_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> CreditDecisionPolicyPreviewResult:
    try:
        preview = resolve_credit_decision_policy_preview(db, analysis_id)
        return CreditDecisionPolicyPreviewResult.model_validate(preview)
    except CreditDecisionPolicyPreviewNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{policy_id}", response_model=CreditDecisionPolicyRead)
def get_policy(
    policy_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> CreditDecisionPolicyRead:
    try:
        policy = get_credit_decision_policy(db, policy_id)
        return CreditDecisionPolicyRead.model_validate(policy)
    except CreditDecisionPolicyNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("", response_model=CreditDecisionPolicyRead, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: CreditDecisionPolicyCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> CreditDecisionPolicyRead:
    try:
        policy = create_credit_decision_policy(db, payload, current.user)
        db.commit()
        db.refresh(policy)
        return CreditDecisionPolicyRead.model_validate(policy)
    except CreditDecisionPolicyValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to create credit decision policy.") from exc


@router.post("/{policy_id}/activate", response_model=CreditDecisionPolicyActivateResponse)
def activate_policy(
    policy_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> CreditDecisionPolicyActivateResponse:
    try:
        policy = activate_credit_decision_policy(db, policy_id, current.user)
        db.commit()
        db.refresh(policy)
        return CreditDecisionPolicyActivateResponse(
            message="Credit decision policy activated.",
            policy=CreditDecisionPolicyRead.model_validate(policy),
        )
    except CreditDecisionPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CreditDecisionPolicyValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.post("/{policy_id}/archive", response_model=CreditDecisionPolicyArchiveResponse)
def archive_policy(
    policy_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> CreditDecisionPolicyArchiveResponse:
    try:
        policy = archive_credit_decision_policy(db, policy_id, current.user)
        db.commit()
        db.refresh(policy)
        return CreditDecisionPolicyArchiveResponse(
            message="Credit decision policy archived.",
            policy=CreditDecisionPolicyRead.model_validate(policy),
        )
    except CreditDecisionPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
