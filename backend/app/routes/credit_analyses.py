from decimal import Decimal
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import Numeric, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user, require_permissions
from app.db.session import get_db
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.audit_log import AuditLog
from app.models.business_unit import BusinessUnit
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.enums import ActorType, AnalysisStatus, FinalDecision
from app.models.external_data_entry import ExternalDataEntry
from app.models.external_data_file import ExternalDataFile
from app.models.analysis_request_metadata import AnalysisRequestMetadata
from app.models.analysis_document import AnalysisDocument
from app.models.analysis_commercial_reference import AnalysisCommercialReference
from app.models.score_result import ScoreResult
from app.models.credit_report_read import CreditReportRead
from app.models.user import User
from app.models.role import Role
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.schemas.credit_analysis import (
    CreditAnalysisCreate,
    CreditAnalysisDraftCreateRequest,
    CreditAnalysisDraftCreateResponse,
    CreditAnalysisDraftRecoveryResponse,
    CreditAnalysisExistingCheckResponse,
    CreditAnalysisQueueItem,
    CreditAnalysisQueueKpis,
    CreditAnalysisMonitorItem,
    CreditAnalysisMonitorKpis,
    CreditAnalysisMonitorResponse,
    CreditAnalysisApprovalQueueKpis,
    CreditAnalysisApprovalQueueResponse,
    CreditAnalysisApprovalFlowSummary,
    CreditAnalysisJourneyProgressUpdateRequest,
    CreditAnalysisWorkspaceStateUpdateRequest,
    CreditAnalysisReportReadSummary,
    CreditAnalysisQueueOption,
    CreditAnalysisQueueOptionsResponse,
    CreditAnalysisQueueResponse,
    CreditAnalysisRead,
    CreditAnalysisTriageRequest,
    CreditAnalysisTriageResponse,
    CreditAnalysisTriageSubmitRequest,
    CreditAnalysisTriageSubmitResponse,
)
from app.schemas.decision import DecisionCalculationResponse, DecisionResultResponse
from app.schemas.decision_event import DecisionEventRead
from app.schemas.external_data import (
    ExternalDataEntryCreate,
    ExternalDataEntryDetailRead,
    ExternalDataEntryRead,
    ExternalDataFileMetadataCreate,
    ExternalDataFileSummaryRead,
)
from app.schemas.final_decision import FinalDecisionApplyRequest, FinalDecisionResponse
from app.schemas.score import ScoreCalculationResponse, ScoreResultResponse
from app.schemas.analysis_request import (
    AnalysisCommercialReferenceCreate,
    AnalysisCommercialReferenceRead,
    AnalysisDocumentRead,
    AnalysisRequestMetadataRead,
    AnalysisRequestMetadataUpsert,
)
from app.services.protocol import generate_protocol_number
from app.services.decision import DecisionCalculationError, calculate_and_apply_decision
from app.services.score import ScoreCalculationError, calculate_and_upsert_score
from app.services.external_cnpj import fetch_external_cnpj_data, is_valid_cnpj
from app.services.recommendation import classify_recommendation
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_text_key
from app.services.credit_policy_config import MIN_EARLY_REVIEW_JUSTIFICATION_LENGTH, REANALYSIS_COOLDOWN_DAYS
from app.services.credit_report_readers.agrisk_types import get_agrisk_report_type_from_payload
from app.services.report_links import collect_report_read_ids_from_links, resolve_analysis_document_id_for_read
from app.services.bu_scope import (
    assert_bu_in_scope,
    bu_name_in_scope,
    get_user_allowed_business_units,
    resolve_business_unit_context,
    resolve_analysis_business_unit,
    user_has_all_bu_scope,
)
from app.services.workflow_authorization import (
    can_create_credit_request,
    can_execute_credit_analysis,
    can_issue_credit_opinion,
    can_submit_credit_analysis,
    can_view_approval_queue,
    resolve_credit_workflow_action,
    resolve_credit_workflow_available_actions,
    resolve_technical_dossier_status,
)
from app.services.approval_matrix import resolve_required_approval_roles
from app.services.workflow_transition_engine import resolve_credit_workflow_transition

router = APIRouter(prefix="/credit-analyses", tags=["credit-analyses"])
logger = logging.getLogger(__name__)

DRAFT_TTL_HOURS = 24


class WorkflowActionRequest(BaseModel):
    action: str
    justification: str | None = None


class WorkflowActionResponse(BaseModel):
    analysis_id: int
    current_status: str
    next_status: str
    current_owner: str | None = None
    next_owner: str | None = None
    current_stage: str
    next_stage: str
    timeline_event: str
    audit_event: str
    available_actions: list[str]
    workflow_context: dict

LEGACY_PERMISSION_COMPATIBILITY: dict[str, tuple[str, ...]] = {
    "credit.request.create": ("credit.request.create", "credit_request_submit", "credit.requests.submit"),
    "credit.requests.view": ("credit.requests.view", "credit_request_view_own"),
    "credit.analysis.execute": ("credit.analysis.execute", "credit_request_validate"),
    "credit.request.submit": ("credit.request.submit", "credit_request_submit_approval"),
    "credit.approval.approve": ("credit.approval.approve", "credit_request_approve"),
    "credit.approval.reject": ("credit.approval.reject", "credit_request_reject"),
    "scope:all_bu": ("scope:all_bu", "credit_request_view_bu"),
}


def _normalize_cnpj_or_400(raw_cnpj: str) -> str:
    normalized = normalize_cnpj(raw_cnpj)
    if not normalized or not is_valid_cnpj(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um CNPJ valido para continuar.")
    return normalized


def _resolve_scoped_bu_name(db: Session, current: CurrentUser, bu_name: str | None) -> str | None:
    if not bu_name:
        return None
    normalized_target = normalize_text_key(normalize_bu(bu_name).bu_normalized) or ""
    if not normalized_target:
        return None

    query = select(BusinessUnit).where(BusinessUnit.company_id == current.user.company_id, BusinessUnit.is_active.is_(True))
    if "scope:all_bu" not in current.permissions:
        query = query.where(BusinessUnit.id.in_(current.bu_ids))

    scoped_bus = db.scalars(query).all()
    for bu in scoped_bus:
        if normalize_text_key(bu.name) == normalized_target or normalize_text_key(bu.code) == normalized_target:
            return bu.name
    return None


def _list_user_business_units(db: Session, current: CurrentUser) -> list[BusinessUnit]:
    query = select(BusinessUnit).where(BusinessUnit.company_id == current.user.company_id, BusinessUnit.is_active.is_(True))
    if "scope:all_bu" not in current.permissions:
        query = query.where(BusinessUnit.id.in_(current.bu_ids))
    return list(db.scalars(query.order_by(BusinessUnit.name.asc(), BusinessUnit.id.asc())).all())


def _derive_open_amount(open_amount: Decimal | None, overdue_amount: Decimal | None, not_due_amount: Decimal | None) -> Decimal:
    normalized_open = open_amount or Decimal("0")
    normalized_overdue = overdue_amount or Decimal("0")
    normalized_not_due = not_due_amount or Decimal("0")
    if normalized_open == Decimal("0") and (normalized_overdue != Decimal("0") or normalized_not_due != Decimal("0")):
        return normalized_overdue + normalized_not_due
    return normalized_open


def _build_customer_from_portfolio_row(cnpj: str, row: tuple) -> dict:
    customer_name, bu_name, group_name, open_amount, overdue_amount, not_due_amount, approved_credit, base_date = row
    open_value = _derive_open_amount(open_amount, overdue_amount, not_due_amount)
    overdue_value = overdue_amount or Decimal("0")
    not_due_value = not_due_amount or Decimal("0")
    composition_delta = abs(open_value - (overdue_value + not_due_value))
    if composition_delta > Decimal("1.00"):
        logger.warning(
            "Triagem carteira com composiÃ§Ã£o inconsistente para CNPJ %s: open=%s overdue=%s not_due=%s delta=%s",
            cnpj,
            open_value,
            overdue_value,
            not_due_value,
            composition_delta,
        )
    total_limit = approved_credit or Decimal("0")
    # Regra da triagem: Limite Disponivel = Limite Total - Valor em Aberto.
    available = total_limit - open_value
    return {
        "cnpj": cnpj,
        "company_name": customer_name,
        "business_unit": bu_name,
        "economic_group": group_name,
        "open_amount": open_value,
        "overdue_amount": overdue_value,
        "not_due_amount": not_due_value,
        "total_limit": total_limit,
        "available_limit": available,
        "base_date": base_date,
    }


def _latest_valid_import_run_id(db: Session) -> int | None:
    return db.scalar(
        select(ArAgingImportRun.id)
        .where(ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]))
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )


def _parse_overdue_days(value: object) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    normalized = text.replace(".", "").replace(",", ".")
    try:
        return Decimal(normalized)
    except Exception:
        return None


def _build_portfolio_row_for_cnpj(
    db: Session,
    *,
    normalized_cnpj: str,
    allowed_bu_names: set[str] | None = None,
    has_all_scope: bool = True,
) -> tuple:
    latest_run_id = db.scalar(
        select(ArAgingDataTotalRow.import_run_id)
        .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingDataTotalRow.import_run_id)
        .where(
            ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
        )
        .order_by(ArAgingDataTotalRow.import_run_id.desc())
        .limit(1)
    )
    if latest_run_id is None:
        return (None, None, None, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), None)

    rows_query = select(
        ArAgingDataTotalRow.customer_name,
        ArAgingDataTotalRow.bu_normalized,
        ArAgingDataTotalRow.economic_group_normalized,
        ArAgingDataTotalRow.open_amount,
        ArAgingDataTotalRow.raw_payload_json,
    ).where(
        ArAgingDataTotalRow.import_run_id == latest_run_id,
        ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
    )
    if not has_all_scope and allowed_bu_names:
        rows_query = rows_query.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        return (None, None, None, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), None)
    scoped_rows = db.execute(rows_query).all()
    if not scoped_rows:
        return (None, None, None, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), None)

    customer_name: str | None = None
    bu_name: str | None = None
    group_name: str | None = None
    open_total = Decimal("0")
    overdue_total = Decimal("0")
    not_due_total = Decimal("0")
    for row_customer, row_bu, row_group, row_open, row_payload in scoped_rows:
        if customer_name is None and row_customer:
            customer_name = row_customer
        if bu_name is None and row_bu:
            bu_name = row_bu
        if group_name is None and row_group:
            group_name = row_group

        open_value = row_open or Decimal("0")
        open_total += open_value

        raw_payload = row_payload if isinstance(row_payload, dict) else {}
        overdue_days = _parse_overdue_days(raw_payload.get("col_17"))
        # Regra oficial Data Total: dias vencidos <= 0 eh a vencer; > 0 eh vencido.
        if overdue_days is not None and overdue_days > 0:
            overdue_total += open_value
        else:
            not_due_total += open_value

    group_keys_subquery = (
        select(ArAgingDataTotalRow.economic_group_normalized)
        .where(
            ArAgingDataTotalRow.import_run_id == latest_run_id,
            ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
            ArAgingDataTotalRow.economic_group_normalized.is_not(None),
        )
    )
    if not has_all_scope and allowed_bu_names:
        group_keys_subquery = group_keys_subquery.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    group_keys_subquery = group_keys_subquery.distinct()
    approved_credit_total = db.scalar(
        select(func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0)).where(
            ArAgingGroupConsolidatedRow.import_run_id == latest_run_id,
            ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys_subquery),
        )
    )
    base_date = db.scalar(select(ArAgingImportRun.base_date).where(ArAgingImportRun.id == latest_run_id))

    return (
        customer_name,
        bu_name,
        group_name,
        open_total,
        overdue_total,
        not_due_total,
        approved_credit_total or Decimal("0"),
        base_date,
    )


def _ext_get(data: object, key: str) -> object:
    if isinstance(data, dict):
        return data.get(key)
    return getattr(data, key, None)


def _find_recent_analysis(db: Session, *, customer_id: int) -> CreditAnalysis | None:
    threshold = datetime.now(timezone.utc) - timedelta(days=REANALYSIS_COOLDOWN_DAYS)
    return db.scalar(
        select(CreditAnalysis)
        .where(
            CreditAnalysis.customer_id == customer_id,
            CreditAnalysis.created_at >= threshold,
            (
                (CreditAnalysis.analysis_status == AnalysisStatus.COMPLETED)
                | (CreditAnalysis.final_decision.is_not(None))
            ),
        )
        .order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
        .limit(1)
    )


def _resolve_operational_status(analysis: CreditAnalysis, external_entries: list[ExternalDataEntry]) -> str:
    if analysis.final_decision is not None:
        return "approved" if analysis.final_decision.value == "approved" else "rejected"
    if analysis.analysis_status == AnalysisStatus.IN_PROGRESS and analysis.motor_result is not None:
        return "in_approval"
    if analysis.analysis_status == AnalysisStatus.CREATED:
        return "pending"
    return "in_progress"


def _has_any_permission(current: CurrentUser, *keys: str) -> bool:
    expanded: set[str] = set()
    for key in keys:
        expanded.add(key)
        expanded.update(LEGACY_PERMISSION_COMPATIBILITY.get(key, ()))
    return any(key in current.permissions for key in expanded)


def _require_any_permission_or_403(current: CurrentUser, *keys: str) -> None:
    if _has_any_permission(current, *keys):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")


def _require_can_create_credit_request_or_403(db: Session, current: CurrentUser) -> None:
    authorization = can_create_credit_request(db, current)
    if authorization.allowed:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")


def _require_can_execute_credit_analysis_or_403(db: Session, current: CurrentUser) -> None:
    authorization = can_execute_credit_analysis(db, current)
    if authorization.allowed:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")


def _require_can_issue_credit_opinion_or_403(db: Session, current: CurrentUser) -> None:
    authorization = can_issue_credit_opinion(db, current)
    if authorization.allowed:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")


def _require_can_submit_credit_analysis_or_403(db: Session, current: CurrentUser) -> None:
    authorization = can_submit_credit_analysis(db, current)
    if authorization.allowed:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")


def _require_can_view_approval_queue_or_403(db: Session, current: CurrentUser) -> None:
    authorization = can_view_approval_queue(db, current)
    if authorization.allowed:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para visualizar a fila de aprovacao.")


def _resolve_workflow_stage(status_value: str) -> str:
    if status_value in {"pending"}:
        return "commercial_submitted"
    if status_value in {"in_progress"}:
        return "financial_review"
    if status_value in {"in_approval"}:
        return "pending_approval"
    if status_value in {"approved", "rejected"}:
        return "decided"
    return "returned"


TECHNICAL_MONITOR_VISIBILITY_ACTIONS = {
    "start_analysis",
    "continue_analysis",
    "submit_approval",
    "approve",
    "reject",
    "request_changes",
    "view_dossier",
    "view_result",
}


def _status_label(status_value: str) -> str:
    mapping = {
        "pending": "Pendente",
        "in_progress": "Em andamento",
        "in_approval": "Em aprovacao",
        "approved": "Aprovado",
        "rejected": "Recusado",
    }
    return mapping.get(status_value, status_value)

def _build_approval_flow_summary(
    db: Session,
    current: CurrentUser,
    *,
    analysis: CreditAnalysis,
    business_unit: str | None,
) -> CreditAnalysisApprovalFlowSummary:
    event_type_labels = {
        "analysis_submitted_for_approval": "submitted_for_approval",
        "analysis_approved": "approved",
        "analysis_rejected": "rejected",
        "returned_for_revision": "request_changes",
    }
    def role_label_from_code(code: str) -> str:
        role = db.scalar(select(WorkflowRole).where(WorkflowRole.code == code, WorkflowRole.is_active.is_(True)))
        if role and role.name and role.name.strip():
            return role.name.strip()
        return code

    def resolve_users_for_role(role_code: str) -> list[dict]:
        if not business_unit:
            bu_id = None
        else:
            bu_id = db.scalar(
                select(BusinessUnit.id).where(
                    BusinessUnit.company_id == current.user.company_id,
                    BusinessUnit.name == business_unit,
                    BusinessUnit.is_active.is_(True),
                )
            )
        rows = db.execute(
            select(User.id, User.full_name, User.email)
            .join(UserWorkflowRole, UserWorkflowRole.user_id == User.id)
            .join(WorkflowRole, WorkflowRole.id == UserWorkflowRole.workflow_role_id)
            .join(Role, Role.id == User.role_id)
            .where(
                WorkflowRole.code == role_code,
                WorkflowRole.is_active.is_(True),
                User.company_id == current.user.company_id,
                User.is_active.is_(True),
                Role.is_active.is_(True),
                Role.is_system.is_(False),
            )
            .where(
                (UserWorkflowRole.business_unit_id.is_(None))
                if bu_id is None
                else ((UserWorkflowRole.business_unit_id.is_(None)) | (UserWorkflowRole.business_unit_id == bu_id))
            )
            .order_by(User.full_name.asc(), User.id.asc())
        ).all()
        seen: set[int] = set()
        users: list[dict] = []
        for user_id, full_name, email in rows:
            if user_id in seen:
                continue
            seen.add(user_id)
            users.append(
                {
                    "user_id": user_id,
                    "user_name": (full_name or "").strip() or None,
                    "user_email": (email or "").strip() or None,
                }
            )
        return users

    status_value = _current_status_value(analysis)
    workflow_stage = _resolve_workflow_stage(status_value)
    available_actions = resolve_credit_workflow_available_actions(
        db,
        current,
        analysis=analysis,
        business_unit=business_unit,
    )
    approval_resolution = resolve_credit_workflow_action(
        db,
        current,
        action="approve",
        analysis=analysis,
        business_unit=business_unit,
    )
    events = list(
        db.scalars(
            select(DecisionEvent)
            .where(DecisionEvent.credit_analysis_id == analysis.id)
            .order_by(DecisionEvent.created_at.asc(), DecisionEvent.id.asc())
        ).all()
    )
    event_by_type: dict[str, datetime] = {}
    for event in events:
        if event.event_type not in event_by_type:
            event_by_type[event.event_type] = event.created_at
    returned_for_revision_at = event_by_type.get("returned_for_revision")
    relevant_decision_events = [
        event.created_at
        for event in events
        if event.event_type in {"analysis_submitted_for_approval", "analysis_approved", "analysis_rejected", "returned_for_revision"}
    ]
    required_roles: list[str] = []
    if isinstance(analysis.decision_memory_json, dict):
        preview = analysis.decision_memory_json.get("approval_matrix_preview")
        if isinstance(preview, dict) and isinstance(preview.get("required_roles"), list):
            required_roles = [str(role) for role in preview["required_roles"] if str(role).strip()]

    completed_steps: list[str] = []
    if analysis.submitted_for_approval_at is not None:
        completed_steps.append("Submetida para aprovação")
    if analysis.approved_at is not None:
        completed_steps.append("Aprovada")
    if analysis.rejected_at is not None:
        completed_steps.append("Rejeitada")
    if returned_for_revision_at is not None:
        completed_steps.append("Devolvida para ajustes")

    pending_steps: list[str] = []
    if status_value == "in_approval":
        pending_steps.append("Aguardando decisão da alçada")
    elif status_value == "pending":
        pending_steps.append("Pendente de submissão")
    elif status_value == "in_progress":
        pending_steps.append("Em análise técnica")

    sequential_note = (
        "A aprovação sequencial multi-etapas ainda não está modelada explicitamente; o resumo reflete a alçada aplicável, ações disponíveis e eventos registrados."
        if len(required_roles) <= 1
        else None
    )

    approved_event = next((event for event in reversed(events) if event.event_type == "analysis_approved"), None)
    rejected_event = next((event for event in reversed(events) if event.event_type == "analysis_rejected"), None)
    returned_event = next((event for event in reversed(events) if event.event_type == "returned_for_revision"), None)

    decision_actor_name = approved_event.actor_name if approved_event else rejected_event.actor_name if rejected_event else None
    decision_actor_role = "Aprovador" if approved_event or rejected_event else None

    memory_snapshot = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    recommendation = memory_snapshot.get("recommendation_classification") if isinstance(memory_snapshot.get("recommendation_classification"), dict) else None
    if recommendation is None:
        recommendation = _resolve_recommendation_classification(db, analysis)
    recommendation_code = str(recommendation.get("code") or "").strip().lower()
    financial_impact = _resolve_financial_impact(analysis)
    recommended_limit = _resolve_recommended_limit_from_memory(analysis)
    matrix_amount: Decimal | None = None
    decision_basis: str | None = None

    if recommendation_code == "maintain_current_limit" or (financial_impact is not None and financial_impact == Decimal("0")):
        matrix_amount = Decimal("0")
        decision_basis = "manutenção do limite atual · impacto R$ 0"
    elif financial_impact is not None and financial_impact > Decimal("0"):
        matrix_amount = financial_impact
        decision_basis = f"aumento de limite · impacto R$ {int(financial_impact):,}".replace(",", ".")
    elif financial_impact is not None and financial_impact < Decimal("0"):
        if recommended_limit is not None:
            matrix_amount = recommended_limit
        decision_basis = f"redução de limite · impacto R$ {int(abs(financial_impact)):,}".replace(",", ".")
    elif recommended_limit is not None:
        matrix_amount = recommended_limit
        decision_basis = f"base canônica de decisão · valor R$ {int(recommended_limit):,}".replace(",", ".")

    if matrix_amount is not None and matrix_amount == Decimal("0"):
        decision_basis = "manutenção do limite atual · impacto R$ 0"

    preview_resolution = resolve_credit_workflow_action(
        db,
        current,
        action="approve",
        analysis=None,
        requested_amount=matrix_amount if matrix_amount is not None else None,
        business_unit=business_unit,
    )
    if not required_roles:
        context_roles = preview_resolution.workflow_context.get("applicable_roles")
        if isinstance(context_roles, list):
            required_roles = [str(role) for role in context_roles if str(role).strip()]

    if status_value == "approved":
        flow_state = "approved"
        display_status = "Aprovado"
        display_stage = "Aprovação concluída"
        display_title = "Aprovação concluída"
        display_message = "Decisão final registrada."
    elif status_value == "rejected":
        flow_state = "rejected"
        display_status = "Rejeitado"
        display_stage = "Aprovação concluída"
        display_title = "Aprovação concluída"
        display_message = "Solicitação rejeitada na alçada."
    elif returned_event is not None:
        flow_state = "request_changes"
        display_status = "Devolvido para ajustes"
        display_stage = "Retornado para análise"
        display_title = "Retornado para análise"
        display_message = "A solicitação foi devolvida para ajustes."
    elif status_value == "in_approval":
        flow_state = "in_approval"
        display_status = "Aguardando aprovação"
        display_stage = "Em aprovação"
        display_title = "Em aprovação"
        display_message = "Aguardando decisão da alçada."
    elif analysis.submitted_for_approval_at is None:
        flow_state = "not_submitted"
        display_status = "Ainda não enviado para aprovação"
        display_stage = "Aguardando envio para aprovação"
        display_title = "Prévia da alçada"
        if preview_resolution.applicable_doa_code and preview_resolution.applicable_doa_range:
            display_message = "Aguardando envio para aprovação."
        else:
            display_message = "Será definida após a submissão do dossiê."
    else:
        flow_state = "in_approval"
        display_status = "Em aprovação"
        display_stage = "Aguardando próxima decisão"
        display_title = "Em aprovação"
        display_message = "Aguardando próxima decisão da alçada."

    predicted_doa_code = preview_resolution.applicable_doa_code if flow_state == "not_submitted" else None
    predicted_doa_range = preview_resolution.applicable_doa_range if flow_state == "not_submitted" else None

    approver_status = (
        "predicted"
        if flow_state == "not_submitted"
        else "pending"
        if flow_state in {"in_approval", "request_changes"}
        else "approved"
        if flow_state == "approved"
        else "rejected"
    )
    predicted_approvers: list[dict] = []
    for index, role_code in enumerate(required_roles, start=1):
        role_users = resolve_users_for_role(role_code)
        if role_users:
            for user_item in role_users:
                predicted_approvers.append(
                    {
                        "role": role_code,
                        "role_label": role_label_from_code(role_code),
                        "user_id": user_item["user_id"],
                        "user_name": user_item["user_name"],
                        "user_email": user_item["user_email"],
                        "sequence": index,
                        "status": approver_status,
                    }
                )
        else:
            predicted_approvers.append(
                {
                    "role": role_code,
                    "role_label": role_label_from_code(role_code),
                    "user_id": None,
                    "user_name": None,
                    "user_email": None,
                    "sequence": index,
                    "status": approver_status,
                }
            )

    expected_approvers = list(predicted_approvers)
    pending_approvers = [item for item in predicted_approvers if item.get("status") == "pending"]
    approved_approvers: list[dict] = []
    rejected_approvers: list[dict] = []
    returned_approvers: list[dict] = []
    flow_events: list[dict] = []
    flow_steps: list[dict] = []

    for event in events:
        normalized_type = event_type_labels.get(event.event_type)
        if normalized_type is None:
            continue
        payload = event.event_payload_json if isinstance(event.event_payload_json, dict) else {}
        event_item = {
            "event_type": normalized_type,
            "timestamp": event.created_at,
            "actor_name": event.actor_name,
            "actor_role": payload.get("new_owner_role") or payload.get("previous_owner_role") or "aprovador",
            "comment": payload.get("justification"),
        }
        flow_events.append(event_item)
        if normalized_type == "approved":
            approved_approvers.append(event_item)
        elif normalized_type == "rejected":
            rejected_approvers.append(event_item)
        elif normalized_type == "request_changes":
            returned_approvers.append(event_item)

    if flow_state == "not_submitted":
        flow_steps.append(
            {
                "status": "not_submitted",
                "label": "Prévia de aprovação",
                "timestamp": None,
                "actor_name": None,
                "actor_role": None,
                "comment": None,
            }
        )
    if flow_state == "in_approval":
        for pending in pending_approvers:
            flow_steps.append(
                {
                    "status": "pending",
                    "label": "Aguardando aprovação",
                    "timestamp": None,
                    "actor_name": pending.get("user_name"),
                    "actor_role": pending.get("role_label") or pending.get("role"),
                    "comment": None,
                }
            )
    for event_item in flow_events:
        if event_item["event_type"] == "submitted_for_approval":
            flow_steps.append(
                {
                    "status": "submitted",
                    "label": "Submetida para aprovação",
                    "timestamp": event_item["timestamp"],
                    "actor_name": event_item["actor_name"],
                    "actor_role": event_item["actor_role"],
                    "comment": event_item["comment"],
                }
            )
        if event_item["event_type"] == "approved":
            flow_steps.append(
                {
                    "status": "approved",
                    "label": "Aprovado",
                    "timestamp": event_item["timestamp"],
                    "actor_name": event_item["actor_name"],
                    "actor_role": event_item["actor_role"],
                    "comment": event_item["comment"],
                }
            )
        if event_item["event_type"] == "rejected":
            flow_steps.append(
                {
                    "status": "rejected",
                    "label": "Rejeitado",
                    "timestamp": event_item["timestamp"],
                    "actor_name": event_item["actor_name"],
                    "actor_role": event_item["actor_role"],
                    "comment": event_item["comment"],
                }
            )
        if event_item["event_type"] == "request_changes":
            flow_steps.append(
                {
                    "status": "request_changes",
                    "label": "Devolvido para ajustes",
                    "timestamp": event_item["timestamp"],
                    "actor_name": event_item["actor_name"],
                    "actor_role": event_item["actor_role"],
                    "comment": event_item["comment"],
                }
            )

    return CreditAnalysisApprovalFlowSummary(
        analysis_id=analysis.id,
        current_status=status_value,
        status_label=_status_label(status_value),
        workflow_stage=workflow_stage,
        applicable_doa_code=approval_resolution.applicable_doa_code,
        applicable_doa_range=approval_resolution.applicable_doa_range,
        available_actions=sorted(set(available_actions)),
        current_owner_user_id=analysis.current_owner_user_id,
        current_owner_role=analysis.current_owner_role,
        submitted_for_approval_at=analysis.submitted_for_approval_at,
        approved_at=analysis.approved_at,
        rejected_at=analysis.rejected_at,
        returned_for_revision_at=returned_for_revision_at,
        last_decision_event_at=max(relevant_decision_events) if relevant_decision_events else None,
        completed_steps=completed_steps,
        pending_steps=pending_steps,
        required_approval_roles=required_roles,
        sequential_approval_mode=len(required_roles) > 1,
        sequential_approval_note=sequential_note,
        approval_flow_state=flow_state,
        display_status=display_status,
        display_stage=display_stage,
        decision_actor_name=decision_actor_name,
        decision_actor_role=decision_actor_role,
        predicted_doa_code=predicted_doa_code,
        predicted_doa_range=predicted_doa_range,
        matrix_amount=matrix_amount if flow_state == "not_submitted" else None,
        decision_basis=decision_basis if flow_state == "not_submitted" else None,
        predicted_approvers=predicted_approvers,
        flow_state=flow_state,
        expected_approvers=expected_approvers,
        pending_approvers=pending_approvers,
        approved_approvers=approved_approvers,
        rejected_approvers=rejected_approvers,
        returned_approvers=returned_approvers,
        events=flow_events,
        steps=flow_steps,
        display_title=display_title,
        display_message=display_message,
    )


def _current_status_value(analysis: CreditAnalysis) -> str:
    if analysis.final_decision is not None:
        return "approved" if analysis.final_decision.value == "approved" else "rejected"
    if analysis.analysis_status == AnalysisStatus.IN_PROGRESS and analysis.motor_result is not None:
        return "in_approval"
    if analysis.analysis_status == AnalysisStatus.CREATED:
        return "pending"
    return "in_progress"


def _resolve_monitor_requested_limit(analysis: CreditAnalysis) -> Decimal | None:
    if analysis.requested_limit is not None and analysis.requested_limit > Decimal("0"):
        return analysis.requested_limit
    if analysis.suggested_limit is not None and analysis.suggested_limit > Decimal("0"):
        return analysis.suggested_limit
    if analysis.final_limit is not None and analysis.final_limit > Decimal("0"):
        return analysis.final_limit
    return analysis.requested_limit


def _to_decimal_or_none(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
        return parsed
    except Exception:
        return None


def _resolve_monitor_requested_limit_with_legacy_context(
    analysis: CreditAnalysis,
    *,
    triage_data: dict,
    audit_metadata: dict | None,
) -> Decimal | None:
    direct = _resolve_monitor_requested_limit(analysis)
    if direct is not None and direct > Decimal("0"):
        return direct

    if isinstance(triage_data, dict):
        for key in ("requested_limit", "suggested_limit"):
            candidate = _to_decimal_or_none(triage_data.get(key))
            if candidate is not None and candidate > Decimal("0"):
                return candidate

    if isinstance(audit_metadata, dict):
        for key in ("requested_limit", "suggested_limit"):
            candidate = _to_decimal_or_none(audit_metadata.get(key))
            if candidate is not None and candidate > Decimal("0"):
                return candidate

    return direct


def _resolve_recommended_limit_from_memory(analysis: CreditAnalysis) -> Decimal | None:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    classification = memory.get("recommendation_classification") if isinstance(memory.get("recommendation_classification"), dict) else {}
    raw_final = classification.get("final_suggested_limit") if isinstance(classification, dict) else None
    if raw_final is not None:
        parsed = _to_decimal_or_none(raw_final)
        if parsed is not None:
            return parsed
    if isinstance(classification, dict) and classification.get("code") == "maintain_current_limit":
        raw_current = classification.get("current_approved_limit")
        parsed_current = _to_decimal_or_none(raw_current)
        if parsed_current is not None and parsed_current > Decimal("0"):
            return parsed_current
    if (
        analysis.current_limit is not None
        and analysis.current_limit > Decimal("0")
        and analysis.requested_limit is not None
        and analysis.requested_limit > analysis.current_limit
        and analysis.suggested_limit is not None
        and analysis.suggested_limit <= Decimal("0")
    ):
        # Fallback para manter semÃ¢ntica de manutenÃ§Ã£o quando memÃ³ria/classificaÃ§Ã£o
        # ainda nÃ£o foi persistida no registro.
        return analysis.current_limit
    return analysis.suggested_limit


def _resolve_financial_impact(analysis: CreditAnalysis) -> Decimal | None:
    recommended = _resolve_recommended_limit_from_memory(analysis)
    if recommended is None:
        return None
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    classification = memory.get("recommendation_classification") if isinstance(memory.get("recommendation_classification"), dict) else {}
    if isinstance(classification, dict):
        parsed_impact = _to_decimal_or_none(classification.get("financial_impact"))
        if parsed_impact is not None:
            return parsed_impact
        parsed_current = _to_decimal_or_none(classification.get("current_approved_limit"))
        if parsed_current is not None:
            return recommended - parsed_current
    if analysis.current_limit is None:
        return None
    return recommended - analysis.current_limit


def _clamp_journey_step(step: int | None) -> int | None:
    if step is None:
        return None
    return max(2, min(4, int(step)))


def _get_journey_progress(analysis: CreditAnalysis) -> tuple[int | None, int | None]:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    raw_progress = memory.get("journey_progress")
    progress = raw_progress if isinstance(raw_progress, dict) else {}
    current = _clamp_journey_step(progress.get("current_journey_step")) if progress else None
    raw_last = progress.get("last_completed_journey_step") if progress else None
    last = max(1, min(4, int(raw_last))) if isinstance(raw_last, int) else None
    return current, last


def _set_journey_progress(analysis: CreditAnalysis, *, current_step: int | None, last_completed_step: int | None) -> None:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    progress = memory.get("journey_progress") if isinstance(memory.get("journey_progress"), dict) else {}
    if current_step is not None:
        progress["current_journey_step"] = _clamp_journey_step(current_step)
    if last_completed_step is not None:
        progress["last_completed_journey_step"] = max(1, min(4, int(last_completed_step)))
    memory["journey_progress"] = progress
    analysis.decision_memory_json = memory


def _merge_workspace_state(analysis: CreditAnalysis, patch: dict) -> None:
    if not isinstance(patch, dict):
        return
    base_memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    memory = dict(base_memory)
    current_state = memory.get("workspace_state")
    workspace_state = current_state if isinstance(current_state, dict) else {}
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(workspace_state.get(key), dict):
            merged = dict(workspace_state.get(key) or {})
            merged.update(value)
            workspace_state[key] = merged
        else:
            workspace_state[key] = value
    memory["workspace_state"] = workspace_state
    analysis.decision_memory_json = memory


def _derive_journey_step_from_state(db: Session, analysis: CreditAnalysis) -> int:
    if analysis.final_decision is not None or analysis.analysis_status == AnalysisStatus.COMPLETED:
        return 4
    if analysis.submitted_for_approval_at is not None or analysis.motor_result is not None:
        return 4

    has_score = db.scalar(select(ScoreResult.id).where(ScoreResult.credit_analysis_id == analysis.id).limit(1)) is not None
    has_external_data = db.scalar(select(ExternalDataEntry.id).where(ExternalDataEntry.credit_analysis_id == analysis.id).limit(1)) is not None
    has_documents = db.scalar(select(AnalysisDocument.id).where(AnalysisDocument.credit_analysis_id == analysis.id).limit(1)) is not None

    if has_score or (analysis.analyst_notes or "").strip():
        return 3
    if has_external_data or has_documents:
        return 2
    return 2


def _resolve_persisted_journey_step(db: Session, analysis: CreditAnalysis) -> int:
    derived = _derive_journey_step_from_state(db, analysis)
    current, last = _get_journey_progress(analysis)
    persisted = current or _clamp_journey_step(last)
    if persisted is None:
        return derived
    return max(derived, persisted)


def _attach_journey_progress_fields(db: Session, analysis: CreditAnalysis) -> None:
    current, last = _get_journey_progress(analysis)
    derived = _derive_journey_step_from_state(db, analysis)
    resolved = max(current or 0, derived)
    setattr(analysis, "current_journey_step", resolved)
    setattr(analysis, "last_completed_journey_step", last if last is not None else max(1, resolved - 1))


def _attach_available_actions_field(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    bu_name = resolve_analysis_business_unit(db, analysis)
    setattr(
        analysis,
        "available_actions",
        resolve_credit_workflow_available_actions(db, current, analysis=analysis, business_unit=bu_name),
    )


def _attach_technical_dossier_status_field(analysis: CreditAnalysis) -> None:
    setattr(analysis, "technical_dossier_status", resolve_technical_dossier_status(analysis))


def _extract_coface_coverage_limit(analysis: CreditAnalysis, db: Session, customer: Customer | None) -> Decimal | None:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    report_links = memory.get("report_links") if isinstance(memory.get("report_links"), dict) else {}
    coface_link = report_links.get("coface") if isinstance(report_links.get("coface"), dict) else {}
    read_id = coface_link.get("read_id") if isinstance(coface_link.get("read_id"), int) else None

    read: CreditReportRead | None = db.get(CreditReportRead, int(read_id)) if read_id else None
    if read is None and customer is not None and customer.document_number:
        read = db.scalar(
            select(CreditReportRead)
            .where(
                CreditReportRead.customer_document_number == customer.document_number,
                CreditReportRead.source_type == "coface",
                CreditReportRead.status.in_(["valid", "valid_with_warnings"]),
            )
            .order_by(CreditReportRead.id.desc())
            .limit(1)
        )
    if read is None or not isinstance(read.read_payload_json, dict):
        return None

    coface_payload = read.read_payload_json.get("coface")
    if not isinstance(coface_payload, dict):
        return None
    amount = coface_payload.get("decision_amount")
    try:
        value = Decimal(str(amount))
    except Exception:
        return None
    if value <= Decimal("0"):
        return None
    return value


def _resolve_current_approved_limit(db: Session, customer: Customer | None) -> Decimal | None:
    if customer is None or not customer.document_number:
        return None

    latest_run_id = db.scalar(
        select(ArAgingImportRun.id)
        .join(ArAgingDataTotalRow, ArAgingDataTotalRow.import_run_id == ArAgingImportRun.id)
        .where(
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
        )
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )
    if latest_run_id is not None:
        approved_from_total = db.scalar(
            select(func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["approved_credit_amount"].astext.cast(Numeric(18, 2))), 0))
            .where(
                ArAgingDataTotalRow.import_run_id == latest_run_id,
                ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
            )
        )
        if approved_from_total is not None and approved_from_total > Decimal("0"):
            return approved_from_total

    portfolio = _build_portfolio_row_for_cnpj(db, normalized_cnpj=customer.document_number, has_all_scope=True)
    approved_from_group = portfolio[6] if len(portfolio) > 6 else None
    if approved_from_group is not None and approved_from_group > Decimal("0"):
        return approved_from_group
    return None


def _attach_recommendation_classification(db: Session, analysis: CreditAnalysis) -> None:
    classification = _resolve_recommendation_classification(db, analysis)
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    updated_memory = dict(memory)
    updated_memory["recommendation_classification"] = classification
    analysis.decision_memory_json = updated_memory


def _resolve_recommendation_classification(db: Session, analysis: CreditAnalysis) -> dict[str, object]:
    customer = db.get(Customer, analysis.customer_id)
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    triage = memory.get("triage_submission") if isinstance(memory.get("triage_submission"), dict) else {}
    current_approved_limit = _resolve_current_approved_limit(db, customer)
    source_value = triage.get("source")
    is_existing_customer = (
        source_value == "cliente_existente_carteira"
        or (current_approved_limit is not None and current_approved_limit > Decimal("0"))
    )

    return classify_recommendation(
        requested_limit=analysis.requested_limit,
        engine_recommended_limit=analysis.suggested_limit,
        coface_coverage_limit=_extract_coface_coverage_limit(analysis, db, customer),
        current_approved_limit=current_approved_limit,
        is_existing_customer=is_existing_customer,
        motor_result=analysis.motor_result,
    )


def _enforce_technical_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    allowed_bu_names = get_user_allowed_business_units(db, current)
    has_all_scope = user_has_all_bu_scope(current)
    analysis_bu = resolve_analysis_business_unit(db, analysis)
    assert_bu_in_scope(allowed_bu_names, analysis_bu, has_all_scope=has_all_scope)

    visibility_checks = [
        resolve_credit_workflow_action(db, current, action="access_workspace", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="continue_analysis", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="submit_approval", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="approve", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="reject", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="request_changes", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="return_to_analysis", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="view_dossier", analysis=analysis, business_unit=analysis_bu).allowed,
        resolve_credit_workflow_action(db, current, action="view_result", analysis=analysis, business_unit=analysis_bu).allowed,
    ]
    if any(visibility_checks):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="UsuÃ¡rio sem autorizaÃ§Ã£o explÃ­cita para acessar esta etapa tÃ©cnica do workflow.",
    )


def _enforce_detail_read_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    if _has_any_permission(current, "credit_request_view_bu", "scope:all_bu"):
        allowed_bu_names = get_user_allowed_business_units(db, current)
        has_all_scope = user_has_all_bu_scope(current)
        analysis_bu = resolve_analysis_business_unit(db, analysis)
        assert_bu_in_scope(allowed_bu_names, analysis_bu, has_all_scope=has_all_scope)
        return
    _enforce_technical_access_or_403(db, current, analysis)


def _analysis_documents_storage_root() -> Path:
    root = Path(__file__).resolve().parents[2] / "data" / "analysis_documents"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _is_step1_editable(analysis: CreditAnalysis) -> bool:
    return analysis.analysis_status == AnalysisStatus.CREATED and analysis.current_owner_role == "comercial_solicitante"


def _enforce_step1_editable_or_409(analysis: CreditAnalysis) -> None:
    if _is_step1_editable(analysis):
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Esta solicitaÃ§Ã£o jÃ¡ foi submetida para anÃ¡lise e nÃ£o pode ser alterada nesta etapa.",
    )



def _enforce_step1_requester_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    allowed_bu_names = get_user_allowed_business_units(db, current)
    has_all_scope = user_has_all_bu_scope(current)
    analysis_bu = resolve_analysis_business_unit(db, analysis)
    assert_bu_in_scope(allowed_bu_names, analysis_bu, has_all_scope=has_all_scope)

    current_email = (current.user.email or "").strip().lower()
    if (
        analysis.current_owner_role == "comercial_solicitante"
        and analysis.current_owner_user_id == current.user.id
        and analysis.analysis_status == AnalysisStatus.CREATED
    ):
        return

    draft_audit_by_user = db.scalar(
        select(AuditLog.id).where(
            AuditLog.resource == "credit_analysis",
            AuditLog.resource_id == str(analysis.id),
            AuditLog.action == "credit_request_draft_create",
            AuditLog.actor_user_id == current.user.id,
        ).limit(1)
    )
    if draft_audit_by_user and analysis.analysis_status == AnalysisStatus.CREATED:
        return

    triage_audit = db.scalar(
        select(AuditLog).where(
            AuditLog.resource == "credit_analysis",
            AuditLog.resource_id == str(analysis.id),
            AuditLog.action == "credit_request_triage_submit",
        ).order_by(AuditLog.id.desc())
    )
    metadata = triage_audit.metadata_json if triage_audit and isinstance(triage_audit.metadata_json, dict) else None
    requested_by = str((metadata or {}).get("requested_by") or "").strip().lower() if metadata else ""
    if requested_by and requested_by == current_email and analysis.analysis_status == AnalysisStatus.CREATED:
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Usu?rio sem autoriza??o expl?cita para acessar esta etapa t?cnica do workflow.",
    )


def _enforce_step1_read_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    try:
        _enforce_step1_requester_access_or_403(db, current, analysis)
        return
    except HTTPException as exc:
        if exc.status_code != status.HTTP_403_FORBIDDEN:
            raise
    _enforce_technical_access_or_403(db, current, analysis)

def _normalize_document_status(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"pendente", "enviado", "aprovado", "rejeitado"}:
        return normalized
    return "enviado"


def _is_valid_email(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    return "@" in normalized and "." in normalized.split("@")[-1]


@router.post("/triage", response_model=CreditAnalysisTriageResponse, status_code=status.HTTP_200_OK)
def triage_credit_analysis(
    payload: CreditAnalysisTriageRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisTriageResponse:
    _require_can_create_credit_request_or_403(db, current)
    normalized_cnpj = _normalize_cnpj_or_400(payload.cnpj)
    bu_context = resolve_business_unit_context(db, current, None)

    portfolio_row = _build_portfolio_row_for_cnpj(
        db,
        normalized_cnpj=normalized_cnpj,
        allowed_bu_names=bu_context.effective_bu_names,
        has_all_scope=bu_context.has_all_scope,
    )

    resolved_bu_name = _resolve_scoped_bu_name(db, current, portfolio_row[1])
    found_in_portfolio = bool(portfolio_row[0] and resolved_bu_name)
    existing_customer = db.scalar(select(Customer).where(Customer.document_number == normalized_cnpj))
    recent_analysis = _find_recent_analysis(db, customer_id=existing_customer.id) if existing_customer else None
    reanalysis_available_at = None
    last_analysis_payload = None
    has_recent_analysis = recent_analysis is not None
    if recent_analysis:
        reanalysis_available_at = recent_analysis.created_at + timedelta(days=REANALYSIS_COOLDOWN_DAYS)
        last_analysis_payload = {
            "analysis_id": recent_analysis.id,
            "date": recent_analysis.created_at,
            "status": recent_analysis.analysis_status.value,
            "approved_limit": recent_analysis.final_limit,
            "analyst_name": recent_analysis.assigned_analyst_name,
        }

    scoped_bus = _list_user_business_units(db, current)
    bu_options = [{"id": bu.id, "code": bu.code, "name": bu.name} for bu in scoped_bus]

    if found_in_portfolio:
        mapped = _build_customer_from_portfolio_row(normalized_cnpj, portfolio_row)
        return CreditAnalysisTriageResponse(
            found_in_portfolio=True,
            customer_data={
                "customer_id": existing_customer.id if existing_customer else None,
                "company_name": mapped["company_name"],
                "cnpj": normalized_cnpj,
                "economic_group": mapped["economic_group"],
                "business_unit": mapped["business_unit"],
            },
            economic_position={
                "open_amount": mapped["open_amount"],
                "overdue_amount": mapped["overdue_amount"],
                "not_due_amount": mapped["not_due_amount"],
                "total_limit": mapped["total_limit"],
                "available_limit": mapped["available_limit"],
                "base_date": mapped["base_date"],
            },
            has_recent_analysis=has_recent_analysis,
            last_analysis=last_analysis_payload,
            reanalysis_available_at=reanalysis_available_at,
            requires_early_review_justification=has_recent_analysis,
            requires_business_unit_selection=False,
            available_business_units=bu_options,
            message="Cliente localizado na carteira. Revise a posicao economica antes de solicitar a revisao do limite.",
        )

    external_result = fetch_external_cnpj_data(normalized_cnpj)
    external_data = external_result.data
    if external_result.status != "ok" or external_data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=external_result.message or "Cliente nao localizado na carteira e a consulta externa nao retornou dados.",
        )

    address = _ext_get(external_data, "address")
    city = _ext_get(address, "municipio") if address is not None else None
    uf = _ext_get(address, "uf") if address is not None else None
    company_name = _ext_get(external_data, "razao_social")
    serialized_external = external_data.model_dump() if hasattr(external_data, "model_dump") else external_data

    default_new_customer_bu = scoped_bus[0].name if len(scoped_bus) == 1 else None
    return CreditAnalysisTriageResponse(
        found_in_portfolio=False,
        customer_data={
            "customer_id": existing_customer.id if existing_customer else None,
            "company_name": company_name,
            "cnpj": normalized_cnpj,
            "business_unit": default_new_customer_bu,
            "city": city,
            "uf": uf,
        },
        external_lookup_data=serialized_external,
        has_recent_analysis=has_recent_analysis,
        last_analysis=last_analysis_payload,
        reanalysis_available_at=reanalysis_available_at,
        requires_early_review_justification=has_recent_analysis,
        requires_business_unit_selection=len(scoped_bus) > 1,
        available_business_units=bu_options,
        message="Cliente nÃ£o localizado na carteira atual. Os dados cadastrais foram preenchidos com base na consulta externa.",
    )


@router.get("/check-existing", response_model=CreditAnalysisExistingCheckResponse, status_code=status.HTTP_200_OK)
def check_existing_credit_analysis(
    cnpj: str,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisExistingCheckResponse:
    _require_can_create_credit_request_or_403(db, current)
    normalized_cnpj = _normalize_cnpj_or_400(cnpj)
    customer = db.scalar(select(Customer).where(Customer.document_number == normalized_cnpj))
    if customer is None:
        return CreditAnalysisExistingCheckResponse(
            cnpj=normalized_cnpj,
            has_existing_analysis=False,
            state="none",
            message="Nenhuma análise anterior encontrada para este cliente.",
        )

    latest_analysis = None
    for candidate in db.scalars(
        select(CreditAnalysis)
        .where(CreditAnalysis.customer_id == customer.id)
        .order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
    ).all():
        if _is_step1_draft(candidate):
            continue
        latest_analysis = candidate
        break
    if latest_analysis is None:
        return CreditAnalysisExistingCheckResponse(
            cnpj=normalized_cnpj,
            has_existing_analysis=False,
            state="none",
            message="Nenhuma análise anterior encontrada para este cliente.",
        )

    if latest_analysis.analysis_status in {AnalysisStatus.CREATED, AnalysisStatus.IN_PROGRESS}:
        return CreditAnalysisExistingCheckResponse(
            cnpj=normalized_cnpj,
            has_existing_analysis=True,
            state="in_progress",
            analysis_id=latest_analysis.id,
            analysis_status=latest_analysis.analysis_status.value,
            message="Já existe uma solicitação de crédito em andamento para este cliente. Acompanhe a análise pelo Monitor de Solicitações.",
        )

    if latest_analysis.final_decision in {FinalDecision.APPROVED, FinalDecision.REJECTED}:
        decision_date = _resolve_decision_date(latest_analysis)
        if decision_date is not None:
            now_utc = datetime.now(timezone.utc)
            days_since_decision = (now_utc.date() - decision_date.date()).days
            next_allowed = decision_date + timedelta(days=REANALYSIS_COOLDOWN_DAYS)
            if days_since_decision < REANALYSIS_COOLDOWN_DAYS:
                return CreditAnalysisExistingCheckResponse(
                    cnpj=normalized_cnpj,
                    has_existing_analysis=True,
                    state="recently_completed",
                    analysis_id=latest_analysis.id,
                    analysis_status=latest_analysis.final_decision.value,
                    decision_date=decision_date,
                    days_since_decision=days_since_decision,
                    next_allowed_date=next_allowed,
                    message="Este cliente já possui uma análise concluída nos últimos 90 dias. Uma nova solicitação não pode ser aberta neste período.",
                )
            return CreditAnalysisExistingCheckResponse(
                cnpj=normalized_cnpj,
                has_existing_analysis=True,
                state="completed_expired",
                analysis_id=latest_analysis.id,
                analysis_status=latest_analysis.final_decision.value,
                decision_date=decision_date,
                days_since_decision=days_since_decision,
                next_allowed_date=next_allowed,
                message="Última análise concluída há mais de 90 dias.",
            )

    return CreditAnalysisExistingCheckResponse(
        cnpj=normalized_cnpj,
        has_existing_analysis=True,
        state="none",
        analysis_id=latest_analysis.id,
        analysis_status=latest_analysis.analysis_status.value,
        message="Nenhum bloqueio de governança identificado para este cliente.",
    )


@router.post("/draft", response_model=CreditAnalysisDraftCreateResponse, status_code=status.HTTP_201_CREATED)
def create_credit_analysis_draft(
    payload: CreditAnalysisDraftCreateRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisDraftCreateResponse:
    _require_can_create_credit_request_or_403(db, current)
    normalized_cnpj = _normalize_cnpj_or_400(payload.cnpj)
    source = (payload.source or "").strip().lower()
    if source not in {"portfolio", "external", "manual"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Origem da solicitaÃ§Ã£o invÃ¡lida.")

    customer = db.scalar(select(Customer).where(Customer.document_number == normalized_cnpj))
    if customer is not None:
        reusable_draft = _find_user_active_draft_for_customer(
            db,
            user_id=current.user.id,
            customer_id=customer.id,
        )
        if reusable_draft is not None:
            return CreditAnalysisDraftCreateResponse(
                analysis_id=reusable_draft.id,
                customer_id=customer.id,
                status=reusable_draft.analysis_status.value,
                cnpj=normalized_cnpj,
                reused_existing=True,
            )

        latest_analysis = None
        for candidate in db.scalars(
            select(CreditAnalysis)
            .where(CreditAnalysis.customer_id == customer.id)
            .order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
        ).all():
            if _is_step1_draft(candidate):
                continue
            latest_analysis = candidate
            break

        if latest_analysis and latest_analysis.analysis_status in {AnalysisStatus.CREATED, AnalysisStatus.IN_PROGRESS}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="JÃ¡ existe uma solicitaÃ§Ã£o de crÃ©dito em andamento para este cliente.",
            )
        if latest_analysis and latest_analysis.final_decision in {FinalDecision.APPROVED, FinalDecision.REJECTED}:
            decision_date = _resolve_decision_date(latest_analysis)
            if decision_date is not None:
                days_since_decision = (datetime.now(timezone.utc).date() - decision_date.date()).days
                if days_since_decision < REANALYSIS_COOLDOWN_DAYS:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Este cliente jÃ¡ possui uma anÃ¡lise concluÃ­da nos Ãºltimos 90 dias.",
                    )

    if customer is None:
        customer = Customer(
            company_name=(payload.customer_name or "Cliente sem razÃ£o social").strip(),
            document_number=normalized_cnpj,
            segment="nao_informado",
            region="nao_informado",
            relationship_start_date=None,
        )
        db.add(customer)
        db.flush()
    elif payload.customer_name and not customer.company_name:
        customer.company_name = payload.customer_name.strip()

    selected_bu_name = (payload.business_unit or "").strip() or None
    if selected_bu_name:
        allowed_bu_names = get_user_allowed_business_units(db, current)
        has_all_scope = user_has_all_bu_scope(current)
        assert_bu_in_scope(allowed_bu_names, selected_bu_name, has_all_scope=has_all_scope)

    now_utc = datetime.now(timezone.utc)
    analysis = CreditAnalysis(
        customer_id=customer.id,
        protocol_number=generate_protocol_number(db),
        requested_limit=Decimal("0"),
        current_limit=Decimal("0"),
        exposure_amount=Decimal("0"),
        annual_revenue_estimated=Decimal("0"),
        suggested_limit=Decimal("0"),
        assigned_analyst_name=None,
        current_owner_user_id=current.user.id,
        current_owner_role="comercial_solicitante",
        assigned_at=now_utc,
        current_stage_started_at=now_utc,
        decision_memory_json={
            "triage_submission": {
                "source": source,
                "business_unit": selected_bu_name,
                "economic_group": payload.economic_group,
                "draft_created_from_step1": True,
            }
        },
    )
    db.add(analysis)
    db.flush()
    transition = resolve_credit_workflow_transition(
        db,
        current,
        analysis,
        action="create_request",
        payload={"justification": "Rascunho criado a partir da consulta de CNPJ."},
    )
    if not transition.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=transition.workflow_context.get("denial_reason") or "Sem permissao para criar solicitacao.")
    db.add(
        AuditLog(
            actor_user_id=current.user.id,
            action="credit_request_draft_create",
            resource="credit_analysis",
            resource_id=str(analysis.id),
            metadata_json={
                "requested_by": current.user.email,
                "cnpj": normalized_cnpj,
                "source": source,
                "analysis_id": analysis.id,
                "business_unit": selected_bu_name,
            },
            notes="Rascunho criado para preenchimento da etapa inicial.",
        )
    )
    db.commit()
    db.refresh(analysis)
    return CreditAnalysisDraftCreateResponse(
        analysis_id=analysis.id,
        customer_id=customer.id,
        status=analysis.analysis_status.value,
        cnpj=normalized_cnpj,
        reused_existing=False,
    )


def _triage_submission_from_memory(analysis: CreditAnalysis) -> dict:
    if not isinstance(analysis.decision_memory_json, dict):
        return {}
    payload = analysis.decision_memory_json.get("triage_submission")
    return payload if isinstance(payload, dict) else {}


def _is_step1_draft(analysis: CreditAnalysis) -> bool:
    triage_submission = _triage_submission_from_memory(analysis)
    return bool(
        analysis.analysis_status == AnalysisStatus.CREATED
        and analysis.current_owner_role == "comercial_solicitante"
        and triage_submission.get("draft_created_from_step1") is True
    )


def _is_draft_expired(analysis: CreditAnalysis, *, now_utc: datetime | None = None) -> bool:
    if not _is_step1_draft(analysis):
        return False
    reference = now_utc or datetime.now(timezone.utc)
    return analysis.created_at < (reference - timedelta(hours=DRAFT_TTL_HOURS))


def _is_active_step1_draft(analysis: CreditAnalysis, *, now_utc: datetime | None = None) -> bool:
    return _is_step1_draft(analysis) and not _is_draft_expired(analysis, now_utc=now_utc)


def _find_user_active_draft_for_customer(db: Session, *, user_id: int, customer_id: int) -> CreditAnalysis | None:
    candidates = db.scalars(
        select(CreditAnalysis)
        .where(CreditAnalysis.customer_id == customer_id, CreditAnalysis.analysis_status == AnalysisStatus.CREATED)
        .order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
    ).all()
    now_utc = datetime.now(timezone.utc)
    for analysis in candidates:
        if not _is_active_step1_draft(analysis, now_utc=now_utc):
            continue
        if analysis.current_owner_user_id == user_id:
            return analysis
        draft_audit_by_user = db.scalar(
            select(AuditLog.id).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_request_draft_create",
                AuditLog.actor_user_id == user_id,
            ).limit(1)
        )
        if draft_audit_by_user:
            return analysis
    return None


@router.get("/draft/recover", response_model=CreditAnalysisDraftRecoveryResponse | None, status_code=status.HTTP_200_OK)
def recover_credit_analysis_draft(
    cnpj: str,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisDraftRecoveryResponse | None:
    _require_can_create_credit_request_or_403(db, current)
    normalized_cnpj = _normalize_cnpj_or_400(cnpj)
    customer = db.scalar(select(Customer).where(Customer.document_number == normalized_cnpj))
    if customer is None:
        return None
    draft = _find_user_active_draft_for_customer(db, user_id=current.user.id, customer_id=customer.id)
    if draft is None:
        return None
    expires_at = draft.created_at + timedelta(hours=DRAFT_TTL_HOURS)
    return CreditAnalysisDraftRecoveryResponse(
        analysis_id=draft.id,
        customer_id=customer.id,
        cnpj=normalized_cnpj,
        status=draft.analysis_status.value,
        expires_at=expires_at,
    )


@router.delete("/draft/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_credit_analysis_draft(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> Response:
    _require_can_create_credit_request_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rascunho não encontrado.")
    if not _is_step1_draft(analysis):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A análise informada não é um rascunho descartável.")
    if analysis.current_owner_user_id != current.user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para descartar este rascunho.")
    try:
        db.execute(delete(AnalysisDocument).where(AnalysisDocument.credit_analysis_id == analysis.id))
        db.execute(delete(AnalysisCommercialReference).where(AnalysisCommercialReference.credit_analysis_id == analysis.id))
        db.execute(delete(AnalysisRequestMetadata).where(AnalysisRequestMetadata.credit_analysis_id == analysis.id))
        db.execute(delete(ExternalDataEntry).where(ExternalDataEntry.credit_analysis_id == analysis.id))
        db.execute(delete(DecisionEvent).where(DecisionEvent.credit_analysis_id == analysis.id))
        db.execute(delete(ScoreResult).where(ScoreResult.credit_analysis_id == analysis.id))
        db.delete(analysis)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Não foi possível descartar o rascunho.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/triage/submit", response_model=CreditAnalysisTriageSubmitResponse, status_code=status.HTTP_201_CREATED)
def submit_credit_analysis_from_triage(
    payload: CreditAnalysisTriageSubmitRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisTriageSubmitResponse:
    _require_can_create_credit_request_or_403(db, current)
    normalized_cnpj = _normalize_cnpj_or_400(payload.cnpj)
    if payload.suggested_limit <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o limite sugerido para submeter a solicitacao.")
    if payload.source not in {"cliente_existente_carteira", "cliente_novo_consulta_externa"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Origem da solicitacao invalida.")
    early_justification = (payload.early_review_justification or "").strip()
    scoped_bus = _list_user_business_units(db, current)
    scoped_bus_by_normalized = {normalize_text_key(bu.name): bu for bu in scoped_bus}
    scoped_bus_by_code = {normalize_text_key(bu.code): bu for bu in scoped_bus}

    idempotency_window_start = datetime.now(timezone.utc) - timedelta(minutes=10)
    recent_audits = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.action == "credit_request_triage_submit",
            AuditLog.actor_user_id == current.user.id,
            AuditLog.created_at >= idempotency_window_start,
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    ).all()

    for audit in recent_audits:
        metadata = audit.metadata_json or {}
        if not isinstance(metadata, dict):
            continue
        if (
            str(metadata.get("cnpj")) == normalized_cnpj
            and str(metadata.get("source")) == payload.source
            and str(metadata.get("suggested_limit")) == str(payload.suggested_limit)
            and bool(metadata.get("is_early_review_request", False)) == bool(payload.is_early_review_request)
        ):
            resource_id = metadata.get("analysis_id") or audit.resource_id
            if not resource_id:
                continue
            reused = db.get(CreditAnalysis, int(resource_id))
            if reused and reused.analysis_status in {AnalysisStatus.CREATED, AnalysisStatus.IN_PROGRESS}:
                reused_status = _resolve_operational_status(reused, [])
                reused_bu = resolve_analysis_business_unit(db, reused)
                reused_actions = resolve_credit_workflow_available_actions(db, current, analysis=reused, business_unit=reused_bu)
                return CreditAnalysisTriageSubmitResponse(
                    analysis_id=reused.id,
                    customer_id=reused.customer_id,
                    status=reused.analysis_status,
                    current_owner_user_id=reused.current_owner_user_id,
                    current_owner_role=reused.current_owner_role,
                    workflow_stage=_resolve_workflow_stage(reused_status),
                    available_actions=sorted(set(reused_actions)),
                    reused_existing=True,
                )

    customer = db.scalar(select(Customer).where(Customer.document_number == normalized_cnpj))
    if customer is None:
        customer = Customer(
            company_name=(payload.company_name or "Cliente sem razao social").strip(),
            document_number=normalized_cnpj,
            segment="nao_informado",
            region="nao_informado",
            relationship_start_date=None,
        )
        db.add(customer)
        db.flush()

    recent_analysis = _find_recent_analysis(db, customer_id=customer.id)
    if recent_analysis is not None and not payload.is_early_review_request:
        available_at = recent_analysis.created_at + timedelta(days=REANALYSIS_COOLDOWN_DAYS)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ja existe uma analise recente para este cliente. Nova solicitacao padrao disponivel em {available_at.date().isoformat()}.",
        )
    if payload.is_early_review_request:
        if len(early_justification) < MIN_EARLY_REVIEW_JUSTIFICATION_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe a justificativa para solicitar a revisao antecipada.",
            )

    selected_bu_name: str | None = None
    if payload.source == "cliente_existente_carteira":
        portfolio_bu = db.scalar(
            select(func.max(ArAgingDataTotalRow.bu_normalized)).where(ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj)
        )
        selected_bu_name = _resolve_scoped_bu_name(db, current, portfolio_bu)
        if not selected_bu_name:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cliente fora do escopo de BU do usuario.")
    else:
        if len(scoped_bus) == 1:
            selected_bu_name = scoped_bus[0].name
        else:
            raw_bu = (payload.business_unit or "").strip()
            if not raw_bu:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione a BU para criar a solicitacao de novo cliente.")
            normalized_bu = normalize_text_key(raw_bu)
            selected_bu = scoped_bus_by_normalized.get(normalized_bu) or scoped_bus_by_code.get(normalized_bu)
            if not selected_bu:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="BU informada fora do escopo permitido para o usuario.")
            selected_bu_name = selected_bu.name

    now_utc = datetime.now(timezone.utc)
    reusable_draft = _find_user_active_draft_for_customer(
        db,
        user_id=current.user.id,
        customer_id=customer.id,
    )

    triage_payload = {
        "source": payload.source,
        "is_early_review_request": payload.is_early_review_request,
        "early_review_justification": early_justification if payload.is_early_review_request else None,
        "previous_analysis_id": payload.previous_analysis_id or (recent_analysis.id if recent_analysis else None),
        "reanalysis_available_at": (
            (recent_analysis.created_at + timedelta(days=REANALYSIS_COOLDOWN_DAYS)).isoformat()
            if recent_analysis
            else None
        ),
        "has_recent_analysis": recent_analysis is not None,
        "business_unit": selected_bu_name,
        "draft_created_from_step1": False,
    }
    if reusable_draft is not None:
        analysis = reusable_draft
        analysis.requested_limit = payload.suggested_limit
        analysis.suggested_limit = payload.suggested_limit
        analysis.assigned_at = analysis.assigned_at or now_utc
        analysis.current_stage_started_at = now_utc
        memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
        memory["triage_submission"] = triage_payload
        journey_progress = memory.get("journey_progress") if isinstance(memory.get("journey_progress"), dict) else {}
        journey_progress["current_journey_step"] = 2
        journey_progress["last_completed_journey_step"] = max(int(journey_progress.get("last_completed_journey_step", 1)), 1)
        memory["journey_progress"] = journey_progress
        analysis.decision_memory_json = memory
        db.add(analysis)
        db.flush()
    else:
        analysis = CreditAnalysis(
            customer_id=customer.id,
            protocol_number=generate_protocol_number(db),
            requested_limit=payload.suggested_limit,
            current_limit=Decimal("0"),
            exposure_amount=Decimal("0"),
            annual_revenue_estimated=Decimal("0"),
            suggested_limit=payload.suggested_limit,
            assigned_analyst_name=None,
            current_owner_user_id=current.user.id,
            current_owner_role="comercial_solicitante",
            assigned_at=now_utc,
            current_stage_started_at=now_utc,
            decision_memory_json={
                "triage_submission": triage_payload,
                "journey_progress": {
                    "current_journey_step": 2,
                    "last_completed_journey_step": 1,
                },
            },
        )
        db.add(analysis)
        db.flush()
    transition = resolve_credit_workflow_transition(
        db,
        current,
        analysis,
        action="submit_request",
        payload={"justification": "Solicitacao criada e encaminhada para fila financeira."},
    )
    if not transition.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=transition.workflow_context.get("denial_reason") or "Sem permissao para submeter solicitacao.")

    db.add(
        AuditLog(
            actor_user_id=current.user.id,
            action="credit_request_triage_submit",
            resource="credit_analysis",
            resource_id=str(analysis.id),
            metadata_json={
                "requested_by": current.user.email,
                "cnpj": normalized_cnpj,
                "source": payload.source,
                "suggested_limit": str(payload.suggested_limit),
                "analysis_id": analysis.id,
                "is_early_review_request": payload.is_early_review_request,
                "business_unit": selected_bu_name,
                "early_review_justification": early_justification if payload.is_early_review_request else None,
                "previous_analysis_id": payload.previous_analysis_id or (recent_analysis.id if recent_analysis else None),
            },
            notes="Solicitacao enviada para analise financeira.",
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nao foi possivel criar a solicitacao de credito.") from exc

    db.refresh(analysis)
    status_value = _resolve_operational_status(analysis, [])
    analysis_bu = resolve_analysis_business_unit(db, analysis)
    available_actions = resolve_credit_workflow_available_actions(db, current, analysis=analysis, business_unit=analysis_bu)
    return CreditAnalysisTriageSubmitResponse(
        analysis_id=analysis.id,
        customer_id=customer.id,
        status=analysis.analysis_status,
        current_owner_user_id=analysis.current_owner_user_id,
        current_owner_role=analysis.current_owner_role,
        workflow_stage=_resolve_workflow_stage(status_value),
        available_actions=sorted(set(available_actions)),
        reused_existing=False,
    )


def _resolve_decision_date(analysis: CreditAnalysis) -> datetime | None:
    return (
        analysis.approved_at
        or analysis.rejected_at
        or analysis.completed_at
        or analysis.created_at
    )


@router.get("/{analysis_id}/request-metadata", response_model=AnalysisRequestMetadataRead)
def get_analysis_request_metadata(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AnalysisRequestMetadataRead:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_read_access_or_403(db, current, analysis)

    metadata = db.scalar(select(AnalysisRequestMetadata).where(AnalysisRequestMetadata.credit_analysis_id == analysis_id))
    return AnalysisRequestMetadataRead(
        credit_analysis_id=analysis_id,
        requested_limit=float(analysis.requested_limit) if analysis.requested_limit is not None else None,
        requested_term_days=metadata.requested_term_days if metadata else None,
        business_unit=metadata.business_unit if metadata else None,
        customer_type=metadata.customer_type if metadata else None,
        operation_modality=metadata.operation_modality if metadata else None,
        contact_name=metadata.contact_name if metadata else None,
        contact_phone=metadata.contact_phone if metadata else None,
        contact_email=metadata.contact_email if metadata else None,
        updated_at=metadata.updated_at if metadata else None,
    )


@router.put("/{analysis_id}/request-metadata", response_model=AnalysisRequestMetadataRead)
def upsert_analysis_request_metadata(
    analysis_id: int,
    payload: AnalysisRequestMetadataUpsert,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AnalysisRequestMetadataRead:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_requester_access_or_403(db, current, analysis)
    _enforce_step1_editable_or_409(analysis)

    metadata = db.scalar(select(AnalysisRequestMetadata).where(AnalysisRequestMetadata.credit_analysis_id == analysis_id))
    if metadata is None:
        metadata = AnalysisRequestMetadata(credit_analysis_id=analysis_id)
        db.add(metadata)
        db.flush()

    if payload.requested_limit is not None:
        analysis.requested_limit = Decimal(str(payload.requested_limit))
    metadata.requested_term_days = payload.requested_term_days
    metadata.business_unit = payload.business_unit
    metadata.customer_type = payload.customer_type
    metadata.operation_modality = payload.operation_modality
    metadata.contact_name = payload.contact_name
    metadata.contact_phone = payload.contact_phone
    metadata.contact_email = payload.contact_email
    metadata.updated_by_user_id = current.user.id

    db.commit()
    db.refresh(analysis)
    db.refresh(metadata)
    return AnalysisRequestMetadataRead(
        credit_analysis_id=analysis_id,
        requested_limit=float(analysis.requested_limit) if analysis.requested_limit is not None else None,
        requested_term_days=metadata.requested_term_days,
        business_unit=metadata.business_unit,
        customer_type=metadata.customer_type,
        operation_modality=metadata.operation_modality,
        contact_name=metadata.contact_name,
        contact_phone=metadata.contact_phone,
        contact_email=metadata.contact_email,
        updated_at=metadata.updated_at,
    )


@router.get("/{analysis_id}/documents", response_model=list[AnalysisDocumentRead])
def list_analysis_documents(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[AnalysisDocument]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_read_access_or_403(db, current, analysis)
    return list(
        db.scalars(
            select(AnalysisDocument)
            .where(AnalysisDocument.credit_analysis_id == analysis_id)
            .order_by(AnalysisDocument.uploaded_at.desc(), AnalysisDocument.id.desc())
        ).all()
    )


@router.post("/{analysis_id}/documents", response_model=AnalysisDocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_analysis_document(
    analysis_id: int,
    document_type: str = Form(...),
    status_value: str = Form("enviado"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AnalysisDocument:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_requester_access_or_403(db, current, analysis)
    _enforce_step1_editable_or_409(analysis)

    original_name = (file.filename or "").strip()
    if not original_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo obrigatorio.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo vazio.")

    safe_type = (document_type or "").strip().lower()
    if not safe_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de documento obrigatorio.")
    file_ext = Path(original_name).suffix
    stored_name = f"{uuid4().hex}{file_ext}"
    storage_dir = _analysis_documents_storage_root() / str(analysis_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    (storage_dir / stored_name).write_bytes(content)

    document = AnalysisDocument(
        credit_analysis_id=analysis_id,
        document_type=safe_type,
        original_filename=original_name,
        stored_filename=stored_name,
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(content),
        status=_normalize_document_status(status_value),
        uploaded_by_user_id=current.user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.delete("/{analysis_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis_document(
    analysis_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> Response:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_requester_access_or_403(db, current, analysis)
    _enforce_step1_editable_or_409(analysis)

    document = db.get(AnalysisDocument, document_id)
    if document is None or document.credit_analysis_id != analysis_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    storage_path = _analysis_documents_storage_root() / str(analysis_id) / document.stored_filename
    if storage_path.exists():
        storage_path.unlink(missing_ok=True)

    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{analysis_id}/documents/{document_id}/download")
def download_analysis_document(
    analysis_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_technical_access_or_403(db, current, analysis)

    document = db.get(AnalysisDocument, document_id)
    if document is None or document.credit_analysis_id != analysis_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    storage_path = _analysis_documents_storage_root() / str(analysis_id) / document.stored_filename
    if not storage_path.exists() or not storage_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Arquivo indisponivel no momento.",
        )

    media_type = (document.mime_type or "application/octet-stream").strip() or "application/octet-stream"
    is_inline = media_type == "application/pdf" or media_type.startswith("image/")
    content_disposition = "inline" if is_inline else "attachment"

    return FileResponse(
        path=storage_path,
        media_type=media_type,
        filename=document.original_filename,
        content_disposition_type=content_disposition,
    )


@router.get("/{analysis_id}/commercial-references", response_model=list[AnalysisCommercialReferenceRead])
def list_analysis_commercial_references(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[AnalysisCommercialReference]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_read_access_or_403(db, current, analysis)
    return list(
        db.scalars(
            select(AnalysisCommercialReference)
            .where(AnalysisCommercialReference.credit_analysis_id == analysis_id)
            .order_by(AnalysisCommercialReference.created_at.desc(), AnalysisCommercialReference.id.desc())
        ).all()
    )


@router.post(
    "/{analysis_id}/commercial-references",
    response_model=AnalysisCommercialReferenceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_analysis_commercial_reference(
    analysis_id: int,
    payload: AnalysisCommercialReferenceCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AnalysisCommercialReference:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_requester_access_or_403(db, current, analysis)
    _enforce_step1_editable_or_409(analysis)

    name = payload.name.strip()
    phone = payload.phone.strip() if payload.phone else None
    email = payload.email.strip() if payload.email else None

    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome da referÃªncia Ã© obrigatÃ³rio.")
    if not phone and not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe ao menos telefone ou e-mail da referÃªncia.",
        )
    if email and not _is_valid_email(email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail da referÃªncia Ã© invÃ¡lido.")

    reference = AnalysisCommercialReference(
        credit_analysis_id=analysis_id,
        name=name,
        phone=phone,
        email=email,
        created_by_user_id=current.user.id,
    )
    db.add(reference)
    db.commit()
    db.refresh(reference)
    return reference


@router.delete("/{analysis_id}/commercial-references/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis_commercial_reference(
    analysis_id: int,
    reference_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> Response:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_step1_requester_access_or_403(db, current, analysis)
    _enforce_step1_editable_or_409(analysis)

    reference = db.get(AnalysisCommercialReference, reference_id)
    if reference is None or reference.credit_analysis_id != analysis_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commercial reference not found.")

    db.delete(reference)
    db.commit()


@router.get("/{analysis_id}/report-reads", response_model=list[CreditAnalysisReportReadSummary])
def list_credit_analysis_report_reads(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[CreditAnalysisReportReadSummary]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_technical_access_or_403(db, current, analysis)

    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    read_ids = collect_report_read_ids_from_links(memory)

    reads: list[CreditReportRead] = []
    if read_ids:
        reads = list(
            db.scalars(
                select(CreditReportRead)
                .where(CreditReportRead.id.in_(read_ids))
                .order_by(CreditReportRead.created_at.desc(), CreditReportRead.id.desc())
            ).all()
        )

    customer = db.get(Customer, analysis.customer_id)
    if customer is not None and not reads:
        reads = list(
            db.scalars(
                select(CreditReportRead)
                .where(CreditReportRead.customer_document_number == customer.document_number)
                .order_by(CreditReportRead.created_at.desc(), CreditReportRead.id.desc())
                .limit(20)
            ).all()
        )
    summaries: list[CreditAnalysisReportReadSummary] = []
    for entry in reads:
        report_type = (
            get_agrisk_report_type_from_payload(entry.read_payload_json if isinstance(entry.read_payload_json, dict) else {})
            if entry.source_type == "agrisk"
            else None
        )
        summaries.append(CreditAnalysisReportReadSummary(
            id=entry.id,
            credit_analysis_id=analysis_id,
            analysis_document_id=resolve_analysis_document_id_for_read(memory, entry.source_type, report_type),
            source_type=entry.source_type,
            report_type=report_type,
            status=entry.status,
            original_filename=entry.original_filename,
            mime_type=entry.mime_type,
            file_size=entry.file_size,
            report_document_number=entry.report_document_number,
            is_document_match=entry.is_document_match,
            validation_message=entry.validation_message,
            warnings=entry.warnings_json or [],
            read_payload=entry.read_payload_json or {},
            created_at=entry.created_at,
        ))
    return summaries
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=CreditAnalysisRead, status_code=status.HTTP_201_CREATED)
def create_credit_analysis(
    payload: CreditAnalysisCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysis:
    _require_can_create_credit_request_or_403(db, current)
    customer = db.get(Customer, payload.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found.",
        )

    now_utc = datetime.now(timezone.utc)
    analysis = CreditAnalysis(
        **payload.model_dump(),
        protocol_number=generate_protocol_number(db),
        assigned_at=now_utc,
        current_stage_started_at=now_utc,
    )
    db.add(analysis)
    db.flush()
    transition = resolve_credit_workflow_transition(
        db,
        current,
        analysis,
        action="submit_request",
        payload={"justification": "Analise criada e encaminhada para fila financeira."},
    )
    if not transition.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=transition.workflow_context.get("denial_reason") or "Sem permissao para submeter solicitacao.")
    _enforce_technical_access_or_403(db, current, analysis)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to create credit analysis due to conflicting data.",
        ) from exc

    db.refresh(analysis)
    return analysis


@router.get("", response_model=list[CreditAnalysisRead])
def list_credit_analyses(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.requests.view"])),
) -> list[CreditAnalysis]:
    analyses = list(db.scalars(select(CreditAnalysis).order_by(CreditAnalysis.id.desc())).all())
    scoped: list[CreditAnalysis] = []
    for analysis in analyses:
        try:
            _enforce_technical_access_or_403(db, current, analysis)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_403_FORBIDDEN:
                continue
            raise
        _attach_journey_progress_fields(db, analysis)
        scoped.append(analysis)
    return scoped


@router.get("/queue", response_model=CreditAnalysisQueueResponse)
def list_credit_analyses_queue(
    q: str | None = None,
    status: str | None = None,
    bu: str | None = None,
    business_unit_context: str | None = None,
    analysis_type: str | None = None,
    requester: str | None = None,
    assigned_analyst: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisQueueResponse:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    query = select(CreditAnalysis, Customer).join(Customer, Customer.id == CreditAnalysis.customer_id)
    query = query.order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
    rows = db.execute(query).all()

    bu_context = resolve_business_unit_context(db, current, business_unit_context)
    scoped_bu_names = bu_context.effective_bu_names
    has_all_scope = bu_context.has_all_scope

    items: list[CreditAnalysisQueueItem] = []
    for analysis, customer in rows:
        if _is_step1_draft(analysis):
            continue
        portfolio = db.execute(
            select(
                func.max(ArAgingDataTotalRow.bu_normalized),
                func.max(ArAgingDataTotalRow.economic_group_normalized),
                func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
                func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["approved_credit_amount"].astext.cast(Numeric(18, 2))), 0),
                func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["exposure_amount"].astext.cast(Numeric(18, 2))), 0),
            ).where(ArAgingDataTotalRow.cnpj_normalized == customer.document_number)
        ).one()
        bu_name = portfolio[0]
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue

        external_entries = list(
            db.scalars(
                select(ExternalDataEntry).where(ExternalDataEntry.credit_analysis_id == analysis.id).order_by(ExternalDataEntry.created_at.desc())
            ).all()
        )
        external_notes = " ".join((entry.notes or "") for entry in external_entries).lower()
        has_agrisk = any(entry.source_type.value == "agrisk" for entry in external_entries)
        has_coface = "coface" in external_notes
        agrisk_status = "importado" if has_agrisk else "pendente"
        coface_status = "importado" if has_coface else "pendente"
        status_value = _resolve_operational_status(analysis, external_entries)

        triage_data = {}
        if isinstance(analysis.decision_memory_json, dict):
            triage_data = (analysis.decision_memory_json.get("triage_submission") or {}) if isinstance(analysis.decision_memory_json.get("triage_submission"), dict) else {}
        if not bu_name and isinstance(triage_data, dict):
            bu_name = triage_data.get("business_unit")
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue

        requester_name = None
        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_request_triage_submit",
            ).order_by(AuditLog.id.desc())
        )
        if audit and isinstance(audit.metadata_json, dict):
            requester_name = str(audit.metadata_json.get("requested_by") or "")

        open_amount = portfolio[2] or Decimal("0")
        total_limit = portfolio[3] or Decimal("0")
        exposure = portfolio[4] or Decimal("0")
        available_limit = total_limit - exposure
        created_date = analysis.created_at
        aging_days = max((datetime.now(timezone.utc) - created_date).days, 0)
        item = CreditAnalysisQueueItem(
            analysis_id=analysis.id,
            analysis_code=analysis.protocol_number,
            customer_name=customer.company_name,
            cnpj=customer.document_number,
            economic_group=portfolio[1],
            business_unit=bu_name,
            suggested_limit=analysis.suggested_limit,
            available_limit=available_limit if available_limit > Decimal("0") else Decimal("0"),
            total_limit=total_limit,
            open_amount=open_amount,
            has_recent_analysis=bool(triage_data.get("has_recent_analysis")),
            is_early_review_request=bool(triage_data.get("is_early_review_request")),
            early_review_justification=triage_data.get("early_review_justification"),
            previous_analysis_id=triage_data.get("previous_analysis_id"),
            requester_name=requester_name,
            assigned_analyst_name=analysis.assigned_analyst_name,
            created_at=analysis.created_at,
            current_status=status_value,
            aging_days=aging_days,
            coface_status=coface_status,
            agrisk_status=agrisk_status,
            analysis_type="novo_cliente" if not portfolio[0] else ("revisao_antecipada" if bool(triage_data.get("is_early_review_request")) else "cliente_carteira"),
            has_analysis_recent_badge=bool(triage_data.get("has_recent_analysis")),
        )
        items.append(item)

    def _match(item: CreditAnalysisQueueItem) -> bool:
        if q:
            needle = q.strip().lower()
            if needle not in (f"{item.customer_name} {item.cnpj or ''} {item.analysis_code}".lower()):
                return False
        if status and item.current_status != status:
            return False
        if bu and (item.business_unit or "") != bu:
            return False
        if analysis_type and item.analysis_type != analysis_type:
            return False
        if requester and requester.lower() not in (item.requester_name or "").lower():
            return False
        if assigned_analyst and assigned_analyst.lower() not in (item.assigned_analyst_name or "").lower():
            return False
        if date_from:
            try:
                if item.created_at.date() < datetime.fromisoformat(date_from).date():
                    return False
            except ValueError:
                pass
        if date_to:
            try:
                if item.created_at.date() > datetime.fromisoformat(date_to).date():
                    return False
            except ValueError:
                pass
        return True

    filtered = [item for item in items if _match(item)]
    kpis = CreditAnalysisQueueKpis(
        awaiting_analysis=sum(1 for item in filtered if item.current_status in {"pending", "in_progress"}),
        early_reviews=sum(1 for item in filtered if item.is_early_review_request),
        new_customers=sum(1 for item in filtered if item.analysis_type == "novo_cliente"),
        awaiting_reports=0,
        pending_approval=sum(1 for item in filtered if item.current_status == "in_approval"),
        total_in_analysis=len(filtered),
    )
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return CreditAnalysisQueueResponse(items=filtered[start:end], kpis=kpis, total=total, page=page, page_size=page_size)


@router.get("/queue/options", response_model=CreditAnalysisQueueOptionsResponse)
def list_credit_analyses_queue_options(
    business_unit_context: str | None = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisQueueOptionsResponse:
    query = select(CreditAnalysis, Customer).join(Customer, Customer.id == CreditAnalysis.customer_id)
    rows = db.execute(query).all()

    bu_context = resolve_business_unit_context(db, current, business_unit_context)
    scoped_bu_names = bu_context.effective_bu_names
    has_all_scope = bu_context.has_all_scope

    statuses: set[str] = set()
    bus: set[str] = set()
    requesters: set[str] = set()
    analysts: set[str] = set()
    analysis_types: set[str] = set()

    for analysis, customer in rows:
        if _is_step1_draft(analysis):
            continue
        portfolio = db.execute(
            select(func.max(ArAgingDataTotalRow.bu_normalized)).where(ArAgingDataTotalRow.cnpj_normalized == customer.document_number)
        ).one()
        bu_name = portfolio[0]
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue
        if bu_name:
            bus.add(str(bu_name))

        external_entries = list(
            db.scalars(select(ExternalDataEntry).where(ExternalDataEntry.credit_analysis_id == analysis.id).order_by(ExternalDataEntry.created_at.desc())).all()
        )
        statuses.add(_resolve_operational_status(analysis, external_entries))

        triage_data = {}
        if isinstance(analysis.decision_memory_json, dict):
            triage_data = (analysis.decision_memory_json.get("triage_submission") or {}) if isinstance(analysis.decision_memory_json.get("triage_submission"), dict) else {}
        if not bu_name and isinstance(triage_data, dict):
            bu_name = triage_data.get("business_unit")
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue
        analysis_type = "novo_cliente" if not bu_name else ("revisao_antecipada" if bool(triage_data.get("is_early_review_request")) else "cliente_carteira")
        analysis_types.add(analysis_type)

        if analysis.assigned_analyst_name:
            analysts.add(analysis.assigned_analyst_name)
        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_request_triage_submit",
            ).order_by(AuditLog.id.desc())
        )
        if audit and isinstance(audit.metadata_json, dict):
            requester = str(audit.metadata_json.get("requested_by") or "").strip()
            if requester:
                requesters.add(requester)

    status_label_map = {
        "pending": "Pendente",
        "in_progress": "Em andamento",
        "in_approval": "Em aprovacao",
        "approved": "Aprovado",
        "rejected": "Recusado",
    }
    type_label_map = {
        "cliente_carteira": "Cliente da carteira",
        "novo_cliente": "Cliente novo",
        "revisao_antecipada": "RevisÃ£o antecipada",
    }
    return CreditAnalysisQueueOptionsResponse(
        statuses=[CreditAnalysisQueueOption(value=value, label=status_label_map.get(value, value)) for value in sorted(statuses)],
        business_units=[CreditAnalysisQueueOption(value=value, label=value) for value in sorted(bus)],
        analysis_types=[CreditAnalysisQueueOption(value=value, label=type_label_map.get(value, value)) for value in sorted(analysis_types)],
        requesters=[CreditAnalysisQueueOption(value=value, label=value) for value in sorted(requesters)],
        analysts=[CreditAnalysisQueueOption(value=value, label=value) for value in sorted(analysts)],
    )


@router.get("/monitor", response_model=CreditAnalysisMonitorResponse)
def list_credit_analyses_monitor(
    q: str | None = None,
    status_filter: str | None = None,
    bu: str | None = None,
    business_unit_context: str | None = None,
    workflow_stage: str | None = None,
    analysis_type: str | None = None,
    requester: str | None = None,
    assigned_analyst: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisMonitorResponse:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    can_view_own = _has_any_permission(current, "credit_request_view_own", "credit.requests.view")
    can_view_bu = _has_any_permission(current, "credit_request_view_bu", "scope:all_bu")
    if not can_view_own and not current.bu_ids and "scope:all_bu" not in current.permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para visualizar o monitor de solicitacoes.")

    bu_context = resolve_business_unit_context(db, current, business_unit_context)
    scoped_bu_names = bu_context.effective_bu_names
    has_all_scope = bu_context.has_all_scope

    query = select(CreditAnalysis, Customer).join(Customer, Customer.id == CreditAnalysis.customer_id).order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
    rows = db.execute(query).all()
    items: list[CreditAnalysisMonitorItem] = []
    for analysis, customer in rows:
        if _is_step1_draft(analysis):
            continue
        latest_run_id = db.scalar(
            select(ArAgingDataTotalRow.import_run_id)
            .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingDataTotalRow.import_run_id)
            .where(
                ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            )
            .order_by(ArAgingDataTotalRow.import_run_id.desc())
            .limit(1)
        )
        if latest_run_id is None:
            portfolio = (None, None, Decimal("0"))
        else:
            portfolio_base = db.execute(
                select(
                    func.max(ArAgingDataTotalRow.bu_normalized),
                    func.max(ArAgingDataTotalRow.economic_group_normalized),
                ).where(
                    ArAgingDataTotalRow.import_run_id == latest_run_id,
                    ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                )
            ).one()
            group_keys_subquery = (
                select(ArAgingDataTotalRow.economic_group_normalized)
                .where(
                    ArAgingDataTotalRow.import_run_id == latest_run_id,
                    ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                    ArAgingDataTotalRow.economic_group_normalized.is_not(None),
                )
                .distinct()
            )
            approved_credit_total = db.scalar(
                select(func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0)).where(
                    ArAgingGroupConsolidatedRow.import_run_id == latest_run_id,
                    ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys_subquery),
                )
            )
            portfolio = (portfolio_base[0], portfolio_base[1], approved_credit_total or Decimal("0"))
        bu_name = portfolio[0]

        triage_data = {}
        if isinstance(analysis.decision_memory_json, dict):
            triage_data = (analysis.decision_memory_json.get("triage_submission") or {}) if isinstance(analysis.decision_memory_json.get("triage_submission"), dict) else {}
        if not bu_name and isinstance(triage_data, dict):
            bu_name = triage_data.get("business_unit")
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue

        external_entries = list(db.scalars(select(ExternalDataEntry).where(ExternalDataEntry.credit_analysis_id == analysis.id)).all())
        status_value = _resolve_operational_status(analysis, external_entries)
        stage = _resolve_workflow_stage(status_value)

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_request_triage_submit",
            ).order_by(AuditLog.id.desc())
        )
        requester_name = None
        requester_email = None
        audit_metadata = audit.metadata_json if audit and isinstance(audit.metadata_json, dict) else None
        if audit_metadata and isinstance(audit_metadata, dict):
            requester_email = str(audit_metadata.get("requested_by") or "").strip().lower() or None
            requester_name = requester_email

        is_early = bool(triage_data.get("is_early_review_request"))
        is_new_customer = not bool(bu_name)
        has_recent = bool(triage_data.get("has_recent_analysis"))
        available_actions = resolve_credit_workflow_available_actions(
            db,
            current,
            analysis=analysis,
            business_unit=bu_name,
        )
        if not available_actions:
            continue
        has_technical_visibility = any(action in TECHNICAL_MONITOR_VISIBILITY_ACTIONS for action in available_actions)

        if can_view_own and not can_view_bu:
            is_requester = requester_email == current.user.email.strip().lower()
            if not is_requester and not has_technical_visibility:
                continue
        next_role = "analista_financeiro"
        if stage == "pending_approval":
            next_role = "aprovador"
        elif stage == "decided":
            next_role = "comercial"

        aging_days = max((datetime.now(timezone.utc) - analysis.created_at).days, 0)
        stage_start = analysis.current_stage_started_at or analysis.created_at
        stage_aging_days = max((datetime.now(timezone.utc) - stage_start).days, 0)
        item = CreditAnalysisMonitorItem(
            analysis_id=analysis.id,
            protocol=analysis.protocol_number,
            customer_name=customer.company_name,
            cnpj=customer.document_number,
            economic_group=portfolio[1],
            business_unit=bu_name,
            requester_name=requester_name,
            assigned_analyst_name=analysis.assigned_analyst_name,
            current_owner_user_id=analysis.current_owner_user_id,
            current_owner_role=analysis.current_owner_role,
            approver_name=None,
            current_status=status_value,
            status_label=_status_label(status_value),
            workflow_stage=stage,
            current_journey_step=_resolve_persisted_journey_step(db, analysis),
            requested_limit=_resolve_monitor_requested_limit_with_legacy_context(
                analysis,
                triage_data=triage_data,
                audit_metadata=audit_metadata,
            ),
            recommended_limit=_resolve_recommended_limit_from_memory(analysis),
            financial_impact=_resolve_financial_impact(analysis),
            suggested_limit=analysis.suggested_limit,
            total_limit=portfolio[2] or Decimal("0"),
            approved_limit=analysis.final_limit,
            is_new_customer=is_new_customer,
            is_early_review_request=is_early,
            has_recent_analysis=has_recent,
            created_at=analysis.created_at,
            updated_at=analysis.created_at,
            aging_days=aging_days,
            stage_aging_days=stage_aging_days,
            next_responsible_role=next_role,
            available_actions=sorted(set(available_actions)),
        )
        items.append(item)

    def _match(item: CreditAnalysisMonitorItem) -> bool:
        if q:
            needle = q.strip().lower()
            if needle not in (f"{item.customer_name} {item.cnpj or ''} {item.protocol}".lower()):
                return False
        if status_filter and item.current_status != status_filter:
            return False
        if bu and (item.business_unit or "") != bu:
            return False
        if workflow_stage and item.workflow_stage != workflow_stage:
            return False
        if analysis_type:
            if analysis_type == "novo_cliente" and not item.is_new_customer:
                return False
            if analysis_type == "cliente_carteira" and item.is_new_customer:
                return False
            if analysis_type == "revisao_antecipada" and not item.is_early_review_request:
                return False
        if requester and requester.lower() not in (item.requester_name or "").lower():
            return False
        if assigned_analyst and assigned_analyst.lower() not in (item.assigned_analyst_name or "").lower():
            return False
        if date_from:
            try:
                if item.created_at.date() < datetime.fromisoformat(date_from).date():
                    return False
            except ValueError:
                pass
        if date_to:
            try:
                if item.created_at.date() > datetime.fromisoformat(date_to).date():
                    return False
            except ValueError:
                pass
        return True

    filtered = [item for item in items if _match(item)]
    kpis = CreditAnalysisMonitorKpis(
        total=len(filtered),
        awaiting_financial_review=sum(1 for item in filtered if item.workflow_stage == "financial_review"),
        in_analysis=sum(1 for item in filtered if item.current_status == "in_progress"),
        awaiting_approval=sum(1 for item in filtered if item.workflow_stage == "pending_approval"),
        returned_for_adjustment=0,
        completed=sum(1 for item in filtered if item.workflow_stage == "decided"),
        early_reviews=sum(1 for item in filtered if item.is_early_review_request),
    )
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return CreditAnalysisMonitorResponse(items=filtered[start:end], kpis=kpis, total=total, page=page, page_size=page_size)


@router.get("/monitor/options", response_model=CreditAnalysisQueueOptionsResponse)
def list_credit_analyses_monitor_options(
    business_unit_context: str | None = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisQueueOptionsResponse:
    return list_credit_analyses_queue_options(business_unit_context=business_unit_context, db=db, current=current)


@router.get("/approval-queue", response_model=CreditAnalysisApprovalQueueResponse)
def list_credit_analyses_approval_queue(
    q: str | None = None,
    status_filter: str | None = None,
    bu: str | None = None,
    business_unit_context: str | None = None,
    aging: str | None = None,
    assigned_analyst: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisApprovalQueueResponse:
    _require_can_view_approval_queue_or_403(db, current)

    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    bu_context = resolve_business_unit_context(db, current, business_unit_context)
    scoped_bu_names = bu_context.effective_bu_names
    has_all_scope = bu_context.has_all_scope

    query = (
        select(CreditAnalysis, Customer)
        .join(Customer, Customer.id == CreditAnalysis.customer_id)
        .order_by(CreditAnalysis.current_stage_started_at.desc(), CreditAnalysis.id.desc())
    )
    rows = db.execute(query).all()

    items: list[CreditAnalysisMonitorItem] = []
    now = datetime.now(timezone.utc)
    requester_name_cache: dict[str, str | None] = {}
    analyst_name_cache: dict[int, str | None] = {}
    for analysis, customer in rows:
        if _is_step1_draft(analysis):
            continue
        status_value = _current_status_value(analysis)
        if status_value != "in_approval":
            continue

        # Preserva classificaÃ§Ã£o jÃ¡ persistida; recalcula apenas quando ausente.
        memory_snapshot = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
        classification_snapshot = memory_snapshot.get("recommendation_classification") if isinstance(memory_snapshot.get("recommendation_classification"), dict) else None
        if not classification_snapshot:
            _attach_recommendation_classification(db, analysis)

        latest_run_id = db.scalar(
            select(ArAgingDataTotalRow.import_run_id)
            .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingDataTotalRow.import_run_id)
            .where(
                ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            )
            .order_by(ArAgingDataTotalRow.import_run_id.desc())
            .limit(1)
        )
        if latest_run_id is None:
            portfolio = (None, None, Decimal("0"))
        else:
            portfolio_base = db.execute(
                select(
                    func.max(ArAgingDataTotalRow.bu_normalized),
                    func.max(ArAgingDataTotalRow.economic_group_normalized),
                ).where(
                    ArAgingDataTotalRow.import_run_id == latest_run_id,
                    ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                )
            ).one()
            group_keys_subquery = (
                select(ArAgingDataTotalRow.economic_group_normalized)
                .where(
                    ArAgingDataTotalRow.import_run_id == latest_run_id,
                    ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
                    ArAgingDataTotalRow.economic_group_normalized.is_not(None),
                )
                .distinct()
            )
            approved_credit_total = db.scalar(
                select(func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0)).where(
                    ArAgingGroupConsolidatedRow.import_run_id == latest_run_id,
                    ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys_subquery),
                )
            )
            portfolio = (portfolio_base[0], portfolio_base[1], approved_credit_total or Decimal("0"))
        bu_name = portfolio[0]
        triage_data = {}
        if isinstance(analysis.decision_memory_json, dict):
            triage_data = (analysis.decision_memory_json.get("triage_submission") or {}) if isinstance(analysis.decision_memory_json.get("triage_submission"), dict) else {}
        if not bu_name and isinstance(triage_data, dict):
            bu_name = triage_data.get("business_unit")
        if not bu_name_in_scope(scoped_bu_names, bu_name, has_all_scope=has_all_scope):
            continue

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_request_triage_submit",
            ).order_by(AuditLog.id.desc())
        )
        requester_name = None
        audit_metadata = audit.metadata_json if audit and isinstance(audit.metadata_json, dict) else None
        requester_email = None
        if audit_metadata and isinstance(audit_metadata, dict):
            requester_email = str(audit_metadata.get("requested_by") or "").strip().lower() or None
        if requester_email:
            if requester_email not in requester_name_cache:
                requester_user = db.scalar(select(User).where(func.lower(User.email) == requester_email))
                requester_name_cache[requester_email] = (
                    requester_user.full_name.strip()
                    if requester_user and requester_user.full_name and requester_user.full_name.strip()
                    else None
                )
            requester_name = requester_name_cache.get(requester_email)

        analyst_name = analysis.assigned_analyst_name.strip() if analysis.assigned_analyst_name and analysis.assigned_analyst_name.strip() else None
        start_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.resource == "credit_analysis",
                AuditLog.resource_id == str(analysis.id),
                AuditLog.action == "credit_analysis_start",
            ).order_by(AuditLog.id.asc())
        )
        starter_user_id = start_audit.actor_user_id if start_audit else None
        if starter_user_id:
            if starter_user_id not in analyst_name_cache:
                starter_user = db.get(User, starter_user_id)
                analyst_name_cache[starter_user_id] = (
                    starter_user.full_name.strip()
                    if starter_user and starter_user.full_name and starter_user.full_name.strip()
                    else None
                )
            starter_name = analyst_name_cache.get(starter_user_id)
            if starter_name:
                analyst_name = starter_name

        approval_summary = _build_approval_flow_summary(
            db,
            current,
            analysis=analysis,
            business_unit=bu_name,
        )
        available_actions = approval_summary.available_actions
        can_decide = any(action in {"approve", "reject", "request_changes"} for action in available_actions)
        technical_linked_to_user = (
            analysis.last_owner_user_id == current.user.id
            or analysis.current_owner_user_id == current.user.id
            or (analysis.assigned_analyst_name or "").strip().lower()
            in {(current.user.full_name or "").strip().lower(), current.user.email.strip().lower()}
        )
        if not can_decide and not technical_linked_to_user:
            continue

        stage = _resolve_workflow_stage(status_value)
        aging_days = max((now - analysis.created_at).days, 0)
        stage_start = analysis.current_stage_started_at or analysis.created_at
        stage_aging_days = max((now - stage_start).days, 0)

        item = CreditAnalysisMonitorItem(
            analysis_id=analysis.id,
            protocol=analysis.protocol_number,
            customer_name=customer.company_name,
            cnpj=customer.document_number,
            economic_group=portfolio[1],
            business_unit=bu_name,
            requester_name=requester_name,
            assigned_analyst_name=analyst_name,
            current_owner_user_id=analysis.current_owner_user_id,
            current_owner_role=analysis.current_owner_role,
            approver_name=None,
            current_status=status_value,
            status_label=_status_label(status_value),
            workflow_stage=stage,
            current_journey_step=_resolve_persisted_journey_step(db, analysis),
            requested_limit=analysis.requested_limit,
            recommended_limit=_resolve_recommended_limit_from_memory(analysis),
            financial_impact=_resolve_financial_impact(analysis),
            suggested_limit=analysis.suggested_limit,
            total_limit=portfolio[2] or Decimal("0"),
            approved_limit=analysis.final_limit,
            is_new_customer=not bool(bu_name),
            is_early_review_request=bool(triage_data.get("is_early_review_request")),
            has_recent_analysis=bool(triage_data.get("has_recent_analysis")),
            created_at=analysis.created_at,
            updated_at=analysis.created_at,
            aging_days=aging_days,
            stage_aging_days=stage_aging_days,
            next_responsible_role="aprovador",
            applicable_doa_code=approval_summary.applicable_doa_code,
            applicable_doa_range=approval_summary.applicable_doa_range,
            available_actions=available_actions,
        )
        items.append(item)

    def _match(item: CreditAnalysisMonitorItem) -> bool:
        if q:
            needle = q.strip().lower()
            if needle not in (f"{item.customer_name} {item.cnpj or ''} {item.protocol}".lower()):
                return False
        if status_filter and item.current_status != status_filter:
            return False
        if bu and (item.business_unit or "") != bu:
            return False
        if assigned_analyst and assigned_analyst.lower() not in (item.assigned_analyst_name or "").lower():
            return False
        if aging:
            if aging == "over_5" and item.stage_aging_days <= 5:
                return False
            if aging == "over_10" and item.stage_aging_days <= 10:
                return False
        return True

    filtered = [item for item in items if _match(item)]
    kpis = CreditAnalysisApprovalQueueKpis(
        total=len(filtered),
        awaiting_approval=len(filtered),
        overdue_sla=sum(1 for item in filtered if item.stage_aging_days > 5),
        high_value=sum(1 for item in filtered if (item.suggested_limit or Decimal("0")) >= Decimal("1000000")),
    )
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return CreditAnalysisApprovalQueueResponse(items=filtered[start:end], kpis=kpis, total=total, page=page, page_size=page_size)


@router.get("/{analysis_id}", response_model=CreditAnalysisRead)
def get_credit_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysis:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_detail_read_access_or_403(db, current, analysis)
    _attach_journey_progress_fields(db, analysis)
    _attach_recommendation_classification(db, analysis)
    _attach_available_actions_field(db, current, analysis)
    _attach_technical_dossier_status_field(analysis)
    return analysis


@router.get("/{analysis_id}/approval-flow-summary", response_model=CreditAnalysisApprovalFlowSummary)
def get_credit_analysis_approval_flow_summary(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisApprovalFlowSummary:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_detail_read_access_or_403(db, current, analysis)

    bu_name = resolve_analysis_business_unit(db, analysis)
    return _build_approval_flow_summary(
        db,
        current,
        analysis=analysis,
        business_unit=bu_name,
    )


@router.put("/{analysis_id}/journey-progress", response_model=CreditAnalysisRead, status_code=status.HTTP_200_OK)
def update_credit_analysis_journey_progress(
    analysis_id: int,
    payload: CreditAnalysisJourneyProgressUpdateRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysis:
    _require_can_execute_credit_analysis_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_technical_access_or_403(db, current, analysis)

    if analysis.final_decision is not None or analysis.analysis_status == AnalysisStatus.COMPLETED or analysis.motor_result is not None:
        _set_journey_progress(
            analysis,
            current_step=4,
            last_completed_step=4 if analysis.final_decision is not None else 3,
        )
        db.commit()
        db.refresh(analysis)
        _attach_journey_progress_fields(db, analysis)
        return analysis

    current_step = _clamp_journey_step(payload.current_journey_step)
    last_completed = payload.last_completed_journey_step
    if last_completed is not None:
        last_completed = max(1, min(4, int(last_completed)))

    derived_step = _derive_journey_step_from_state(db, analysis)
    persisted_current, persisted_last = _get_journey_progress(analysis)
    previous_current = persisted_current or derived_step
    previous_last = persisted_last or max(1, previous_current - 1)

    next_current = max(previous_current, current_step or previous_current, derived_step)
    next_last = max(previous_last, last_completed or previous_last, max(1, next_current - 1))
    if next_last > next_current:
        next_last = next_current

    _set_journey_progress(analysis, current_step=next_current, last_completed_step=next_last)
    db.commit()
    db.refresh(analysis)
    _attach_journey_progress_fields(db, analysis)
    return analysis


@router.put("/{analysis_id}/workspace-state", response_model=CreditAnalysisRead, status_code=status.HTTP_200_OK)
def update_credit_analysis_workspace_state(
    analysis_id: int,
    payload: CreditAnalysisWorkspaceStateUpdateRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysis:
    _require_can_issue_credit_opinion_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_technical_access_or_403(db, current, analysis)

    if payload.analyst_notes is not None:
        analysis.analyst_notes = payload.analyst_notes
    if isinstance(payload.workspace_state, dict):
        _merge_workspace_state(analysis, payload.workspace_state)

    db.commit()
    db.refresh(analysis)
    _attach_journey_progress_fields(db, analysis)
    return analysis


@router.post("/{analysis_id}/start", response_model=CreditAnalysisRead, status_code=status.HTTP_200_OK)
def start_credit_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysis:
    _require_can_execute_credit_analysis_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    if analysis.analysis_status == AnalysisStatus.CREATED:
        transition = resolve_credit_workflow_transition(
            db,
            current,
            analysis,
            action="start_analysis",
            payload={"justification": "Inicio formal da analise pelo time financeiro."},
        )
        if not transition.allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=transition.workflow_context.get("denial_reason") or "Sem permissao.")
        db.commit()
        db.refresh(analysis)

    return analysis


@router.get("/{analysis_id}/events", response_model=list[DecisionEventRead])
def list_credit_analysis_events(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[DecisionEvent]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    canonical_types = {
        "analysis_created",
        "analysis_started",
        "analysis_submitted_for_approval",
        "analysis_approved",
        "analysis_rejected",
        "reassigned",
        "returned_for_revision",
        "comments_added",
    }
    events = list(
        db.scalars(
            select(DecisionEvent)
            .where(DecisionEvent.credit_analysis_id == analysis_id)
            .order_by(DecisionEvent.created_at.asc(), DecisionEvent.id.asc())
        ).all()
    )
    return [event for event in events if event.event_type in canonical_types]


@router.post(
    "/{analysis_id}/external-data",
    response_model=ExternalDataEntryDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def create_external_data_entry(
    analysis_id: int,
    payload: ExternalDataEntryCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ExternalDataEntry:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    entry = ExternalDataEntry(
        credit_analysis_id=analysis_id,
        **payload.model_dump(),
    )
    db.add(entry)
    db.flush()

    method_text = payload.entry_method.value.replace("_", " ")
    source_text = payload.source_type.value.replace("_", " ")
    db.add(
        DecisionEvent(
            credit_analysis_id=analysis_id,
            event_type="external_data_added",
            actor_type=ActorType.SYSTEM,
            actor_name="system",
            description=f"External data added via {method_text} from {source_text}",
            event_payload_json={"external_data_entry_id": entry.id},
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to create external data entry due to conflicting data.",
        ) from exc

    db.refresh(entry)
    return entry


@router.get("/{analysis_id}/external-data", response_model=list[ExternalDataEntryRead])
def list_external_data_entries(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[ExternalDataEntry]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    return list(
        db.scalars(
            select(ExternalDataEntry)
            .where(ExternalDataEntry.credit_analysis_id == analysis_id)
            .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
        ).all()
    )


@router.get("/{analysis_id}/external-data/{entry_id}", response_model=ExternalDataEntryDetailRead)
def get_external_data_entry(
    analysis_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ExternalDataEntry:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    entry = db.scalar(
        select(ExternalDataEntry).where(
            ExternalDataEntry.id == entry_id,
            ExternalDataEntry.credit_analysis_id == analysis_id,
        )
    )
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="External data entry not found for this analysis.",
        )

    return entry


@router.post(
    "/{analysis_id}/external-data/{entry_id}/files",
    response_model=ExternalDataFileSummaryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register file metadata only (no file upload)",
    description=(
        "This endpoint does not upload or store physical files. "
        "It only registers file metadata linked to an external data entry."
    ),
)
def create_external_data_file_metadata(
    analysis_id: int,
    entry_id: int,
    payload: ExternalDataFileMetadataCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ExternalDataFile:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    entry = db.scalar(
        select(ExternalDataEntry).where(
            ExternalDataEntry.id == entry_id,
            ExternalDataEntry.credit_analysis_id == analysis_id,
        )
    )
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="External data entry not found for this analysis.",
        )

    file_metadata = ExternalDataFile(
        external_data_entry_id=entry.id,
        **payload.model_dump(),
    )
    db.add(file_metadata)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to register file metadata due to conflicting data.",
        ) from exc

    db.refresh(file_metadata)
    return file_metadata


@router.post(
    "/{analysis_id}/score/calculate",
    response_model=ScoreCalculationResponse,
    status_code=status.HTTP_200_OK,
)
def calculate_score(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ScoreCalculationResponse:
    _require_can_execute_credit_analysis_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    try:
        score_result, source_entry, recalculated = calculate_and_upsert_score(db, analysis_id)
    except ScoreCalculationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    db.flush()
    db.add(
        DecisionEvent(
            credit_analysis_id=analysis_id,
            event_type="score_calculated",
            actor_type=ActorType.SYSTEM,
            actor_name="system",
            description=f"Score calculated: {score_result.final_score} (band {score_result.score_band.value})",
            event_payload_json={
                "score_result_id": score_result.id,
                "source_entry_id": source_entry.id,
                "recalculated": recalculated,
            },
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to persist score due to conflicting data.",
        ) from exc

    db.refresh(score_result)
    return ScoreCalculationResponse(
        score_result=ScoreResultResponse.model_validate(score_result),
        recalculated=recalculated,
        source_entry_id=source_entry.id,
    )


@router.get("/{analysis_id}/score", response_model=ScoreResultResponse)
def get_score_result(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ScoreResult:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    score_result = db.scalar(select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id))
    if score_result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Score result not found for this analysis.",
        )

    return score_result


@router.post(
    "/{analysis_id}/decision/calculate",
    response_model=DecisionCalculationResponse,
    status_code=status.HTTP_200_OK,
)
def calculate_decision(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DecisionCalculationResponse:
    _require_can_submit_credit_analysis_or_403(db, current)
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)
    score_result = db.scalar(select(ScoreResult.id).where(ScoreResult.credit_analysis_id == analysis_id))
    if score_result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Score result not found for this analysis.",
        )

    try:
        analysis, source_entry, recalculated = calculate_and_apply_decision(db, analysis_id)
    except DecisionCalculationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    bu_name = resolve_analysis_business_unit(db, analysis)
    business_unit_id = None
    if bu_name:
        business_unit_id = db.scalar(
            select(BusinessUnit.id).where(
                BusinessUnit.company_id == current.user.company_id,
                BusinessUnit.name == bu_name,
            )
        )
    recommendation_classification = _resolve_recommendation_classification(db, analysis)
    recommended_final = _to_decimal_or_none(recommendation_classification.get("final_suggested_limit"))
    preview_amount = recommended_final if recommended_final is not None else (analysis.suggested_limit or Decimal("0"))
    if (
        recommended_final is not None
        and analysis.current_limit is not None
        and recommended_final > Decimal("0")
        and analysis.current_limit > Decimal("0")
        and recommended_final == analysis.current_limit
    ):
        preview_amount = Decimal("0")
    approval_matrix_preview = resolve_required_approval_roles(
        db,
        amount=preview_amount,
        currency="BRL",
        business_unit_id=business_unit_id,
    )
    decision_memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    decision_memory["approval_matrix_preview"] = approval_matrix_preview
    decision_memory["recommendation_classification"] = recommendation_classification
    analysis.decision_memory_json = decision_memory

    db.add(
        DecisionEvent(
            credit_analysis_id=analysis_id,
            event_type="decision_calculated",
            actor_type=ActorType.SYSTEM,
            actor_name="system",
            description=(
                f"Decision calculated: {analysis.motor_result.value} "
                f"with suggested limit {analysis.suggested_limit}"
            ),
            event_payload_json={
                "source_entry_id": source_entry.id,
                "motor_result": analysis.motor_result.value,
                "suggested_limit": str(analysis.suggested_limit),
                "recalculated": recalculated,
            },
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to persist decision due to conflicting data.",
        ) from exc

    db.refresh(analysis)
    return DecisionCalculationResponse(
        decision=DecisionResultResponse(
            analysis_id=analysis.id,
            motor_result=analysis.motor_result,
            suggested_limit=analysis.suggested_limit,
            decision_memory_json=analysis.decision_memory_json,
            decision_calculated_at=analysis.decision_calculated_at,
        ),
        recalculated=recalculated,
        source_entry_id=source_entry.id,
    )


@router.get("/{analysis_id}/decision", response_model=DecisionResultResponse)
def get_decision_result(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DecisionResultResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    if (
        analysis.motor_result is None
        or analysis.suggested_limit is None
        or analysis.decision_memory_json is None
        or analysis.decision_calculated_at is None
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Decision result not found for this analysis.",
        )

    return DecisionResultResponse(
        analysis_id=analysis.id,
        motor_result=analysis.motor_result,
        suggested_limit=analysis.suggested_limit,
        decision_memory_json=analysis.decision_memory_json,
        decision_calculated_at=analysis.decision_calculated_at,
    )


@router.post(
    "/{analysis_id}/final-decision",
    response_model=FinalDecisionResponse,
    status_code=status.HTTP_200_OK,
)
def apply_analysis_final_decision(
    analysis_id: int,
    payload: FinalDecisionApplyRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FinalDecisionResponse:
    analysis_record = db.get(CreditAnalysis, analysis_id)
    if analysis_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis_record)
    try:
        transition = resolve_credit_workflow_transition(
            db,
            current,
            analysis_record,
            action="approve" if payload.final_decision == FinalDecision.APPROVED else "reject",
            payload={
                "final_decision": payload.final_decision,
                "final_limit": payload.final_limit,
                "analyst_name": payload.analyst_name,
                "analyst_notes": payload.analyst_notes,
                "justification": payload.analyst_notes,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    if not transition.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=transition.workflow_context.get("denial_reason") or "Sem permissao.")
    analysis = analysis_record

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to persist final decision due to conflicting data.",
        ) from exc

    db.refresh(analysis)
    return FinalDecisionResponse(
        analysis_id=analysis.id,
        final_decision=analysis.final_decision,
        final_limit=analysis.final_limit,
        analyst_name=analysis.assigned_analyst_name,
        analyst_notes=analysis.analyst_notes,
        completed_at=analysis.completed_at,
    )


@router.post("/{analysis_id}/workflow-actions", response_model=WorkflowActionResponse, status_code=status.HTTP_200_OK)
def execute_workflow_action(
    analysis_id: int,
    payload: WorkflowActionRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> WorkflowActionResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit analysis not found.")
    _enforce_technical_access_or_403(db, current, analysis)

    action = (payload.action or "").strip().lower()
    if action not in {"submit_approval", "submit_for_approval", "request_changes", "request_maintenance", "return_to_analysis", "finalize"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AÃ§Ã£o de workflow invÃ¡lida para este endpoint.")

    action_aliases = {
        "request_maintenance": "request_changes",
        "submit_for_approval": "submit_approval",
    }
    normalized_action = action_aliases.get(action, action)

    try:
        transition = resolve_credit_workflow_transition(
            db,
            current,
            analysis,
            action=normalized_action,
            payload={"justification": payload.justification},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    if not transition.allowed:
        denial_type = transition.workflow_context.get("denial_type")
        if denial_type == "invalid_status":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=transition.workflow_context.get("denial_reason") or "Status atual nao permite esta transicao.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=transition.workflow_context.get("denial_reason") or "Sem permissÃ£o para esta transiÃ§Ã£o.",
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="NÃ£o foi possÃ­vel persistir a transiÃ§Ã£o de workflow.") from exc

    return WorkflowActionResponse(
        analysis_id=analysis.id,
        current_status=transition.current_status,
        next_status=transition.next_status,
        current_owner=transition.current_owner,
        next_owner=transition.next_owner,
        current_stage=transition.current_stage,
        next_stage=transition.next_stage,
        timeline_event=transition.timeline_event,
        audit_event=transition.audit_event,
        available_actions=transition.available_actions,
        workflow_context=transition.workflow_context,
    )


@router.get("/{analysis_id}/final-decision", response_model=FinalDecisionResponse)
def get_analysis_final_decision(
    analysis_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FinalDecisionResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    _enforce_technical_access_or_403(db, current, analysis)

    if analysis.final_decision is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Final decision not found for this analysis.",
        )

    return FinalDecisionResponse(
        analysis_id=analysis.id,
        final_decision=analysis.final_decision,
        final_limit=analysis.final_limit,
        analyst_name=analysis.assigned_analyst_name,
        analyst_notes=analysis.analyst_notes,
        completed_at=analysis.completed_at,
    )


