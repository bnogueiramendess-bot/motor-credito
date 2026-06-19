from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CompanyPolicyGovernanceRole(Base):
    """Company-scoped approval roles for credit policy governance."""

    __tablename__ = "company_policy_governance_roles"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "approval_type",
            "workflow_role_id",
            name="uq_company_policy_governance_role_type_role",
        ),
        CheckConstraint(
            "approval_type IN ('POLICY_PUBLISH', 'POLICY_ARCHIVE', 'POLICY_STRUCTURE_CHANGE')",
            name="ck_company_policy_governance_roles_approval_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    approval_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    workflow_role_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    workflow_role = relationship("WorkflowRole")
