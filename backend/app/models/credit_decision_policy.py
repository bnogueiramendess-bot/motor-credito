from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CreditDecisionPolicy(Base):
    __tablename__ = "credit_decision_policies"
    __table_args__ = (UniqueConstraint("code", "version", name="uq_credit_decision_policy_code_version"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("draft", "active", "archived", name="credit_decision_policy_status_enum", native_enum=False),
        nullable=False,
        index=True,
    )
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    base_policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_decision_policies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    effective_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    config_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    activated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_status: Mapped[str] = mapped_column(
        Enum("UNPUBLISHED", "PUBLISHED", "REVOKED", name="credit_decision_policy_publication_status_enum", native_enum=False),
        nullable=False,
        default="UNPUBLISHED",
        server_default="UNPUBLISHED",
        index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    governance_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_decision_policy_governance_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
