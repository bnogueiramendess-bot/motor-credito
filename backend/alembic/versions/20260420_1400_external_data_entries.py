"""add external data entry and file tables

Revision ID: 20260420_1400
Revises: 20260420_1300
Create Date: 2026-04-20 14:00:00
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260420_1400"
down_revision = "20260420_1300"
branch_labels = None
depends_on = None


entry_method_enum = sa.Enum(
    "manual",
    "upload",
    "automatic",
    name="entry_method_enum",
    native_enum=False,
)
source_type_enum = sa.Enum(
    "agrisk",
    "serasa",
    "scr",
    "internal_sheet",
    "other",
    name="source_type_enum",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "external_data_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("entry_method", entry_method_enum, nullable=False),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("source_score", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("source_rating", sa.String(length=50), nullable=True),
        sa.Column("has_restrictions", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("protests_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("protests_amount", sa.Numeric(precision=18, scale=2), nullable=False, server_default="0"),
        sa.Column("lawsuits_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lawsuits_amount", sa.Numeric(precision=18, scale=2), nullable=False, server_default="0"),
        sa.Column("bounced_checks_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("declared_revenue", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("declared_indebtedness", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
    )
    op.create_index(
        op.f("ix_external_data_entries_credit_analysis_id"),
        "external_data_entries",
        ["credit_analysis_id"],
        unique=False,
    )
    op.create_index(op.f("ix_external_data_entries_id"), "external_data_entries", ["id"], unique=False)

    op.create_table(
        "external_data_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_data_entry_id", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["external_data_entry_id"], ["external_data_entries.id"]),
    )
    op.create_index(
        op.f("ix_external_data_files_external_data_entry_id"),
        "external_data_files",
        ["external_data_entry_id"],
        unique=False,
    )
    op.create_index(op.f("ix_external_data_files_id"), "external_data_files", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_external_data_files_id"), table_name="external_data_files")
    op.drop_index(op.f("ix_external_data_files_external_data_entry_id"), table_name="external_data_files")
    op.drop_table("external_data_files")

    op.drop_index(op.f("ix_external_data_entries_id"), table_name="external_data_entries")
    op.drop_index(op.f("ix_external_data_entries_credit_analysis_id"), table_name="external_data_entries")
    op.drop_table("external_data_entries")
