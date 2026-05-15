"""step1 request metadata documents

Revision ID: 20260514_1830
Revises: 20260514_1500
Create Date: 2026-05-14 18:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260514_1830"
down_revision = "20260514_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_request_metadata",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("requested_term_days", sa.Integer(), nullable=True),
        sa.Column("business_unit", sa.String(length=120), nullable=True),
        sa.Column("customer_type", sa.String(length=80), nullable=True),
        sa.Column("operation_modality", sa.String(length=80), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("credit_analysis_id", name="uq_analysis_request_metadata_analysis_id"),
    )
    op.create_index(op.f("ix_analysis_request_metadata_id"), "analysis_request_metadata", ["id"], unique=False)
    op.create_index(
        op.f("ix_analysis_request_metadata_credit_analysis_id"),
        "analysis_request_metadata",
        ["credit_analysis_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_analysis_request_metadata_updated_by_user_id"),
        "analysis_request_metadata",
        ["updated_by_user_id"],
        unique=False,
    )

    op.create_table(
        "analysis_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("document_type", sa.String(length=120), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_analysis_documents_id"), "analysis_documents", ["id"], unique=False)
    op.create_index(op.f("ix_analysis_documents_credit_analysis_id"), "analysis_documents", ["credit_analysis_id"], unique=False)
    op.create_index(op.f("ix_analysis_documents_document_type"), "analysis_documents", ["document_type"], unique=False)
    op.create_index(op.f("ix_analysis_documents_uploaded_by_user_id"), "analysis_documents", ["uploaded_by_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_analysis_documents_uploaded_by_user_id"), table_name="analysis_documents")
    op.drop_index(op.f("ix_analysis_documents_document_type"), table_name="analysis_documents")
    op.drop_index(op.f("ix_analysis_documents_credit_analysis_id"), table_name="analysis_documents")
    op.drop_index(op.f("ix_analysis_documents_id"), table_name="analysis_documents")
    op.drop_table("analysis_documents")

    op.drop_index(op.f("ix_analysis_request_metadata_updated_by_user_id"), table_name="analysis_request_metadata")
    op.drop_index(op.f("ix_analysis_request_metadata_credit_analysis_id"), table_name="analysis_request_metadata")
    op.drop_index(op.f("ix_analysis_request_metadata_id"), table_name="analysis_request_metadata")
    op.drop_table("analysis_request_metadata")
