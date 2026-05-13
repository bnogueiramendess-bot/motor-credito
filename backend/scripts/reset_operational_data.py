"""Safe reset of operational/test data for Portfolio and Credit Engine modules.

Usage:
    python scripts/reset_operational_data.py --confirm RESET_OPERATIONAL_DATA

This routine intentionally preserves structural/seed tables such as:
- alembic_version and migrations metadata
- credit_policies / credit_policy_rules
- users/auth tables (if any)
- fixed domain/config tables
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Allow direct execution from backend folder.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.db.session import engine

REQUIRED_CONFIRMATION = "RESET_OPERATIONAL_DATA"

# Child-to-parent delete order to preserve referential integrity.
TABLES_TO_CLEAN = [
    # Motor de Credito (operational)
    "external_data_files",
    "decision_events",
    "score_results",
    "external_data_entries",
    "credit_analyses",
    "customers",
    "credit_report_reads",
    # Gestao de Carteira / AR Aging (operational)
    "ar_aging_bod_customer_rows",
    "ar_aging_bod_snapshots",
    "ar_aging_remark_rows",
    "ar_aging_group_consolidated_rows",
    "ar_aging_data_total_rows",
    "ar_aging_import_runs",
    # Politica de credito (configuracao funcional)
    "credit_policy_rules",
    "credit_policies",
]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Limpa dados operacionais/testes sem alterar estrutura do banco."
    )
    parser.add_argument(
        "--confirm",
        type=str,
        default="",
        help=f"Confirme com o texto exato: {REQUIRED_CONFIRMATION}",
    )
    return parser.parse_args()


def _is_production_env() -> tuple[bool, list[str]]:
    blocking_vars = []
    for env_key in ("ENV", "APP_ENV", "ENVIRONMENT", "FASTAPI_ENV", "PYTHON_ENV"):
        value = os.getenv(env_key, "").strip().lower()
        if value in {"prod", "production"}:
            blocking_vars.append(f"{env_key}={value}")
    return (len(blocking_vars) > 0, blocking_vars)


def _read_db_identity(conn: Connection) -> dict[str, str]:
    # PostgreSQL-oriented identity snapshot.
    result = conn.execute(
        text(
            """
            SELECT
                current_database()::text AS db_name,
                current_user::text AS db_user,
                COALESCE(inet_server_addr()::text, 'local_socket') AS server_addr,
                COALESCE(inet_server_port()::text, 'unknown') AS server_port
            """
        )
    ).mappings().one()
    return {
        "db_name": str(result["db_name"]),
        "db_user": str(result["db_user"]),
        "server_addr": str(result["server_addr"]),
        "server_port": str(result["server_port"]),
    }


def _guard_against_production(conn: Connection) -> None:
    is_prod_env, blocking_vars = _is_production_env()
    if is_prod_env:
        details = ", ".join(blocking_vars)
        raise RuntimeError(
            f"Execucao bloqueada: ambiente identificado como producao ({details})."
        )

    identity = _read_db_identity(conn)
    db_name = identity["db_name"].lower()
    server_addr = identity["server_addr"].lower()
    database_url = settings.database_url.lower()

    risk_signals = []
    if any(token in db_name for token in ("prod", "production")):
        risk_signals.append(f"database={identity['db_name']}")
    if any(token in database_url for token in ("prod", "production")):
        risk_signals.append("DATABASE_URL contem token de producao")
    configured_local = any(token in database_url for token in ("localhost", "127.0.0.1"))
    if (
        server_addr not in {"127.0.0.1", "::1", "localhost", "local_socket"}
        and not configured_local
    ):
        risk_signals.append(f"host remoto detectado ({identity['server_addr']})")

    print("Banco conectado:")
    print(
        f"- database={identity['db_name']} user={identity['db_user']} "
        f"host={identity['server_addr']} port={identity['server_port']}"
    )

    if risk_signals:
        details = "; ".join(risk_signals)
        raise RuntimeError(
            f"Execucao bloqueada por seguranca: possivel ambiente sensivel ({details})."
        )


def _table_exists(conn: Connection, table_name: str) -> bool:
    exists_result = conn.execute(
        text("SELECT to_regclass(:qualified_name) IS NOT NULL"),
        {"qualified_name": f"public.{table_name}"},
    ).scalar_one()
    return bool(exists_result)


def _delete_table(conn: Connection, table_name: str) -> int:
    deleted_rows = conn.execute(text(f"DELETE FROM {table_name}")).rowcount or 0
    return int(deleted_rows)


def _reset_sequence_if_any(conn: Connection, table_name: str) -> bool:
    sequence_name = conn.execute(
        text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
        {"table_name": table_name},
    ).scalar_one_or_none()

    if not sequence_name:
        return False

    conn.execute(text(f"ALTER SEQUENCE {sequence_name} RESTART WITH 1"))
    return True


def run_reset() -> None:
    args = _parse_args()
    if args.confirm != REQUIRED_CONFIRMATION:
        print("Operacao bloqueada. Esta rotina limpa dados operacionais. Para executar, use:")
        print("python scripts/reset_operational_data.py --confirm RESET_OPERATIONAL_DATA")
        raise SystemExit(1)

    deleted_summary: list[tuple[str, int, bool]] = []

    with engine.begin() as conn:
        _guard_against_production(conn)

        for table_name in TABLES_TO_CLEAN:
            if not _table_exists(conn, table_name):
                deleted_summary.append((table_name, 0, False))
                continue

            deleted_rows = _delete_table(conn, table_name)
            sequence_reset = _reset_sequence_if_any(conn, table_name)
            deleted_summary.append((table_name, deleted_rows, sequence_reset))

    print("\nResumo da limpeza operacional:")
    total_deleted = 0
    for table_name, deleted_rows, sequence_reset in deleted_summary:
        total_deleted += deleted_rows
        suffix = " (sequence reiniciada)" if sequence_reset else ""
        print(f"- {table_name}: {deleted_rows} registros removidos{suffix}")
    print(f"Total removido: {total_deleted} registros")


if __name__ == "__main__":
    run_reset()
