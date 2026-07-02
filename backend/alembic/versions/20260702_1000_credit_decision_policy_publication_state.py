"""add domain publication state to credit decision policies

Revision ID: 20260702_1000
Revises: 20260630_1600
Create Date: 2026-07-02 10:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260702_1000"
down_revision = "20260630_1600"
branch_labels = None
depends_on = None


TABLE = "credit_decision_policies"
PUBLICATION_STATUS_CHECK = "publication_status IN ('UNPUBLISHED', 'PUBLISHED', 'REVOKED')"


def _columns() -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(TABLE)}


def _constraints() -> set[str]:
    bind = op.get_bind()
    return {constraint["name"] for constraint in inspect(bind).get_check_constraints(TABLE)}


def _indexes() -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in inspect(bind).get_indexes(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if "publication_status" not in columns:
        op.add_column(
            TABLE,
            sa.Column("publication_status", sa.String(length=20), nullable=False, server_default="UNPUBLISHED"),
        )
    if "published_at" not in columns:
        op.add_column(TABLE, sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    if "published_by_user_id" not in columns:
        op.add_column(TABLE, sa.Column("published_by_user_id", sa.Integer(), nullable=True))
    if "governance_request_id" not in columns:
        op.add_column(TABLE, sa.Column("governance_request_id", sa.Integer(), nullable=True))

    constraints = _constraints()
    if "ck_credit_decision_policy_publication_status" not in constraints:
        op.create_check_constraint(
            "ck_credit_decision_policy_publication_status",
            TABLE,
            PUBLICATION_STATUS_CHECK,
        )

    indexes = _indexes()
    if "ix_credit_decision_policies_publication_status" not in indexes:
        op.create_index("ix_credit_decision_policies_publication_status", TABLE, ["publication_status"])
    if "ix_credit_decision_policies_published_by_user_id" not in indexes:
        op.create_index("ix_credit_decision_policies_published_by_user_id", TABLE, ["published_by_user_id"])
    if "ix_credit_decision_policies_governance_request_id" not in indexes:
        op.create_index("ix_credit_decision_policies_governance_request_id", TABLE, ["governance_request_id"])

    bind = op.get_bind()
    fk_names = {fk["name"] for fk in inspect(bind).get_foreign_keys(TABLE)}
    if "fk_credit_decision_policies_published_by_user_id" not in fk_names:
        op.create_foreign_key(
            "fk_credit_decision_policies_published_by_user_id",
            TABLE,
            "users",
            ["published_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "fk_credit_decision_policies_governance_request_id" not in fk_names:
        op.create_foreign_key(
            "fk_credit_decision_policies_governance_request_id",
            TABLE,
            "credit_decision_policy_governance_requests",
            ["governance_request_id"],
            ["id"],
            ondelete="SET NULL",
        )

    bind.execute(text("""
        WITH publication_audits AS (
            SELECT DISTINCT ON (al.resource_id)
                al.resource_id::integer AS policy_id,
                al.created_at AS published_at,
                al.actor_user_id AS published_by_user_id,
                NULLIF(al.metadata_json ->> 'request_id', '')::integer AS governance_request_id
            FROM audit_logs al
            WHERE al.action = 'policy_publication_executed'
              AND al.resource = 'credit_decision_policy'
              AND al.resource_id ~ '^[0-9]+$'
              AND (
                  al.metadata_json IS NULL
                  OR al.metadata_json ->> 'request_id' IS NULL
                  OR al.metadata_json ->> 'request_id' ~ '^[0-9]+$'
              )
            ORDER BY al.resource_id, al.created_at DESC, al.id DESC
        )
        UPDATE credit_decision_policies p
        SET publication_status = 'PUBLISHED',
            published_at = COALESCE(p.published_at, publication_audits.published_at),
            published_by_user_id = COALESCE(p.published_by_user_id, publication_audits.published_by_user_id),
            governance_request_id = COALESCE(p.governance_request_id, publication_audits.governance_request_id)
        FROM publication_audits
        WHERE p.id = publication_audits.policy_id
          AND p.publication_status <> 'PUBLISHED'
    """))


def downgrade() -> None:
    constraints = _constraints()
    if "ck_credit_decision_policy_publication_status" in constraints:
        op.drop_constraint("ck_credit_decision_policy_publication_status", TABLE, type_="check")

    indexes = _indexes()
    for index_name in (
        "ix_credit_decision_policies_governance_request_id",
        "ix_credit_decision_policies_published_by_user_id",
        "ix_credit_decision_policies_publication_status",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name=TABLE)

    bind = op.get_bind()
    fk_names = {fk["name"] for fk in inspect(bind).get_foreign_keys(TABLE)}
    for fk_name in (
        "fk_credit_decision_policies_governance_request_id",
        "fk_credit_decision_policies_published_by_user_id",
    ):
        if fk_name in fk_names:
            op.drop_constraint(fk_name, TABLE, type_="foreignkey")

    columns = _columns()
    for column_name in ("governance_request_id", "published_by_user_id", "published_at", "publication_status"):
        if column_name in columns:
            op.drop_column(TABLE, column_name)
