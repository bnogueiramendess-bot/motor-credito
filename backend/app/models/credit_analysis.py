from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import AnalysisStatus, FinalDecision, MotorResult


class CreditAnalysis(Base):
    __tablename__ = "credit_analyses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    protocol_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)

    requested_limit: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    current_limit: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    exposure_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    annual_revenue_estimated: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    analysis_status: Mapped[AnalysisStatus] = mapped_column(
        Enum(AnalysisStatus, name="analysis_status_enum", native_enum=False),
        default=AnalysisStatus.CREATED,
        nullable=False,
    )
    motor_result: Mapped[MotorResult | None] = mapped_column(
        Enum(MotorResult, name="motor_result_enum", native_enum=False),
        nullable=True,
    )
    final_decision: Mapped[FinalDecision | None] = mapped_column(
        Enum(FinalDecision, name="final_decision_enum", native_enum=False),
        nullable=True,
    )

    suggested_limit: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    final_limit: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    assigned_analyst_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    current_owner_role: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    last_owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    last_owner_role: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analysis_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_stage_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_for_approval_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analyst_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    decision_memory_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    decision_calculated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    customer = relationship("Customer", back_populates="credit_analyses")
    events = relationship(
        "DecisionEvent",
        back_populates="credit_analysis",
        cascade="all, delete-orphan",
        order_by="DecisionEvent.created_at",
    )
    external_data_entries = relationship(
        "ExternalDataEntry",
        back_populates="credit_analysis",
        cascade="all, delete-orphan",
        order_by="ExternalDataEntry.created_at",
    )
    score_result = relationship(
        "ScoreResult",
        back_populates="credit_analysis",
        cascade="all, delete-orphan",
        uselist=False,
    )
