from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.enums import ActorType, AnalysisStatus
from app.models.external_data_entry import ExternalDataEntry
from app.models.external_data_file import ExternalDataFile
from app.models.score_result import ScoreResult
from app.schemas.credit_analysis import CreditAnalysisCreate, CreditAnalysisRead
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

router = APIRouter(prefix="/credit-analyses", tags=["credit-analyses"])


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
def get_score_result(analysis_id: int, db: Session = Depends(get_db)) -> ScoreResult:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
def get_decision_result(analysis_id: int, db: Session = Depends(get_db)) -> DecisionResultResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
def get_analysis_final_decision(analysis_id: int, db: Session = Depends(get_db)) -> FinalDecisionResponse:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credit analysis not found.",
        )

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
