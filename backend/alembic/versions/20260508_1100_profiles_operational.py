"""add operational profile fields

Revision ID: 20260508_1100
Revises: 20260507_1600
Create Date: 2026-05-08 11:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260508_1100"
down_revision = "20260507_1600"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("roles", sa.Column("company_id", sa.Integer(), nullable=True))
    op.add_column("roles", sa.Column("code", sa.String(length=32), nullable=True))
    op.add_column("roles", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("roles", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index(op.f("ix_roles_company_id"), "roles", ["company_id"], unique=False)

    op.execute(
        """
        UPDATE roles r
        SET company_id = u.company_id
        FROM users u
        WHERE u.role_id = r.id
          AND r.company_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE roles
        SET company_id = (SELECT id FROM companies ORDER BY id ASC LIMIT 1)
        WHERE company_id IS NULL
        """
    )
    op.execute(
        """
        WITH ordered_roles AS (
            SELECT id, company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY id) AS seq
            FROM roles
        )
        UPDATE roles r
        SET code = 'PERF-' || LPAD(ordered_roles.seq::text, 4, '0')
        FROM ordered_roles
        WHERE r.id = ordered_roles.id
          AND r.code IS NULL
        """
    )
    op.execute(
        """
        UPDATE roles
        SET is_system = TRUE
        WHERE name IN ('administrador_master', 'administrador_bu', 'analista', 'visualizador')
        """
    )

    op.alter_column("roles", "company_id", nullable=False)
    op.alter_column("roles", "code", nullable=False)
    op.create_unique_constraint("uq_role_company_code", "roles", ["company_id", "code"])
    op.drop_constraint("roles_name_key", "roles", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("roles_name_key", "roles", ["name"])
    op.drop_constraint("uq_role_company_code", "roles", type_="unique")
    op.drop_index(op.f("ix_roles_company_id"), table_name="roles")
    op.drop_column("roles", "is_system")
    op.drop_column("roles", "is_active")
    op.drop_column("roles", "code")
    op.drop_column("roles", "company_id")
