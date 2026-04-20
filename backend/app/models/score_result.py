from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import ScoreBand


class ScoreResult(Base):
    __tablename__ = "score_results"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_analysis_id: Mapped[int] = mapped_column(
        ForeignKey("credit_analyses.id"), nullable=False, unique=True, index=True
    )
    base_score: Mapped[int] = mapped_column(Integer, nullable=False)
    final_score: Mapped[int] = mapped_column(Integer, nullable=False)
    score_band: Mapped[ScoreBand] = mapped_column(
        Enum(ScoreBand, name="score_band_enum", native_enum=False),
        nullable=False,
    )
    calculation_memory_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    credit_analysis = relationship("CreditAnalysis", back_populates="score_result")
