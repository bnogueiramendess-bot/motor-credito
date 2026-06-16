from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
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
    PolicyGovernanceSettingRead,
    PolicyGovernanceRequestCreate,
    PolicyGovernanceRequestDecision,
    PolicyGovernanceRequestRead,
    PolicyGovernanceActionRequest,
    PolicyGovernanceValidateActionRequest,
    PolicyGovernanceValidationResult,
)
from app.services.credit_decision_policy_publication import (
    execute_policy_archive,
    execute_policy_publication,
    request_policy_archive,
    request_policy_publication,
)
from app.services.credit_decision_policy_governance_workflow import (
    PolicyGovernanceWorkflowConflictError,
    PolicyGovernanceWorkflowError,
    PolicyGovernanceWorkflowForbiddenError,
    PolicyGovernanceWorkflowNotFoundError,
    approve_governance_request,
    create_governance_request,
    get_governance_request,
    list_governance_requests,
    reject_governance_request,
)
from app.services.credit_decision_policy_governance import (
    PolicyGovernanceValidationError,
    get_policy_governance_settings,
    validate_policy_action_governance,
)
from app.services.credit_decision_policy_preview import (
    CreditDecisionPolicyPreviewNotFoundError,
    resolve_credit_decision_policy_preview,
)
from app.services.credit_decision_policy_service import (
    CreditDecisionPolicyNotFoundError,
    CreditDecisionPolicyValidationError,
    create_credit_decision_policy,
    get_active_credit_decision_policy,
    get_credit_decision_policy,
    list_credit_decision_policies,
)
from app.services.credit_decision_policy_score_structure import (
    CreditDecisionPolicyScoreStructureNotFoundError,
    get_current_score_structure,
    get_score_structure,
    simulate_pillar_one_score,
    simulate_pillar_two_score,
    simulate_pillar_four_score,
    simulate_pillar_five_score,
    validate_score_structure,
)

router = APIRouter(prefix="/credit-decision-policies", tags=["credit-decision-policies"])


class PillarOneScoreSimulationRequest(BaseModel):
    coface_valid: bool = False
    indicator_values: dict[str, Any] | None = None
    analysis_id: int | None = None

    model_config = ConfigDict(extra="forbid")


class PillarTwoScoreSimulationRequest(BaseModel):
    requested_limit_amount: float | int | str | None
    coface_coverage_amount: float | int | str | None = None
    coface_valid: bool | None = None
    coface_status: str | None = None
    analysis_id: int | None = None

    model_config = ConfigDict(extra="forbid")


class PillarFourScoreSimulationRequest(BaseModel):
    cnpj: str | None = None
    analysis_id: int | None = None

    model_config = ConfigDict(extra="forbid")


class PillarFiveScoreSimulationRequest(BaseModel):
    cnpj: str | None = None
    analysis_id: int | None = None

    model_config = ConfigDict(extra="forbid")


@router.get("/governance-settings", response_model=list[PolicyGovernanceSettingRead])
def list_policy_governance_settings(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> list[PolicyGovernanceSettingRead]:
    settings = get_policy_governance_settings(db, company_id=current.user.company_id)
    return [
        PolicyGovernanceSettingRead(
            id=item.id,
            company_id=item.company_id,
            action_type=item.action_type,
            required_workflow_role_code=item.workflow_role.code,
            is_required=item.is_required,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in settings
    ]


@router.post("/governance/validate-action", response_model=PolicyGovernanceValidationResult)
def validate_policy_governance_action(
    payload: PolicyGovernanceValidateActionRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> PolicyGovernanceValidationResult:
    try:
        result = validate_policy_action_governance(
            db,
            company_id=current.user.company_id,
            action_type=payload.action_type,
            current_user=current.user,
            policy_id=payload.policy_id,
        )
        return PolicyGovernanceValidationResult.model_validate(result)
    except PolicyGovernanceValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def _raise_governance_workflow_http_error(exc: PolicyGovernanceWorkflowError) -> None:
    if isinstance(exc, PolicyGovernanceWorkflowNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, PolicyGovernanceWorkflowForbiddenError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if isinstance(exc, PolicyGovernanceWorkflowConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.post("/governance-requests", response_model=PolicyGovernanceRequestRead, status_code=status.HTTP_201_CREATED)
def create_policy_governance_request(
    payload: PolicyGovernanceRequestCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> PolicyGovernanceRequestRead:
    try:
        result = create_governance_request(
            db,
            company_id=current.user.company_id,
            action_type=payload.action_type,
            current_user=current.user,
            policy_id=payload.policy_id,
            justification=payload.justification,
            metadata_json=payload.metadata_json,
        )
        db.commit()
        return PolicyGovernanceRequestRead.model_validate(result)
    except PolicyGovernanceWorkflowError as exc:
        db.rollback()
        _raise_governance_workflow_http_error(exc)


@router.get("/governance-requests", response_model=list[PolicyGovernanceRequestRead])
def list_policy_governance_requests(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> list[PolicyGovernanceRequestRead]:
    return [
        PolicyGovernanceRequestRead.model_validate(item)
        for item in list_governance_requests(db, company_id=current.user.company_id)
    ]


@router.get("/governance-requests/{request_id}", response_model=PolicyGovernanceRequestRead)
def get_policy_governance_request(
    request_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> PolicyGovernanceRequestRead:
    try:
        return PolicyGovernanceRequestRead.model_validate(
            get_governance_request(db, company_id=current.user.company_id, request_id=request_id)
        )
    except PolicyGovernanceWorkflowError as exc:
        _raise_governance_workflow_http_error(exc)


@router.post("/governance-requests/{request_id}/approve", response_model=PolicyGovernanceRequestRead)
def approve_policy_governance_request(
    request_id: int,
    payload: PolicyGovernanceRequestDecision,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> PolicyGovernanceRequestRead:
    try:
        result = approve_governance_request(
            db,
            company_id=current.user.company_id,
            request_id=request_id,
            current_user=current.user,
            workflow_role_code=payload.workflow_role_code,
            justification=payload.justification,
        )
        db.commit()
        return PolicyGovernanceRequestRead.model_validate(result)
    except PolicyGovernanceWorkflowError as exc:
        db.rollback()
        _raise_governance_workflow_http_error(exc)


@router.post("/governance-requests/{request_id}/reject", response_model=PolicyGovernanceRequestRead)
def reject_policy_governance_request(
    request_id: int,
    payload: PolicyGovernanceRequestDecision,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> PolicyGovernanceRequestRead:
    try:
        result = reject_governance_request(
            db,
            company_id=current.user.company_id,
            request_id=request_id,
            current_user=current.user,
            workflow_role_code=payload.workflow_role_code,
            justification=payload.justification,
        )
        db.commit()
        return PolicyGovernanceRequestRead.model_validate(result)
    except PolicyGovernanceWorkflowError as exc:
        db.rollback()
        _raise_governance_workflow_http_error(exc)


@router.post("/{policy_id}/request-publication", response_model=PolicyGovernanceRequestRead, status_code=status.HTTP_201_CREATED)
def request_credit_decision_policy_publication(
    policy_id: int,
    payload: PolicyGovernanceActionRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> PolicyGovernanceRequestRead:
    try:
        result = request_policy_publication(
            db,
            company_id=current.user.company_id,
            policy_id=policy_id,
            current_user=current.user,
            justification=payload.justification,
            metadata_json=payload.metadata_json,
        )
        db.commit()
        return PolicyGovernanceRequestRead.model_validate(result)
    except CreditDecisionPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PolicyGovernanceWorkflowError as exc:
        db.rollback()
        _raise_governance_workflow_http_error(exc)


@router.post("/{policy_id}/request-archive", response_model=PolicyGovernanceRequestRead, status_code=status.HTTP_201_CREATED)
def request_credit_decision_policy_archive(
    policy_id: int,
    payload: PolicyGovernanceActionRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> PolicyGovernanceRequestRead:
    try:
        result = request_policy_archive(
            db,
            company_id=current.user.company_id,
            policy_id=policy_id,
            current_user=current.user,
            justification=payload.justification,
            metadata_json=payload.metadata_json,
        )
        db.commit()
        return PolicyGovernanceRequestRead.model_validate(result)
    except CreditDecisionPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PolicyGovernanceWorkflowError as exc:
        db.rollback()
        _raise_governance_workflow_http_error(exc)


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


@router.get("/current-score-structure")
def get_current_policy_score_structure(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return get_current_score_structure(db)
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{policy_id}/score-structure")
def get_policy_score_structure(
    policy_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return get_score_structure(db, policy_id)
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{policy_id}/score-validation")
def get_policy_score_validation(
    policy_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return validate_score_structure(db, policy_id)
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{policy_id}/score-simulation/pillar-one")
def simulate_policy_pillar_one_score(
    policy_id: int,
    payload: PillarOneScoreSimulationRequest,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return simulate_pillar_one_score(
            db,
            policy_id=policy_id,
            coface_valid=payload.coface_valid,
            indicator_values=payload.indicator_values,
            analysis_id=payload.analysis_id,
        )
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{policy_id}/score-simulation/pillar-two")
def simulate_policy_pillar_two_score(
    policy_id: int,
    payload: PillarTwoScoreSimulationRequest,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return simulate_pillar_two_score(
            db,
            policy_id=policy_id,
            requested_limit_amount=payload.requested_limit_amount,
            coface_coverage_amount=payload.coface_coverage_amount,
            coface_valid=payload.coface_valid,
            coface_status=payload.coface_status,
            analysis_id=payload.analysis_id,
        )
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{policy_id}/score-simulation/pillar-four")
def simulate_policy_pillar_four_score(
    policy_id: int,
    payload: PillarFourScoreSimulationRequest,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return simulate_pillar_four_score(
            db,
            policy_id=policy_id,
            cnpj=payload.cnpj,
            analysis_id=payload.analysis_id,
        )
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{policy_id}/score-simulation/pillar-five")
def simulate_policy_pillar_five_score(
    policy_id: int,
    payload: PillarFiveScoreSimulationRequest,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.policy.view"])),
) -> dict[str, Any]:
    try:
        return simulate_pillar_five_score(
            db,
            policy_id=policy_id,
            cnpj=payload.cnpj,
            analysis_id=payload.analysis_id,
        )
    except CreditDecisionPolicyScoreStructureNotFoundError as exc:
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
    request_id: int | None = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> CreditDecisionPolicyActivateResponse:
    try:
        policy = execute_policy_publication(
            db,
            company_id=current.user.company_id,
            policy_id=policy_id,
            request_id=request_id,
            current_user=current.user,
        )
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
    except PolicyGovernanceWorkflowForbiddenError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/{policy_id}/archive", response_model=CreditDecisionPolicyArchiveResponse)
def archive_policy(
    policy_id: int,
    request_id: int | None = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.policy.manage"])),
) -> CreditDecisionPolicyArchiveResponse:
    try:
        policy = execute_policy_archive(
            db,
            company_id=current.user.company_id,
            policy_id=policy_id,
            request_id=request_id,
            current_user=current.user,
        )
        db.commit()
        db.refresh(policy)
        return CreditDecisionPolicyArchiveResponse(
            message="Credit decision policy archived.",
            policy=CreditDecisionPolicyRead.model_validate(policy),
        )
    except CreditDecisionPolicyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PolicyGovernanceWorkflowForbiddenError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
