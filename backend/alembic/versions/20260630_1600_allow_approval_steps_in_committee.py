"""allow approval steps in committee

Revision ID: 20260630_1600
Revises: 20260630_1500
Create Date: 2026-06-30 16:00:00
"""

from alembic import op


revision = "20260630_1600"
down_revision = "20260630_1500"
branch_labels = None
depends_on = None


OLD_STATUS_CHECK = "status IN ('PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED')"
NEW_STATUS_CHECK = "status IN ('PENDING', 'ACTIVE', 'IN_COMMITTEE', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED')"


def upgrade() -> None:
    with op.batch_alter_table("workflow_approval_steps") as batch_op:
        batch_op.drop_constraint("ck_workflow_approval_step_status", type_="check")
        batch_op.create_check_constraint("ck_workflow_approval_step_status", NEW_STATUS_CHECK)


def downgrade() -> None:
    with op.batch_alter_table("workflow_approval_steps") as batch_op:
        batch_op.drop_constraint("ck_workflow_approval_step_status", type_="check")
        batch_op.create_check_constraint("ck_workflow_approval_step_status", OLD_STATUS_CHECK)