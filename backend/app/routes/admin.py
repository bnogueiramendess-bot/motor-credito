from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])

REQUIRED_CONFIRMATION = "RESET_OPERATIONAL_DATA"

TABLES_TO_CLEAN = [
    "external_data_files",
    "decision_events",
    "score_results",
    "external_data_entries",
    "credit_analyses",
    "customers",
    "credit_report_reads",
    "ar_aging_bod_customer_rows",
    "ar_aging_bod_snapshots",
    "ar_aging_remark_rows",
    "ar_aging_group_consolidated_rows",
    "ar_aging_data_total_rows",
    "ar_aging_import_runs",
]


class ResetOperationalDataRequest(BaseModel):
    confirm: str


def _is_production_env() -> bool:
    for env_key in ("ENV", "APP_ENV", "ENVIRONMENT", "FASTAPI_ENV", "PYTHON_ENV"):
        value = os.getenv(env_key, "").strip().lower()
        if value in {"prod", "production"}:
            return True
    return False


def _guard_sensitive_environment(db: Session) -> None:
    if _is_production_env():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operacao bloqueada em ambiente de producao.",
        )

    identity = db.execute(
        text(
            """
            SELECT
                current_database()::text AS db_name,
                current_user::text AS db_user,
                COALESCE(inet_server_addr()::text, 'local_socket') AS server_addr
            """
        )
    ).mappings().one()

    db_name = str(identity["db_name"]).lower()
    if any(token in db_name for token in ("prod", "production")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operacao bloqueada por seguranca (database sensivel).",
        )


@router.post("/reset-operational-data")
def reset_operational_data(
    payload: ResetOperationalDataRequest,
    db: Session = Depends(get_db),
) -> dict:
    if payload.confirm != REQUIRED_CONFIRMATION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Operacao bloqueada. Esta rotina limpa dados operacionais. "
                "Use confirm=RESET_OPERATIONAL_DATA."
            ),
        )

    _guard_sensitive_environment(db)

    summary: list[dict[str, int | str | bool]] = []
    total_deleted = 0

    try:
        for table_name in TABLES_TO_CLEAN:
            exists = db.execute(
                text("SELECT to_regclass(:qualified_name) IS NOT NULL"),
                {"qualified_name": f"public.{table_name}"},
            ).scalar_one()
            if not exists:
                summary.append({"table": table_name, "deleted": 0, "sequence_reset": False})
                continue

            deleted_rows = int(db.execute(text(f"DELETE FROM {table_name}")).rowcount or 0)
            total_deleted += deleted_rows

            sequence_name = db.execute(
                text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
                {"table_name": table_name},
            ).scalar_one_or_none()

            sequence_reset = False
            if sequence_name:
                db.execute(text(f"ALTER SEQUENCE {sequence_name} RESTART WITH 1"))
                sequence_reset = True

            summary.append({"table": table_name, "deleted": deleted_rows, "sequence_reset": sequence_reset})

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "ok",
        "total_deleted": total_deleted,
        "tables": summary,
    }

