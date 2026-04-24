"""add credit report reads table for agrisk ingestion

Revision ID: 20260423_1900
Revises: 20260422_0900
Create Date: 2026-04-23 19:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260423_1900"
down_revision = "20260422_0900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_report_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("customer_document_number", sa.String(length=30), nullable=False),
        sa.Column("report_document_number", sa.String(length=30), nullable=True),
        sa.Column("is_document_match", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("validation_message", sa.Text(), nullable=True),
        sa.Column("score_primary", sa.Integer(), nullable=True),
        sa.Column("score_source", sa.String(length=100), nullable=True),
        sa.Column("warnings_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("confidence", sa.String(length=20), nullable=True),
        sa.Column("read_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_credit_report_reads_id"), "credit_report_reads", ["id"], unique=False)
    op.create_index(op.f("ix_credit_report_reads_source_type"), "credit_report_reads", ["source_type"], unique=False)
    op.create_index(op.f("ix_credit_report_reads_status"), "credit_report_reads", ["status"], unique=False)
    op.create_index(
        op.f("ix_credit_report_reads_customer_document_number"),
        "credit_report_reads",
        ["customer_document_number"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_report_reads_report_document_number"),
        "credit_report_reads",
        ["report_document_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_credit_report_reads_report_document_number"), table_name="credit_report_reads")
    op.drop_index(op.f("ix_credit_report_reads_customer_document_number"), table_name="credit_report_reads")
    op.drop_index(op.f("ix_credit_report_reads_status"), table_name="credit_report_reads")
    op.drop_index(op.f("ix_credit_report_reads_source_type"), table_name="credit_report_reads")
    op.drop_index(op.f("ix_credit_report_reads_id"), table_name="credit_report_reads")
    op.drop_table("credit_report_reads")

