from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ApprovalMatrixRuleRole(Base):
    __tablename__ = "approval_matrix_rule_roles"
    __table_args__ = (
        UniqueConstraint(
            "approval_matrix_rule_id",
            "workflow_role_id",
            name="uq_approval_matrix_rule_workflow_role",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    approval_matrix_rule_id: Mapped[int] = mapped_column(
        ForeignKey("approval_matrix_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_role_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    approval_matrix_rule = relationship("ApprovalMatrixRule", back_populates="role_links")
    workflow_role = relationship("WorkflowRole")
