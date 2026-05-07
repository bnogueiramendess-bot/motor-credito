"""add head fields and unique name for business units

Revision ID: 20260507_1400
Revises: 20260507_1100
Create Date: 2026-05-07 14:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260507_1400"
down_revision = "20260507_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("business_units", sa.Column("head_name", sa.String(length=255), nullable=True))
    op.add_column("business_units", sa.Column("head_email", sa.String(length=255), nullable=True))

    op.execute("UPDATE business_units SET head_name = 'Nao informado' WHERE head_name IS NULL")
    op.execute("UPDATE business_units SET head_email = 'nao.informado@indorama.com' WHERE head_email IS NULL")

    op.alter_column("business_units", "head_name", nullable=False)
    op.alter_column("business_units", "head_email", nullable=False)
    op.create_unique_constraint("uq_bu_company_name", "business_units", ["company_id", "name"])


def downgrade() -> None:
    op.drop_constraint("uq_bu_company_name", "business_units", type_="unique")
    op.drop_column("business_units", "head_email")
    op.drop_column("business_units", "head_name")
