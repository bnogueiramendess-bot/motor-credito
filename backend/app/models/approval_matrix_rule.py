from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ApprovalMatrixRule(Base):
    __tablename__ = "approval_matrix_rules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    min_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    max_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="BRL")
    required_approvals: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    requires_committee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_unanimous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    business_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_units.id", ondelete="CASCADE"), nullable=True, index=True
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    role_links = relationship(
        "ApprovalMatrixRuleRole",
        back_populates="approval_matrix_rule",
        cascade="all, delete-orphan",
    )
