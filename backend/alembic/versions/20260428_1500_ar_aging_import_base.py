"""add aging ar import tables

Revision ID: 20260428_1500
Revises: 20260423_1900
Create Date: 2026-04-28 15:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260428_1500"
down_revision = "20260423_1900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ar_aging_import_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("base_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("warnings_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("totals_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_import_runs_id"), "ar_aging_import_runs", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_import_runs_base_date"), "ar_aging_import_runs", ["base_date"], unique=False)
    op.create_index(op.f("ix_ar_aging_import_runs_status"), "ar_aging_import_runs", ["status"], unique=False)

    op.create_table(
        "ar_aging_data_total_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_run_id", sa.Integer(), sa.ForeignKey("ar_aging_import_runs.id"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("cnpj_raw", sa.String(length=30), nullable=True),
        sa.Column("cnpj_normalized", sa.String(length=14), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("bu_raw", sa.String(length=100), nullable=True),
        sa.Column("bu_normalized", sa.String(length=50), nullable=True),
        sa.Column("economic_group_raw", sa.String(length=255), nullable=True),
        sa.Column("economic_group_normalized", sa.String(length=255), nullable=True),
        sa.Column("open_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("due_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("overdue_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("aging_label", sa.String(length=100), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_data_total_rows_id"), "ar_aging_data_total_rows", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_data_total_rows_import_run_id"), "ar_aging_data_total_rows", ["import_run_id"], unique=False)
    op.create_index(op.f("ix_ar_aging_data_total_rows_cnpj_normalized"), "ar_aging_data_total_rows", ["cnpj_normalized"], unique=False)
    op.create_index(op.f("ix_ar_aging_data_total_rows_bu_normalized"), "ar_aging_data_total_rows", ["bu_normalized"], unique=False)
    op.create_index(op.f("ix_ar_aging_data_total_rows_economic_group_normalized"), "ar_aging_data_total_rows", ["economic_group_normalized"], unique=False)

    op.create_table(
        "ar_aging_group_consolidated_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_run_id", sa.Integer(), sa.ForeignKey("ar_aging_import_runs.id"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("economic_group_raw", sa.String(length=255), nullable=True),
        sa.Column("economic_group_normalized", sa.String(length=255), nullable=True),
        sa.Column("overdue_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("not_due_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("aging_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("insured_limit_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("exposure_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_group_consolidated_rows_id"), "ar_aging_group_consolidated_rows", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_group_consolidated_rows_import_run_id"), "ar_aging_group_consolidated_rows", ["import_run_id"], unique=False)
    op.create_index(op.f("ix_ar_aging_group_consolidated_rows_economic_group_normalized"), "ar_aging_group_consolidated_rows", ["economic_group_normalized"], unique=False)

    op.create_table(
        "ar_aging_remark_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_run_id", sa.Integer(), sa.ForeignKey("ar_aging_import_runs.id"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("customer_or_group_raw", sa.String(length=255), nullable=True),
        sa.Column("customer_or_group_normalized", sa.String(length=255), nullable=True),
        sa.Column("remark_text", sa.Text(), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ar_aging_remark_rows_id"), "ar_aging_remark_rows", ["id"], unique=False)
    op.create_index(op.f("ix_ar_aging_remark_rows_import_run_id"), "ar_aging_remark_rows", ["import_run_id"], unique=False)
    op.create_index(op.f("ix_ar_aging_remark_rows_customer_or_group_normalized"), "ar_aging_remark_rows", ["customer_or_group_normalized"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ar_aging_remark_rows_customer_or_group_normalized"), table_name="ar_aging_remark_rows")
    op.drop_index(op.f("ix_ar_aging_remark_rows_import_run_id"), table_name="ar_aging_remark_rows")
    op.drop_index(op.f("ix_ar_aging_remark_rows_id"), table_name="ar_aging_remark_rows")
    op.drop_table("ar_aging_remark_rows")

    op.drop_index(op.f("ix_ar_aging_group_consolidated_rows_economic_group_normalized"), table_name="ar_aging_group_consolidated_rows")
    op.drop_index(op.f("ix_ar_aging_group_consolidated_rows_import_run_id"), table_name="ar_aging_group_consolidated_rows")
    op.drop_index(op.f("ix_ar_aging_group_consolidated_rows_id"), table_name="ar_aging_group_consolidated_rows")
    op.drop_table("ar_aging_group_consolidated_rows")

    op.drop_index(op.f("ix_ar_aging_data_total_rows_economic_group_normalized"), table_name="ar_aging_data_total_rows")
    op.drop_index(op.f("ix_ar_aging_data_total_rows_bu_normalized"), table_name="ar_aging_data_total_rows")
    op.drop_index(op.f("ix_ar_aging_data_total_rows_cnpj_normalized"), table_name="ar_aging_data_total_rows")
    op.drop_index(op.f("ix_ar_aging_data_total_rows_import_run_id"), table_name="ar_aging_data_total_rows")
    op.drop_index(op.f("ix_ar_aging_data_total_rows_id"), table_name="ar_aging_data_total_rows")
    op.drop_table("ar_aging_data_total_rows")

    op.drop_index(op.f("ix_ar_aging_import_runs_status"), table_name="ar_aging_import_runs")
    op.drop_index(op.f("ix_ar_aging_import_runs_base_date"), table_name="ar_aging_import_runs")
    op.drop_index(op.f("ix_ar_aging_import_runs_id"), table_name="ar_aging_import_runs")
    op.drop_table("ar_aging_import_runs")
