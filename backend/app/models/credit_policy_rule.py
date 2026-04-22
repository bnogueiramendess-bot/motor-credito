from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import ScoreBand


class CreditPolicyRule(Base):
    __tablename__ = "credit_policy_rules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(
        ForeignKey("credit_policies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score_band: Mapped[ScoreBand | None] = mapped_column(
        Enum(ScoreBand, name="score_band_enum", native_enum=False),
        nullable=True,
    )
    pillar: Mapped[str] = mapped_column(String(100), nullable=False)
    field: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    operator: Mapped[str] = mapped_column(String(20), nullable=False, default="eq")
    value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    policy = relationship("CreditPolicy", back_populates="rules")
