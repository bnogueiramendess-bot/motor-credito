"""add step1 contact fields to analysis request metadata

Revision ID: 20260515_1500
Revises: 20260515_1100
Create Date: 2026-05-15 15:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260515_1500"
down_revision = "20260515_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analysis_request_metadata", sa.Column("contact_name", sa.String(length=180), nullable=True))
    op.add_column("analysis_request_metadata", sa.Column("contact_phone", sa.String(length=40), nullable=True))
    op.add_column("analysis_request_metadata", sa.Column("contact_email", sa.String(length=180), nullable=True))


def downgrade() -> None:
    op.drop_column("analysis_request_metadata", "contact_email")
    op.drop_column("analysis_request_metadata", "contact_phone")
    op.drop_column("analysis_request_metadata", "contact_name")

