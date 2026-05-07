"""add company profile fields and domains list

Revision ID: 20260507_1600
Revises: 20260507_1400
Create Date: 2026-05-07 16:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260507_1600"
down_revision = "20260507_1400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("legal_name", sa.String(length=255), nullable=True))
    op.add_column("companies", sa.Column("trade_name", sa.String(length=255), nullable=True))
    op.add_column("companies", sa.Column("cnpj", sa.String(length=20), nullable=True))
    op.add_column("companies", sa.Column("allowed_domains_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("companies", sa.Column("corporate_email_required", sa.Boolean(), nullable=False, server_default=sa.true()))

    op.execute("UPDATE companies SET legal_name = name WHERE legal_name IS NULL")
    op.execute("UPDATE companies SET allowed_domains_json = to_jsonb(ARRAY[allowed_domain]) WHERE allowed_domains_json IS NULL")

    op.alter_column("companies", "legal_name", nullable=False)
    op.alter_column("companies", "allowed_domains_json", nullable=False)


def downgrade() -> None:
    op.drop_column("companies", "corporate_email_required")
    op.drop_column("companies", "allowed_domains_json")
    op.drop_column("companies", "cnpj")
    op.drop_column("companies", "trade_name")
    op.drop_column("companies", "legal_name")
