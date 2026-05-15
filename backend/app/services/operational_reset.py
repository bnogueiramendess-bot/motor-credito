from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import Base


RESET_DOMAIN_REGISTRY: dict[str, dict[str, object]] = {
    "credit_analysis": {
        "label": "Analises de Credito",
        "description": "Limpa workflow, scores e eventos da analise.",
        "tables": [
            "analysis_commercial_references",
            "analysis_documents",
            "analysis_request_metadata",
            "decision_events",
            "score_results",
            "credit_analyses",
        ],
    },
    "external_reports": {
        "label": "Relatorios Externos",
        "description": "Limpa leituras, enriquecimentos e arquivos externos.",
        "tables": [
            "external_data_files",
            "external_data_entries",
            "credit_report_reads",
        ],
    },
    "portfolio_ar": {
        "label": "Carteira / AR",
        "description": "Limpa importacoes, snapshots e historico de carteira.",
        "tables": [
            "ar_aging_bod_customer_rows",
            "ar_aging_bod_snapshots",
            "ar_aging_remark_rows",
            "ar_aging_group_consolidated_rows",
            "ar_aging_data_total_rows",
            "ar_aging_import_runs",
        ],
    },
    "customers": {
        "label": "Clientes",
        "description": "Limpa cadastro base operacional.",
        "tables": [
            "customers",
        ],
    },
    "operational_users": {
        "label": "Usuarios Operacionais",
        "description": "Limpa sessoes, convites, usuarios e BUs operacionais.",
        "tables": [
            "refresh_tokens",
            "audit_logs",
            "user_business_unit_scopes",
            "user_invitations",
            "users",
            "business_units",
        ],
    },
    "governance": {
        "label": "Governanca e Permissoes",
        "description": "Limpa RBAC e dados de governanca.",
        "tables": [
            "role_permissions",
            "permissions",
            "roles",
            "companies",
        ],
    },
    "credit_policies": {
        "label": "Politicas de Credito",
        "description": "Limpa politicas e regras do motor.",
        "tables": [
            "credit_policy_rules",
            "credit_policies",
        ],
    },
}

TOTAL_OPERATIONAL_DOMAINS: tuple[str, ...] = (
    "credit_analysis",
    "external_reports",
    "portfolio_ar",
    "customers",
    "operational_users",
    "governance",
    "credit_policies",
)


# Global child-to-parent ordering. Selected domain tables are projected onto this order.
GLOBAL_DELETE_ORDER: tuple[str, ...] = (
    "external_data_files",
    "analysis_commercial_references",
    "analysis_documents",
    "analysis_request_metadata",
    "decision_events",
    "score_results",
    "external_data_entries",
    "credit_analyses",
    "credit_report_reads",
    "ar_aging_bod_customer_rows",
    "ar_aging_bod_snapshots",
    "ar_aging_remark_rows",
    "ar_aging_group_consolidated_rows",
    "ar_aging_data_total_rows",
    "ar_aging_import_runs",
    "refresh_tokens",
    "audit_logs",
    "user_business_unit_scopes",
    "user_invitations",
    "users",
    "business_units",
    "role_permissions",
    "permissions",
    "roles",
    "companies",
    "credit_policy_rules",
    "credit_policies",
    "customers",
)

RESEED_CRITICAL_DOMAINS = {"operational_users", "governance"}


@dataclass
class ResetExecutionPlan:
    domains: list[str]
    table_order: list[str]
    should_reseed_master: bool
    is_total_reset: bool


def list_reset_domains() -> dict[str, dict[str, object]]:
    return RESET_DOMAIN_REGISTRY


def resolve_domains(requested_domains: list[str] | None) -> list[str]:
    if not requested_domains:
        return list(TOTAL_OPERATIONAL_DOMAINS)
    normalized: list[str] = []
    for domain in requested_domains:
        key = domain.strip().lower()
        if not key:
            continue
        if key in {"total", "total_operational", "reset_total_operational"}:
            return list(TOTAL_OPERATIONAL_DOMAINS)
        if key not in RESET_DOMAIN_REGISTRY:
            valid = ", ".join(sorted(list(RESET_DOMAIN_REGISTRY.keys()) + ["total_operational"]))
            raise ValueError(f"Dominio de reset invalido: {domain}. Dominios validos: {valid}.")
        if key not in normalized:
            normalized.append(key)
    return normalized or list(TOTAL_OPERATIONAL_DOMAINS)


def build_execution_plan(requested_domains: list[str] | None) -> ResetExecutionPlan:
    domains = resolve_domains(requested_domains)
    selected_tables: set[str] = set()
    for domain in domains:
        tables = RESET_DOMAIN_REGISTRY[domain]["tables"]
        selected_tables.update(str(table) for table in tables)  # type: ignore[arg-type]

    ordered = [table for table in GLOBAL_DELETE_ORDER if table in selected_tables]
    is_total_reset = set(domains) == set(TOTAL_OPERATIONAL_DOMAINS)
    should_reseed_master = is_total_reset or bool(RESEED_CRITICAL_DOMAINS.intersection(domains))
    return ResetExecutionPlan(
        domains=domains,
        table_order=ordered,
        should_reseed_master=should_reseed_master,
        is_total_reset=is_total_reset,
    )


def validate_registry_coverage() -> dict[str, list[str]]:
    orm_tables = sorted(Base.metadata.tables.keys())
    registry_tables = sorted(
        {
            str(table)
            for domain in RESET_DOMAIN_REGISTRY.values()
            for table in domain["tables"]  # type: ignore[index]
        }
    )
    missing_in_registry = sorted(set(orm_tables) - set(registry_tables))
    unknown_in_registry = sorted(set(registry_tables) - set(orm_tables))
    return {
        "orm_tables": orm_tables,
        "registry_tables": registry_tables,
        "missing_in_registry": missing_in_registry,
        "unknown_in_registry": unknown_in_registry,
    }


def execute_table_cleanup(db: Session, table_order: list[str]) -> tuple[int, list[dict[str, int | str | bool]]]:
    summary: list[dict[str, int | str | bool]] = []
    total_deleted = 0

    for table_name in table_order:
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

    return total_deleted, summary
