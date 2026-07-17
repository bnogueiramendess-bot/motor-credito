from pathlib import Path
from uuid import uuid4
import base64
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.security import CurrentUser, get_current_user, require_permissions
from app.db.session import get_db
from app.models.analysis_document import AnalysisDocument
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_report_read import CreditReportRead
from app.schemas.credit_report_read import (
    AgriskReportReadCreate,
    AgriskReportReadResponse,
    CofaceReportReadCreate,
    CofaceReportReadResponse,
)
from app.services.bu_scope import assert_bu_in_scope, get_user_allowed_business_units, resolve_analysis_business_unit, user_has_all_bu_scope
from app.services.credit_report_readers.agrisk_upload import create_agrisk_report_read, resolve_agrisk_report_type
from app.services.credit_report_readers.coface_upload import create_coface_report_read
from app.services.report_links import collect_report_read_ids_from_links, upsert_agrisk_report_link
from app.services.workflow_authorization import resolve_credit_workflow_action

router = APIRouter(prefix="/credit-report-reads", tags=["credit-report-reads"])
logger = logging.getLogger(__name__)


def _to_response(entry: CreditReportRead) -> AgriskReportReadResponse:
    report_type = resolve_agrisk_report_type(entry)
    return AgriskReportReadResponse(
        id=entry.id,
        source_type="agrisk",
        report_type=report_type,  # type: ignore[arg-type]
        status=entry.status,  # type: ignore[arg-type]
        original_filename=entry.original_filename,
        mime_type=entry.mime_type,
        file_size=entry.file_size,
        customer_document_number=entry.customer_document_number,
        report_document_number=entry.report_document_number,
        is_document_match=entry.is_document_match,
        validation_message=entry.validation_message,
        score_primary=entry.score_primary,
        score_source=entry.score_source,
        warnings=entry.warnings_json or [],
        confidence=entry.confidence,  # type: ignore[arg-type]
        read_payload=entry.read_payload_json or {},
        created_at=entry.created_at,
    )


def _to_coface_response(entry: CreditReportRead) -> CofaceReportReadResponse:
    return CofaceReportReadResponse(
        id=entry.id,
        source_type="coface",
        status=entry.status,  # type: ignore[arg-type]
        original_filename=entry.original_filename,
        mime_type=entry.mime_type,
        file_size=entry.file_size,
        customer_document_number=entry.customer_document_number,
        report_document_number=entry.report_document_number,
        is_document_match=entry.is_document_match,
        validation_message=entry.validation_message,
        score_primary=entry.score_primary,
        score_source=entry.score_source,
        warnings=entry.warnings_json or [],
        confidence=entry.confidence,  # type: ignore[arg-type]
        read_payload=entry.read_payload_json or {},
        created_at=entry.created_at,
    )


def _analysis_documents_storage_root() -> Path:
    root = Path(__file__).resolve().parents[2] / "data" / "analysis_documents"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _enforce_analysis_scope_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> None:
    allowed_bu_names = get_user_allowed_business_units(db, current)
    has_all_scope = user_has_all_bu_scope(current)
    analysis_bu = resolve_analysis_business_unit(db, analysis)
    assert_bu_in_scope(allowed_bu_names, analysis_bu, has_all_scope=has_all_scope)


def _enforce_report_read_link_or_404(analysis: CreditAnalysis | None, read_id: int) -> None:
    if analysis is None:
        return
    raw_memory = getattr(analysis, "decision_memory_json", None)
    memory = raw_memory if isinstance(raw_memory, dict) else {}
    if int(read_id) not in collect_report_read_ids_from_links(memory):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leitura de relatorio nao vinculada a esta analise.")


def _enforce_report_import_access_or_403(db: Session, current: CurrentUser, analysis: CreditAnalysis | None) -> None:
    if analysis is None:
        require_permissions(["credit.dossier.edit"])(current=current)
        return

    _enforce_analysis_scope_or_403(db, current, analysis)
    analysis_bu = resolve_analysis_business_unit(db, analysis)
    if resolve_credit_workflow_action(
        db,
        current,
        action="import_technical_reports",
        analysis=analysis,
        business_unit=analysis_bu,
    ).allowed:
        return
    if resolve_credit_workflow_action(
        db,
        current,
        action="save_technical_analysis",
        analysis=analysis,
        business_unit=analysis_bu,
    ).allowed:
        return
    require_permissions(["credit.dossier.edit"])(current=current)


def _persist_analysis_report_document(
    *,
    db: Session,
    analysis: CreditAnalysis,
    source_type: str,
    payload: AgriskReportReadCreate | CofaceReportReadCreate,
    current: CurrentUser,
) -> AnalysisDocument:
    try:
        file_bytes = base64.b64decode(payload.file_content_base64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo invalido para importacao do relatorio.") from exc

    extension = Path(payload.original_filename).suffix or ".pdf"
    stored_filename = f"{uuid4().hex}{extension}"
    storage_dir = _analysis_documents_storage_root() / str(analysis.id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_path = storage_dir / stored_filename
    storage_path.write_bytes(file_bytes)

    document = AnalysisDocument(
        credit_analysis_id=analysis.id,
        document_type="agrisk_report" if source_type == "agrisk" else "coface_report",
        original_filename=payload.original_filename,
        stored_filename=stored_filename,
        mime_type=payload.mime_type or "application/pdf",
        file_size=payload.file_size,
        status="enviado",
        uploaded_by_user_id=current.user.id,
    )
    db.add(document)
    db.flush()
    return document


@router.post("/agrisk", response_model=AgriskReportReadResponse, status_code=status.HTTP_201_CREATED)
def create_agrisk_read(
    payload: AgriskReportReadCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AgriskReportReadResponse:
    analysis_id = payload.analysis_id
    analysis = db.get(CreditAnalysis, analysis_id) if analysis_id is not None else None
    if analysis_id is not None and analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analise de credito nao encontrada.")
    _enforce_report_import_access_or_403(db, current, analysis)

    if analysis is None:
        return _to_response(create_agrisk_report_read(db, payload))

    try:
        document = _persist_analysis_report_document(db=db, analysis=analysis, source_type="agrisk", payload=payload, current=current)
        entry = create_agrisk_report_read(db, payload, commit=False)
        report_type = resolve_agrisk_report_type(entry)
        analysis.decision_memory_json = upsert_agrisk_report_link(
            analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {},
            report_type=report_type,
            patch={
                "read_id": entry.id,
                "analysis_document_id": document.id,
                "updated_at": document.uploaded_at.isoformat() if document.uploaded_at else None,
            },
        )
        flag_modified(analysis, "decision_memory_json")
        db.commit()
        db.refresh(entry)
        return _to_response(entry)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha ao persistir e vincular leitura AgRisk para analysis_id=%s", analysis_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao persistir o relatorio AgRisk na analise.") from exc


@router.post("/coface", response_model=CofaceReportReadResponse, status_code=status.HTTP_201_CREATED)
def create_coface_read(
    payload: CofaceReportReadCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CofaceReportReadResponse:
    analysis_id = payload.analysis_id
    analysis = db.get(CreditAnalysis, analysis_id) if analysis_id is not None else None
    if analysis_id is not None and analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analise de credito nao encontrada.")
    _enforce_report_import_access_or_403(db, current, analysis)

    if analysis is None:
        return _to_coface_response(create_coface_report_read(db, payload))

    try:
        document = _persist_analysis_report_document(db=db, analysis=analysis, source_type="coface", payload=payload, current=current)
        entry = create_coface_report_read(db, payload, commit=False)
        memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
        links = dict(memory.get("report_links")) if isinstance(memory.get("report_links"), dict) else {}
        source_link = dict(links.get("coface")) if isinstance(links.get("coface"), dict) else {}
        source_link.update({
            "read_id": entry.id,
            "analysis_document_id": document.id,
            "updated_at": document.uploaded_at.isoformat() if document.uploaded_at else None,
        })
        links["coface"] = source_link
        memory["report_links"] = links
        analysis.decision_memory_json = memory
        flag_modified(analysis, "decision_memory_json")
        db.commit()
        db.refresh(entry)
        return _to_coface_response(entry)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha ao persistir e vincular leitura COFACE para analysis_id=%s", analysis_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao persistir o relatorio COFACE na analise.") from exc


@router.get("/coface/{read_id}", response_model=CofaceReportReadResponse)
def get_coface_read(
    read_id: int,
    analysis_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CofaceReportReadResponse:
    analysis = db.get(CreditAnalysis, analysis_id) if analysis_id is not None else None
    if analysis_id is not None and analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analise de credito nao encontrada.")
    _enforce_report_import_access_or_403(db, current, analysis)
    _enforce_report_read_link_or_404(analysis, read_id)
    entry = db.get(CreditReportRead, read_id)
    if entry is None or entry.source_type != "coface":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leitura de relatorio COFACE nao encontrada.",
        )
    return _to_coface_response(entry)


@router.get("/agrisk/{read_id}", response_model=AgriskReportReadResponse)
def get_agrisk_read(
    read_id: int,
    analysis_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> AgriskReportReadResponse:
    analysis = db.get(CreditAnalysis, analysis_id) if analysis_id is not None else None
    if analysis_id is not None and analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analise de credito nao encontrada.")
    _enforce_report_import_access_or_403(db, current, analysis)
    _enforce_report_read_link_or_404(analysis, read_id)
    entry = db.get(CreditReportRead, read_id)
    if entry is None or entry.source_type != "agrisk":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leitura de relatorio AgRisk nao encontrada.",
        )
    return _to_response(entry)
