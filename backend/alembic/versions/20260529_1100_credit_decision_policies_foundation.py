"""add configurable credit decision policies foundation

Revision ID: 20260529_1100
Revises: 20260521_1600
Create Date: 2026-05-29 11:00:00
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260529_1100"
down_revision = "20260521_1600"
branch_labels = None
depends_on = None


credit_decision_policy_status_enum = sa.Enum(
    "draft",
    "active",
    "archived",
    name="credit_decision_policy_status_enum",
    native_enum=False,
)


DEFAULT_POLICY_CONFIG = {
    "decision_scenarios": {
        "existing_customer_with_coface": {
            "enabled": True,
            "requires_financial_calculation": False,
            "rules": [
                {
                    "code": "coface_equals_current_limit",
                    "condition": "coface_limit == current_limit",
                    "recommendation_code": "maintain_current_limit",
                    "recommended_limit_source": "current_limit",
                    "label": "Manutencao do Limite Atual",
                },
                {
                    "code": "coface_below_current_limit",
                    "condition": "coface_limit < current_limit",
                    "recommendation_code": "reduce_to_coface_limit",
                    "recommended_limit_source": "coface_limit",
                    "label": "Reducao de Limite devido Exposicao com a COFACE",
                },
                {
                    "code": "requested_above_coface",
                    "condition": "coface_limit > current_limit && requested_limit > coface_limit",
                    "recommendation_code": "increase_to_coface_limit",
                    "recommended_limit_source": "coface_limit",
                    "label": "Aumento do Limite conforme Cobertura da COFACE",
                },
                {
                    "code": "requested_within_coface",
                    "condition": "coface_limit > current_limit && requested_limit <= coface_limit",
                    "recommendation_code": "approve_requested_with_coface",
                    "recommended_limit_source": "requested_limit",
                    "label": "Aprovacao do Limite Solicitado conforme Cobertura da COFACE",
                },
            ],
        }
    },
    "pillar_weights": {
        "financial_stability_liquidity": 55,
        "guarantees_credit_insurance": 20,
        "market_conditions": 15,
        "payment_history": 5,
        "relationship_history": 5,
    },
}


def upgrade() -> None:
    op.create_table(
        "credit_decision_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", credit_decision_policy_status_enum, nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("config_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("activated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["activated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", "version", name="uq_credit_decision_policy_code_version"),
    )
    op.create_index(op.f("ix_credit_decision_policies_id"), "credit_decision_policies", ["id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policies_code"), "credit_decision_policies", ["code"], unique=False)
    op.create_index(op.f("ix_credit_decision_policies_status"), "credit_decision_policies", ["status"], unique=False)
    op.create_index(
        op.f("ix_credit_decision_policies_created_by_user_id"),
        "credit_decision_policies",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_decision_policies_updated_by_user_id"),
        "credit_decision_policies",
        ["updated_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_decision_policies_activated_by_user_id"),
        "credit_decision_policies",
        ["activated_by_user_id"],
        unique=False,
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO credit_decision_policies (
                code, name, version, status, description, config_json, effective_from, activated_at
            )
            SELECT
                :code, :name, :version, :status, :description, CAST(:config_json AS jsonb), now(), now()
            WHERE NOT EXISTS (
                SELECT 1
                FROM credit_decision_policies
                WHERE code = :code AND version = :version
            )
            """
        ),
        {
            "code": "coface_first",
            "name": "Politica Padrao COFACE-first",
            "version": 1,
            "status": "active",
            "description": "Fundacao inicial para politica configuravel do motor sem alteracao de execucao.",
            "config_json": json.dumps(DEFAULT_POLICY_CONFIG),
        },
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_credit_decision_policies_activated_by_user_id"), table_name="credit_decision_policies")
    op.drop_index(op.f("ix_credit_decision_policies_updated_by_user_id"), table_name="credit_decision_policies")
    op.drop_index(op.f("ix_credit_decision_policies_created_by_user_id"), table_name="credit_decision_policies")
    op.drop_index(op.f("ix_credit_decision_policies_status"), table_name="credit_decision_policies")
    op.drop_index(op.f("ix_credit_decision_policies_code"), table_name="credit_decision_policies")
    op.drop_index(op.f("ix_credit_decision_policies_id"), table_name="credit_decision_policies")
    op.drop_table("credit_decision_policies")
