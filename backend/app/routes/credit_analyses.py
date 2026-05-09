from decimal import Decimal
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Numeric, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user, require_permissions
from app.db.session import get_db
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.audit_log import AuditLog
from app.models.business_unit import BusinessUnit
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.enums import ActorType, AnalysisStatus, FinalDecision
from app.models.external_data_entry import ExternalDataEntry
from app.models.external_data_file import ExternalDataFile
from app.models.score_result import ScoreResult
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.schemas.credit_analysis import (
    CreditAnalysisCreate,
    CreditAnalysisQueueItem,
    CreditAnalysisQueueKpis,
    CreditAnalysisMonitorItem,
    CreditAnalysisMonitorKpis,
    CreditAnalysisMonitorResponse,
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
from app.services.final_decision import FinalDecisionError, apply_final_decision
from app.services.protocol import generate_protocol_number
from app.services.decision import DecisionCalculationError, calculate_and_apply_decision
from app.services.score import ScoreCalculationError, calculate_and_upsert_score
from app.services.external_cnpj import fetch_external_cnpj_data, is_valid_cnpj
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_text_key
from app.services.credit_policy_config import MIN_EARLY_REVIEW_JUSTIFICATION_LENGTH, REANALYSIS_COOLDOWN_DAYS

router = APIRouter(prefix="/credit-analyses", tags=["credit-analyses"])


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


def _build_customer_from_portfolio_row(cnpj: str, row: tuple) -> dict:
    customer_name, bu_name, group_name, open_amount, approved_credit, exposure = row
    open_value = open_amount or Decimal("0")
    total_limit = approved_credit or Decimal("0")
    available = total_limit - (exposure or Decimal("0"))
    return {
        "cnpj": cnpj,
        "company_name": customer_name,
        "business_unit": bu_name,
        "economic_group": group_name,
        "open_amount": open_value,
        "total_limit": total_limit,
        "available_limit": available if available > Decimal("0") else Decimal("0"),
    }


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
    if analysis.analysis_status == AnalysisStatus.COMPLETED:
        return "completed"
    if analysis.analysis_status == AnalysisStatus.IN_PROGRESS and analysis.motor_result is not None:
        return "pending_approval"
    if analysis.decision_memory_json and analysis.decision_memory_json.get("triage_submission"):
        if not external_entries:
            return "pending_external_reports"
    if analysis.analysis_status == AnalysisStatus.CREATED:
        return "submitted"
    return "under_financial_review"


def _has_any_permission(current: CurrentUser, *keys: str) -> bool:
    return any(key in current.permissions for key in keys)


def _resolve_workflow_stage(status_value: str) -> str:
    if status_value in {"submitted"}:
        return "commercial_submitted"
    if status_value in {"under_financial_review", "pending_external_reports", "ready_for_credit_engine", "dossier_generated"}:
        return "financial_review"
    if status_value in {"pending_approval"}:
        return "pending_approval"
    if status_value in {"approved", "rejected", "completed"}:
        return "decided"
    return "returned"


def _status_label(status_value: str) -> str:
    mapping = {
        "submitted": "Submetida",
        "under_financial_review": "Em análise financeira",
        "pending_external_reports": "Aguardando relatórios",
        "ready_for_credit_engine": "Pronta para motor",
        "dossier_generated": "Dossiê gerado",
        "pending_approval": "Aguardando aprovação",
        "approved": "Aprovada",
        "rejected": "Reprovada",
        "returned_for_adjustment": "Devolvida para ajuste",
        "completed": "Concluída",
    }
    return mapping.get(status_value, status_value)


def _enforce_technical_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    can_validate = _has_any_permission(current, "credit_request_validate", "credit.analysis.execute")
    can_approve = _has_any_permission(current, "credit_request_approve", "credit.approval.approve")
    can_reject = _has_any_permission(current, "credit_request_reject", "credit.approval.reject")
    if can_validate or can_approve or can_reject or "scope:all_bu" in current.permissions:
        return
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.resource == "credit_analysis",
            AuditLog.resource_id == str(analysis.id),
            AuditLog.action == "credit_request_triage_submit",
        ).order_by(AuditLog.id.desc())
    )
    requester_email = None
    if audit and isinstance(audit.metadata_json, dict):
        requester_email = str(audit.metadata_json.get("requested_by") or "").strip().lower() or None
    is_owner = requester_email == current.user.email.strip().lower()
    owner_can_view_dossier = analysis.final_decision in {FinalDecision.APPROVED, FinalDecision.REJECTED}
    if is_owner and not owner_can_view_dossier:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="O dossie sera disponibilizado ao solicitante apos a conclusao da analise.",
        )


@router.post("/triage", response_model=CreditAnalysisTriageResponse, status_code=status.HTTP_200_OK)
def triage_credit_analysis(
    payload: CreditAnalysisTriageRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.request.create"])),
) -> CreditAnalysisTriageResponse:
    normalized_cnpj = _normalize_cnpj_or_400(payload.cnpj)

    portfolio_row = db.execute(
        select(
            func.max(ArAgingDataTotalRow.customer_name),
            func.max(ArAgingDataTotalRow.bu_normalized),
            func.max(ArAgingDataTotalRow.economic_group_normalized),
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["approved_credit_amount"].astext.cast(Numeric(18, 2))), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["exposure_amount"].astext.cast(Numeric(18, 2))), 0),
        ).where(ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj)
    ).one()

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
                "total_limit": mapped["total_limit"],
                "available_limit": mapped["available_limit"],
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
        message="Cliente nao localizado na carteira atual. Os dados cadastrais foram preenchidos a partir da consulta externa.",
    )


@router.post("/triage/submit", response_model=CreditAnalysisTriageSubmitResponse, status_code=status.HTTP_201_CREATED)
def submit_credit_analysis_from_triage(
    payload: CreditAnalysisTriageSubmitRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["credit.request.create"])),
) -> CreditAnalysisTriageSubmitResponse:
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
                return CreditAnalysisTriageSubmitResponse(
                    analysis_id=reused.id,
                    customer_id=reused.customer_id,
                    status=reused.analysis_status,
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

    analysis = CreditAnalysis(
        customer_id=customer.id,
        protocol_number=generate_protocol_number(db),
        requested_limit=payload.suggested_limit,
        current_limit=Decimal("0"),
        exposure_amount=Decimal("0"),
        annual_revenue_estimated=Decimal("0"),
        suggested_limit=payload.suggested_limit,
        analysis_status=AnalysisStatus.CREATED,
        assigned_analyst_name=None,
        decision_memory_json={
            "triage_submission": {
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
            }
        },
    )
    db.add(analysis)
    db.flush()

    db.add(
        DecisionEvent(
            credit_analysis_id=analysis.id,
            event_type="analysis_submitted",
            actor_type=ActorType.USER,
            actor_name=current.user.full_name,
            description="Solicitacao enviada para analise financeira",
            event_payload_json={
                "source": payload.source,
                "cnpj": normalized_cnpj,
                "suggested_limit": str(payload.suggested_limit),
                "initial_status": AnalysisStatus.CREATED.value,
                "is_early_review_request": payload.is_early_review_request,
                "early_review_justification": early_justification if payload.is_early_review_request else None,
                "previous_analysis_id": payload.previous_analysis_id or (recent_analysis.id if recent_analysis else None),
                "reanalysis_available_at": (
                    (recent_analysis.created_at + timedelta(days=REANALYSIS_COOLDOWN_DAYS)).isoformat()
                    if recent_analysis
                    else None
                ),
                "business_unit": selected_bu_name,
            },
        )
    )
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
                "initial_status": AnalysisStatus.CREATED.value,
                "analysis_id": analysis.id,
                "is_early_review_request": payload.is_early_review_request,
                "business_unit": selected_bu_name,
                "early_review_justification": early_justification if payload.is_early_review_request else None,
                "previous_analysis_id": payload.previous_analysis_id or (recent_analysis.id if recent_analysis else None),
                "reanalysis_available_at": (
                    (recent_analysis.created_at + timedelta(days=REANALYSIS_COOLDOWN_DAYS)).isoformat()
                    if recent_analysis
                    else None
                ),
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
    return CreditAnalysisTriageSubmitResponse(
        analysis_id=analysis.id,
        customer_id=customer.id,
        status=analysis.analysis_status,
        reused_existing=False,
    )


@router.post("", response_model=CreditAnalysisRead, status_code=status.HTTP_201_CREATED)
def create_credit_analysis(
    payload: CreditAnalysisCreate, db: Session = Depends(get_db)
) -> CreditAnalysis:
    customer = db.get(Customer, payload.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found.",
        )

    analysis = CreditAnalysis(
        **payload.model_dump(),
        protocol_number=generate_protocol_number(db),
        analysis_status=AnalysisStatus.CREATED,
    )
    db.add(analysis)
    db.flush()

    initial_event = DecisionEvent(
        credit_analysis_id=analysis.id,
        event_type="analysis_created",
        actor_type=ActorType.SYSTEM,
        actor_name="system",
        description="Analise criada",
        event_payload_json=None,
    )
    db.add(initial_event)

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
def list_credit_analyses(db: Session = Depends(get_db)) -> list[CreditAnalysis]:
    return list(db.scalars(select(CreditAnalysis).order_by(CreditAnalysis.id.desc())).all())


@router.get("/queue", response_model=CreditAnalysisQueueResponse)
def list_credit_analyses_queue(
    q: str | None = None,
    status: str | None = None,
    bu: str | None = None,
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

    scoped_bu_names = set()
    if "scope:all_bu" not in current.permissions:
        scoped_bu_names = set(
            db.scalars(
                select(BusinessUnit.name)
                .join(UserBusinessUnitScope, UserBusinessUnitScope.business_unit_id == BusinessUnit.id)
                .where(UserBusinessUnitScope.user_id == current.user.id)
            ).all()
        )

    items: list[CreditAnalysisQueueItem] = []
    for analysis, customer in rows:
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
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
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
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
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
        awaiting_analysis=sum(1 for item in filtered if item.current_status in {"submitted", "under_financial_review"}),
        early_reviews=sum(1 for item in filtered if item.is_early_review_request),
        new_customers=sum(1 for item in filtered if item.analysis_type == "novo_cliente"),
        awaiting_reports=sum(1 for item in filtered if item.current_status == "pending_external_reports"),
        pending_approval=sum(1 for item in filtered if item.current_status == "pending_approval"),
        total_in_analysis=len(filtered),
    )
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return CreditAnalysisQueueResponse(items=filtered[start:end], kpis=kpis, total=total, page=page, page_size=page_size)


@router.get("/queue/options", response_model=CreditAnalysisQueueOptionsResponse)
def list_credit_analyses_queue_options(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisQueueOptionsResponse:
    query = select(CreditAnalysis, Customer).join(Customer, Customer.id == CreditAnalysis.customer_id)
    rows = db.execute(query).all()

    scoped_bu_names = set()
    if "scope:all_bu" not in current.permissions:
        scoped_bu_names = set(
            db.scalars(
                select(BusinessUnit.name)
                .join(UserBusinessUnitScope, UserBusinessUnitScope.business_unit_id == BusinessUnit.id)
                .where(UserBusinessUnitScope.user_id == current.user.id)
            ).all()
        )

    statuses: set[str] = set()
    bus: set[str] = set()
    requesters: set[str] = set()
    analysts: set[str] = set()
    analysis_types: set[str] = set()

    for analysis, customer in rows:
        portfolio = db.execute(
            select(func.max(ArAgingDataTotalRow.bu_normalized)).where(ArAgingDataTotalRow.cnpj_normalized == customer.document_number)
        ).one()
        bu_name = portfolio[0]
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
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
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
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
        "submitted": "Submetida",
        "under_financial_review": "Em análise financeira",
        "pending_external_reports": "Aguardando relatórios",
        "ready_for_credit_engine": "Pronta para motor",
        "dossier_generated": "Dossiê gerado",
        "pending_approval": "Aguardando aprovação",
        "approved": "Aprovada",
        "rejected": "Reprovada",
        "returned_for_adjustment": "Retornada para ajuste",
        "completed": "Concluída",
    }
    type_label_map = {
        "cliente_carteira": "Cliente da carteira",
        "novo_cliente": "Cliente novo",
        "revisao_antecipada": "Revisão antecipada",
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
    can_validate = _has_any_permission(current, "credit_request_validate", "credit.analysis.execute")
    can_submit_approval = _has_any_permission(current, "credit_request_submit_approval", "credit.request.submit")
    can_approve = _has_any_permission(current, "credit_request_approve", "credit.approval.approve")
    can_reject = _has_any_permission(current, "credit_request_reject", "credit.approval.reject")
    can_view_bu = _has_any_permission(current, "credit_request_view_bu", "scope:all_bu")
    if not any([can_view_own, can_validate, can_submit_approval, can_approve, can_reject, can_view_bu]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para visualizar o monitor de solicitacoes.")

    scoped_bu_names = set()
    if "scope:all_bu" not in current.permissions:
        scoped_bu_names = set(
            db.scalars(
                select(BusinessUnit.name)
                .join(UserBusinessUnitScope, UserBusinessUnitScope.business_unit_id == BusinessUnit.id)
                .where(UserBusinessUnitScope.user_id == current.user.id)
            ).all()
        )

    query = select(CreditAnalysis, Customer).join(Customer, Customer.id == CreditAnalysis.customer_id).order_by(CreditAnalysis.created_at.desc(), CreditAnalysis.id.desc())
    rows = db.execute(query).all()
    items: list[CreditAnalysisMonitorItem] = []

    for analysis, customer in rows:
        portfolio = db.execute(
            select(
                func.max(ArAgingDataTotalRow.bu_normalized),
                func.max(ArAgingDataTotalRow.economic_group_normalized),
            ).where(ArAgingDataTotalRow.cnpj_normalized == customer.document_number)
        ).one()
        bu_name = portfolio[0]
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
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
        if audit and isinstance(audit.metadata_json, dict):
            requester_email = str(audit.metadata_json.get("requested_by") or "").strip().lower() or None
            requester_name = requester_email

        if can_view_own and not any([can_validate, can_submit_approval, can_approve, can_reject, can_view_bu]):
            if requester_email != current.user.email.strip().lower():
                continue
        elif can_approve and not can_validate:
            if status_value != "pending_approval":
                continue
        elif can_validate:
            if status_value in {"approved", "rejected", "completed"}:
                continue

        triage_data = {}
        if isinstance(analysis.decision_memory_json, dict):
            triage_data = (analysis.decision_memory_json.get("triage_submission") or {}) if isinstance(analysis.decision_memory_json.get("triage_submission"), dict) else {}
        if not bu_name and isinstance(triage_data, dict):
            bu_name = triage_data.get("business_unit")
        if scoped_bu_names and bu_name and bu_name not in scoped_bu_names:
            continue
        is_early = bool(triage_data.get("is_early_review_request"))
        is_new_customer = not bool(bu_name)
        has_recent = bool(triage_data.get("has_recent_analysis"))
        available_actions: list[str] = []
        is_requester_only = can_view_own and not any([can_validate, can_submit_approval, can_approve, can_reject, can_view_bu])
        if is_requester_only:
            if status_value in {"approved", "rejected"}:
                available_actions.extend(["view_dossier", "view_result"])
            else:
                available_actions.append("view_tracking")
        else:
            if can_validate and status_value in {"submitted", "under_financial_review", "pending_external_reports", "ready_for_credit_engine"}:
                available_actions.append("continue_analysis")
            if can_validate and can_submit_approval and status_value in {"dossier_generated", "under_financial_review"}:
                available_actions.append("submit_approval")
            if can_approve and status_value == "pending_approval":
                available_actions.append("review_decision")
            if status_value in {"approved", "rejected", "completed"}:
                available_actions.append("view_result")
            if can_view_own and requester_email == current.user.email.strip().lower() and status_value not in {"approved", "rejected"}:
                available_actions.append("view_tracking")
        next_role = "analista_financeiro"
        if stage == "pending_approval":
            next_role = "aprovador"
        elif stage == "decided":
            next_role = "comercial"

        aging_days = max((datetime.now(timezone.utc) - analysis.created_at).days, 0)
        item = CreditAnalysisMonitorItem(
            analysis_id=analysis.id,
            protocol=analysis.protocol_number,
            customer_name=customer.company_name,
            cnpj=customer.document_number,
            economic_group=portfolio[1],
            business_unit=bu_name,
            requester_name=requester_name,
            assigned_analyst_name=analysis.assigned_analyst_name,
            approver_name=None,
            current_status=status_value,
            status_label=_status_label(status_value),
            workflow_stage=stage,
            suggested_limit=analysis.suggested_limit,
            approved_limit=analysis.final_limit,
            is_new_customer=is_new_customer,
            is_early_review_request=is_early,
            has_recent_analysis=has_recent,
            created_at=analysis.created_at,
            updated_at=analysis.created_at,
            aging_days=aging_days,
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
        in_analysis=sum(1 for item in filtered if item.current_status in {"under_financial_review", "pending_external_reports", "ready_for_credit_engine"}),
        awaiting_approval=sum(1 for item in filtered if item.workflow_stage == "pending_approval"),
        returned_for_adjustment=sum(1 for item in filtered if item.current_status == "returned_for_adjustment"),
        completed=sum(1 for item in filtered if item.workflow_stage == "decided"),
        early_reviews=sum(1 for item in filtered if item.is_early_review_request),
    )
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return CreditAnalysisMonitorResponse(items=filtered[start:end], kpis=kpis, total=total, page=page, page_size=page_size)


@router.get("/monitor/options", response_model=CreditAnalysisQueueOptionsResponse)
def list_credit_analyses_monitor_options(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CreditAnalysisQueueOptionsResponse:
    return list_credit_analyses_queue_options(db=db, current=current)


@router.get("/{analysis_id}", response_model=CreditAnalysisRead)
def get_credit_analysis(analysis_id: int, db: Session = Depends(get_db)) -> CreditAnalysis:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )
    return analysis


@router.get("/{analysis_id}/events", response_model=list[DecisionEventRead])
def list_credit_analysis_events(analysis_id: int, db: Session = Depends(get_db)) -> list[DecisionEvent]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

    return list(
        db.scalars(
            select(DecisionEvent)
            .where(DecisionEvent.credit_analysis_id == analysis_id)
            .order_by(DecisionEvent.created_at.asc(), DecisionEvent.id.asc())
        ).all()
    )


@router.post(
    "/{analysis_id}/external-data",
    response_model=ExternalDataEntryDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def create_external_data_entry(
    analysis_id: int,
    payload: ExternalDataEntryCreate,
    db: Session = Depends(get_db),
) -> ExternalDataEntry:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
def list_external_data_entries(analysis_id: int, db: Session = Depends(get_db)) -> list[ExternalDataEntry]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

    return list(
        db.scalars(
            select(ExternalDataEntry)
            .where(ExternalDataEntry.credit_analysis_id == analysis_id)
            .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
        ).all()
    )


@router.get("/{analysis_id}/external-data/{entry_id}", response_model=ExternalDataEntryDetailRead)
def get_external_data_entry(analysis_id: int, entry_id: int, db: Session = Depends(get_db)) -> ExternalDataEntry:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
) -> ExternalDataFile:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
def calculate_score(analysis_id: int, db: Session = Depends(get_db)) -> ScoreCalculationResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
def calculate_decision(analysis_id: int, db: Session = Depends(get_db)) -> DecisionCalculationResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
) -> FinalDecisionResponse:
    try:
        analysis, event_type = apply_final_decision(db, analysis_id, payload)
    except FinalDecisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    db.add(
        DecisionEvent(
            credit_analysis_id=analysis.id,
            event_type=event_type,
            actor_type=ActorType.USER,
            actor_name=payload.analyst_name,
            description=(
                f"Final decision {analysis.final_decision.value} "
                f"with final limit {analysis.final_limit} by {payload.analyst_name}"
            ),
            event_payload_json={
                "analyst_name": payload.analyst_name,
                "final_decision": analysis.final_decision.value,
                "final_limit": str(analysis.final_limit) if analysis.final_limit is not None else None,
                "analyst_notes": payload.analyst_notes,
            },
        )
    )

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

