from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import CreditPolicyStatus


class CreditPolicy(Base):
    __tablename__ = "credit_policies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[CreditPolicyStatus] = mapped_column(
        Enum(CreditPolicyStatus, name="credit_policy_status_enum", native_enum=False),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    policy_type: Mapped[str] = mapped_column(String(50), nullable=False, default="persisted")
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="database")
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    rules = relationship(
        "CreditPolicyRule",
        back_populates="policy",
        cascade="all, delete-orphan",
        order_by="CreditPolicyRule.order_index, CreditPolicyRule.id",
    )
