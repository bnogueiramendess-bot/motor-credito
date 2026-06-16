from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CompanyPolicyGovernanceSetting(Base):
    """Company-scoped approval roles for administrative policy actions."""

    __tablename__ = "company_policy_governance_settings"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "action_type",
            "workflow_role_id",
            name="uq_company_policy_governance_action_role",
        ),
        CheckConstraint(
            "action_type IN ('policy_create', 'policy_edit', 'policy_archive', 'policy_publish')",
            name="ck_company_policy_governance_action_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    workflow_role_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    workflow_role = relationship("WorkflowRole")
