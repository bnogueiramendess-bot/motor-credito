"""initial credit domain tables

Revision ID: 20260420_1300
Revises:
Create Date: 2026-04-20 13:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260420_1300"
down_revision = None
branch_labels = None
depends_on = None


analysis_status_enum = sa.Enum(
    "created",
    "in_progress",
    "completed",
    name="analysis_status_enum",
    native_enum=False,
)
motor_result_enum = sa.Enum(
    "approved",
    "rejected",
    "manual_review",
    name="motor_result_enum",
    native_enum=False,
)
final_decision_enum = sa.Enum(
    "pending",
    "approved",
    "rejected",
    name="final_decision_enum",
    native_enum=False,
)
actor_type_enum = sa.Enum(
    "system",
    "user",
    name="actor_type_enum",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_name", sa.String(length=255), nullable=False),
        sa.Column("document_number", sa.String(length=30), nullable=False),
        sa.Column("segment", sa.String(length=100), nullable=False),
        sa.Column("region", sa.String(length=100), nullable=False),
        sa.Column("relationship_start_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_customers_id"), "customers", ["id"], unique=False)
    op.create_index(op.f("ix_customers_document_number"), "customers", ["document_number"], unique=True)

    op.create_table(
        "credit_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("protocol_number", sa.String(length=50), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("requested_limit", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("current_limit", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("exposure_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("annual_revenue_estimated", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("analysis_status", analysis_status_enum, nullable=False),
        sa.Column("motor_result", motor_result_enum, nullable=True),
        sa.Column("final_decision", final_decision_enum, nullable=True),
        sa.Column("suggested_limit", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("final_limit", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("assigned_analyst_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.UniqueConstraint("protocol_number"),
    )
    op.create_index(op.f("ix_credit_analyses_id"), "credit_analyses", ["id"], unique=False)
    op.create_index(op.f("ix_credit_analyses_protocol_number"), "credit_analyses", ["protocol_number"], unique=True)
    op.create_index(op.f("ix_credit_analyses_customer_id"), "credit_analyses", ["customer_id"], unique=False)

    op.create_table(
        "decision_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("actor_type", actor_type_enum, nullable=False),
        sa.Column("actor_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("event_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
    )
    op.create_index(op.f("ix_decision_events_id"), "decision_events", ["id"], unique=False)
    op.create_index(
        op.f("ix_decision_events_credit_analysis_id"),
        "decision_events",
        ["credit_analysis_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_decision_events_credit_analysis_id"), table_name="decision_events")
    op.drop_index(op.f("ix_decision_events_id"), table_name="decision_events")
    op.drop_table("decision_events")

    op.drop_index(op.f("ix_credit_analyses_customer_id"), table_name="credit_analyses")
    op.drop_index(op.f("ix_credit_analyses_protocol_number"), table_name="credit_analyses")
    op.drop_index(op.f("ix_credit_analyses_id"), table_name="credit_analyses")
    op.drop_table("credit_analyses")

    op.drop_index(op.f("ix_customers_document_number"), table_name="customers")
    op.drop_index(op.f("ix_customers_id"), table_name="customers")
    op.drop_table("customers")
