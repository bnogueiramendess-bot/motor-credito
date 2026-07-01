from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, CheckConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class WorkflowApprovalStep(Base):
    __tablename__ = "workflow_approval_steps"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'ACTIVE', 'IN_COMMITTEE', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED')",
            name="ck_workflow_approval_step_status",
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
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="PENDING", index=True)
    decided_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    credit_analysis = relationship("CreditAnalysis")
    approval_matrix_rule = relationship("ApprovalMatrixRule")
    workflow_role = relationship("WorkflowRole")
    decided_by_user = relationship("User")
