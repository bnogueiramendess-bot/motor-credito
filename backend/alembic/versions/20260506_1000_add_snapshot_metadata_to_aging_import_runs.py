"""add snapshot metadata to aging import runs

Revision ID: 20260506_1000
Revises: 20260430_1010
Create Date: 2026-05-06 10:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260506_1000"
down_revision = "20260430_1010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ar_aging_import_runs", sa.Column("snapshot_type", sa.String(length=30), nullable=False, server_default="daily"))
    op.add_column("ar_aging_import_runs", sa.Column("is_month_end_closing", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ar_aging_import_runs", sa.Column("closing_month", sa.Integer(), nullable=True))
    op.add_column("ar_aging_import_runs", sa.Column("closing_year", sa.Integer(), nullable=True))
    op.add_column("ar_aging_import_runs", sa.Column("closing_label", sa.String(length=40), nullable=True))
    op.add_column("ar_aging_import_runs", sa.Column("closing_status", sa.String(length=20), nullable=True))
    op.add_column("ar_aging_import_runs", sa.Column("closing_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ar_aging_import_runs", sa.Column("closing_created_by", sa.String(length=255), nullable=True))

    op.create_index(op.f("ix_ar_aging_import_runs_snapshot_type"), "ar_aging_import_runs", ["snapshot_type"], unique=False)
    op.create_index(op.f("ix_ar_aging_import_runs_is_month_end_closing"), "ar_aging_import_runs", ["is_month_end_closing"], unique=False)

    op.create_index(
        "uq_ar_aging_monthly_closing_official",
        "ar_aging_import_runs",
        ["closing_year", "closing_month"],
        unique=True,
        postgresql_where=sa.text("snapshot_type = 'monthly_closing' AND closing_status = 'official'"),
    )

    op.alter_column("ar_aging_import_runs", "snapshot_type", server_default=None)
    op.alter_column("ar_aging_import_runs", "is_month_end_closing", server_default=None)


def downgrade() -> None:
    op.drop_index("uq_ar_aging_monthly_closing_official", table_name="ar_aging_import_runs")
    op.drop_index(op.f("ix_ar_aging_import_runs_is_month_end_closing"), table_name="ar_aging_import_runs")
    op.drop_index(op.f("ix_ar_aging_import_runs_snapshot_type"), table_name="ar_aging_import_runs")

    op.drop_column("ar_aging_import_runs", "closing_created_by")
    op.drop_column("ar_aging_import_runs", "closing_created_at")
    op.drop_column("ar_aging_import_runs", "closing_status")
    op.drop_column("ar_aging_import_runs", "closing_label")
    op.drop_column("ar_aging_import_runs", "closing_year")
    op.drop_column("ar_aging_import_runs", "closing_month")
    op.drop_column("ar_aging_import_runs", "is_month_end_closing")
    op.drop_column("ar_aging_import_runs", "snapshot_type")
