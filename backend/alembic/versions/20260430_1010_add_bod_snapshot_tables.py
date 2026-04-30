"""add bod snapshot tables

Revision ID: 20260430_1010
Revises: 20260429_1315
Create Date: 2026-04-30 10:10:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260430_1010"
down_revision = "20260429_1315"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ar_aging_bod_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_run_id", sa.Integer(), sa.ForeignKey("ar_aging_import_runs.id"), nullable=False),
        sa.Column("reference_date", sa.Date(), nullable=True),
        sa.Column("probable_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("possible_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("rare_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("probable_customers_count", sa.Integer(), nullable=True),
        sa.Column("possible_customers_count", sa.Integer(), nullable=True),
        sa.Column("rare_customers_count", sa.Integer(), nullable=True),
        sa.Column("not_due_buckets_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("overdue_buckets_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("totals_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("raw_bod_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("warnings_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_bod_snapshots_id"), "ar_aging_bod_snapshots", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_bod_snapshots_import_run_id"), "ar_aging_bod_snapshots", ["import_run_id"], unique=True)

    op.create_table(
        "ar_aging_bod_customer_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bod_snapshot_id", sa.Integer(), sa.ForeignKey("ar_aging_bod_snapshots.id"), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_document", sa.String(length=30), nullable=True),
        sa.Column("group_name", sa.String(length=255), nullable=True),
        sa.Column("total_open_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("overdue_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("not_due_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("insured_limit_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("exposure_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("risk_category", sa.String(length=50), nullable=True),
        sa.Column("aging_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("remarks_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("raw_row_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_bod_customer_rows_id"), "ar_aging_bod_customer_rows", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_bod_customer_rows_bod_snapshot_id"), "ar_aging_bod_customer_rows", ["bod_snapshot_id"], unique=False)
    op.create_index(op.f("ix_ar_aging_bod_customer_rows_customer_document"), "ar_aging_bod_customer_rows", ["customer_document"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ar_aging_bod_customer_rows_customer_document"), table_name="ar_aging_bod_customer_rows")
    op.drop_index(op.f("ix_ar_aging_bod_customer_rows_bod_snapshot_id"), table_name="ar_aging_bod_customer_rows")
    op.drop_index(op.f("ix_ar_aging_bod_customer_rows_id"), table_name="ar_aging_bod_customer_rows")
    op.drop_table("ar_aging_bod_customer_rows")

    op.drop_index(op.f("ix_ar_aging_bod_snapshots_import_run_id"), table_name="ar_aging_bod_snapshots")
    op.drop_index(op.f("ix_ar_aging_bod_snapshots_id"), table_name="ar_aging_bod_snapshots")
    op.drop_table("ar_aging_bod_snapshots")
