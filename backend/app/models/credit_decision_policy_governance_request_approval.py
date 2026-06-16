from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CreditDecisionPolicyGovernanceRequestApproval(Base):
    __tablename__ = "credit_decision_policy_governance_request_approvals"
    __table_args__ = (
        UniqueConstraint(
            "request_id",
            "workflow_role_id",
            name="uq_policy_governance_request_approval_role",
        ),
        CheckConstraint(
            "decision IS NULL OR decision IN ('approved', 'rejected')",
            name="ck_policy_governance_request_approval_decision",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("credit_decision_policy_governance_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_role_id: Mapped[int] = mapped_column(ForeignKey("workflow_roles.id"), nullable=False, index=True)
    approved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    request = relationship("CreditDecisionPolicyGovernanceRequest", back_populates="approvals")
    workflow_role = relationship("WorkflowRole")
