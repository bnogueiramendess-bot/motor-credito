"""add user governance fields

Revision ID: 20260508_1700
Revises: 20260508_1100
Create Date: 2026-05-08 17:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260508_1700"
down_revision = "20260508_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("user_code", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("username", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))

    op.execute(
        """
        WITH ordered_users AS (
            SELECT
                id,
                company_id,
                split_part(lower(email), '@', 1) AS base_username,
                ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY id) AS seq_by_company,
                ROW_NUMBER() OVER (PARTITION BY split_part(lower(email), '@', 1) ORDER BY id) AS seq_by_username
            FROM users
        )
        UPDATE users u
        SET
            user_code = 'USR-' || LPAD(ordered_users.seq_by_company::text, 4, '0'),
            username = CASE
                WHEN ordered_users.seq_by_username = 1 THEN ordered_users.base_username
                ELSE ordered_users.base_username || '.' || ordered_users.seq_by_username::text
            END
        FROM ordered_users
        WHERE u.id = ordered_users.id
        """
    )

    op.alter_column("users", "user_code", nullable=False)
    op.alter_column("users", "username", nullable=False)
    op.create_unique_constraint("uq_users_user_code", "users", ["user_code"])
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    op.create_index(op.f("ix_users_user_code"), "users", ["user_code"], unique=True)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_user_code"), table_name="users")
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_constraint("uq_users_user_code", "users", type_="unique")
    op.drop_column("users", "phone")
    op.drop_column("users", "username")
    op.drop_column("users", "user_code")
