from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class WorkflowApprovalDecision(Base):
    __tablename__ = "workflow_approval_decisions"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'ESCALATED_TO_COMMITTEE')",
            name="ck_workflow_approval_decision",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_analysis_id: Mapped[int] = mapped_column(
        ForeignKey("credit_analyses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    approval_matrix_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("approval_matrix_rules.id", ondelete="SET NULL"), nullable=True, index=True
    )
    workflow_role_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_roles.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    decision: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    comment: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    credit_analysis = relationship("CreditAnalysis")
    approval_matrix_rule = relationship("ApprovalMatrixRule")
    workflow_role = relationship("WorkflowRole")
    user = relationship("User")
