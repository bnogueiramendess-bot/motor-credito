from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import Base


RESET_DOMAIN_REGISTRY: dict[str, dict[str, object]] = {
    "credit_analysis": {
        "label": "Analises de Credito",
        "group": "Dados Operacionais",
        "description": "Remove analises, score, decisoes, eventos, historico, workspace e memorias da analise.",
        "tables": ["external_data_files", "analysis_commercial_references", "analysis_documents", "analysis_request_metadata", "decision_events", "score_results", "external_data_entries", "credit_analyses"],
    },
    "approval_workflow": {
        "label": "Workflow de Aprovacao",
        "group": "Dados Operacionais",
        "description": "Remove todo o fluxo sequencial de aprovacao das analises.",
        "tables": ["workflow_approval_decisions", "workflow_approval_steps"],
    },
    "external_reports": {
        "label": "Relatorios Externos",
        "group": "Dados Mestres",
        "description": "Limpa leituras, enriquecimentos e arquivos externos.",
        "tables": ["external_data_files", "external_data_entries", "credit_report_reads"],
    },
    "portfolio_ar": {
        "label": "Carteira / AR",
        "group": "Dados Mestres",
        "description": "Limpa importacoes, snapshots e historico de carteira.",
        "tables": ["ar_aging_bod_customer_rows", "ar_aging_bod_snapshots", "ar_aging_remark_rows", "ar_aging_group_consolidated_rows", "ar_aging_data_total_rows", "ar_aging_import_runs"],
    },
    "customers": {"label": "Clientes", "group": "Dados Mestres", "description": "Limpa cadastro base operacional.", "tables": ["customers"]},
    "operational_users": {
        "label": "Usuarios Operacionais",
        "group": "Administracao",
        "description": "Limpa sessoes, convites, usuarios e BUs operacionais.",
        "tables": ["user_workflow_roles", "refresh_tokens", "audit_logs", "user_business_unit_scopes", "user_invitations", "users", "business_units"],
    },
    "workflow_roles": {
        "label": "Papeis do Workflow",
        "group": "Administracao",
        "description": "Remove papeis operacionais e vinculos de usuarios do workflow.",
        "tables": ["user_workflow_roles", "company_policy_governance_roles", "company_policy_governance_settings", "approval_matrix_rule_roles", "workflow_roles"],
    },
    "approval_matrix": {
        "label": "Matriz DOA",
        "group": "Administracao",
        "description": "Remove matriz de alcadas e regras de aprovacao de credito.",
        "tables": ["workflow_approval_decisions", "workflow_approval_steps", "approval_matrix_rule_roles", "approval_matrix_rules"],
    },
    "companies_permissions": {
        "label": "Empresas e Permissoes",
        "group": "Administracao",
        "description": "Remove empresas, perfis e permissoes operacionais.",
        "tables": ["company_policy_governance_roles", "company_policy_governance_settings", "user_workflow_roles", "refresh_tokens", "audit_logs", "user_business_unit_scopes", "user_invitations", "users", "business_units", "role_permissions", "permissions", "roles", "companies"],
    },
    "configurable_policy": {
        "label": "Politica Configuravel",
        "group": "Politica de Credito",
        "description": "Remove todas as versoes da Politica Configuravel e sua estrutura normalizada.",
        "tables": ["credit_decision_policy_score_ranges", "credit_decision_policy_indicators", "credit_decision_policy_subgroups", "credit_decision_policy_pillars", "credit_decision_policies"],
    },
    "policy_governance": {
        "label": "Governanca da Politica",
        "group": "Politica de Credito",
        "description": "Remove solicitacoes, aprovacoes e historico de governanca da Politica Configuravel.",
        "tables": ["credit_decision_policy_governance_request_approvals", "credit_decision_policy_governance_requests", "company_policy_governance_roles", "company_policy_governance_settings"],
    },
    "legacy_policies": {
        "label": "Politicas Legadas",
        "group": "Politica de Credito",
        "description": "Limpa politicas e regras legadas do motor de credito.",
        "tables": ["credit_policy_rules", "credit_policies"],
    },
}

TOTAL_OPERATIONAL_DOMAINS: tuple[str, ...] = (
    "credit_analysis", "approval_workflow", "external_reports", "portfolio_ar", "customers", "operational_users", "workflow_roles", "approval_matrix", "companies_permissions", "configurable_policy", "policy_governance", "legacy_policies",
)

GLOBAL_DELETE_ORDER: tuple[str, ...] = (
    "external_data_files", "analysis_commercial_references", "analysis_documents", "analysis_request_metadata", "workflow_approval_decisions", "workflow_approval_steps", "decision_events", "score_results", "external_data_entries", "credit_analyses", "credit_report_reads",
    "ar_aging_bod_customer_rows", "ar_aging_bod_snapshots", "ar_aging_remark_rows", "ar_aging_group_consolidated_rows", "ar_aging_data_total_rows", "ar_aging_import_runs",
    "credit_decision_policy_score_ranges", "credit_decision_policy_indicators", "credit_decision_policy_subgroups", "credit_decision_policy_pillars", "credit_decision_policy_governance_request_approvals", "credit_decision_policy_governance_requests", "credit_decision_policies",
    "company_policy_governance_roles", "company_policy_governance_settings", "approval_matrix_rule_roles", "approval_matrix_rules", "user_workflow_roles", "refresh_tokens", "audit_logs", "user_business_unit_scopes", "user_invitations", "users", "business_units", "role_permissions", "workflow_roles", "permissions", "roles", "companies", "credit_policy_rules", "credit_policies", "customers",
)

RESEED_CRITICAL_DOMAINS = {"operational_users", "companies_permissions"}

BUSINESS_IMPACT_METRICS: tuple[dict[str, str], ...] = (
    {"table": "credit_analyses", "label": "analises"},
    {"table": "customers", "label": "clientes"},
    {"table": "credit_decision_policies", "label": "versoes da politica configuravel"},
    {"table": "credit_policies", "label": "politicas legadas"},
    {"table": "credit_decision_policy_governance_requests", "label": "solicitacoes de governanca"},
    {"table": "credit_decision_policy_governance_request_approvals", "label": "aprovacoes de governanca"},
    {"table": "workflow_approval_decisions", "label": "decisoes do workflow"},
    {"table": "workflow_approval_steps", "label": "etapas de aprovacao"},
    {"table": "companies", "label": "empresas"},
    {"table": "decision_events", "label": "eventos"},
    {"table": "score_results", "label": "score results"},
    {"table": "external_data_entries", "label": "enriquecimentos externos"},
    {"table": "credit_report_reads", "label": "relatorios externos"},
    {"table": "ar_aging_import_runs", "label": "importacoes AR"},
    {"table": "users", "label": "usuarios operacionais"},
    {"table": "workflow_roles", "label": "papeis do workflow"},
    {"table": "approval_matrix_rules", "label": "regras DOA"},
)


@dataclass
class ResetExecutionPlan:
    domains: list[str]
    table_order: list[str]
    should_reseed_master: bool
    is_total_reset: bool


def list_reset_domains() -> dict[str, dict[str, object]]:
    return RESET_DOMAIN_REGISTRY


def _table_exists(db: Session, table_name: str) -> bool:
    exists = db.execute(text("SELECT to_regclass(:qualified_name) IS NOT NULL"), {"qualified_name": f"public.{table_name}"}).scalar_one()
    return bool(exists)


def count_business_impact(db: Session, table_order: list[str]) -> list[dict[str, int | str]]:
    selected_tables = set(table_order)
    preview: list[dict[str, int | str]] = []
    for metric in BUSINESS_IMPACT_METRICS:
        table_name = metric["table"]
        if table_name not in selected_tables or not _table_exists(db, table_name):
            continue
        count = int(db.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one() or 0)
        if count > 0:
            preview.append({"label": metric["label"], "count": count, "table": table_name})

    if "credit_decision_policies" in selected_tables and _table_exists(db, "credit_decision_policies"):
        policy_count = int(db.execute(text("SELECT COUNT(DISTINCT code) FROM credit_decision_policies")).scalar_one() or 0)
        if policy_count > 0:
            preview.insert(0, {"label": "politicas configuraveis", "count": policy_count, "table": "credit_decision_policies"})

    return preview


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
    return ResetExecutionPlan(domains=domains, table_order=ordered, should_reseed_master=should_reseed_master, is_total_reset=is_total_reset)


def validate_registry_coverage() -> dict[str, list[str]]:
    orm_tables = sorted(Base.metadata.tables.keys())
    registry_tables = sorted({str(table) for domain in RESET_DOMAIN_REGISTRY.values() for table in domain["tables"]})
    missing_in_registry = sorted(set(orm_tables) - set(registry_tables))
    unknown_in_registry = sorted(set(registry_tables) - set(orm_tables))
    return {"orm_tables": orm_tables, "registry_tables": registry_tables, "missing_in_registry": missing_in_registry, "unknown_in_registry": unknown_in_registry}


def execute_table_cleanup(db: Session, table_order: list[str]) -> tuple[int, list[dict[str, int | str | bool]]]:
    summary: list[dict[str, int | str | bool]] = []
    total_deleted = 0

    for table_name in table_order:
        if not _table_exists(db, table_name):
            summary.append({"table": table_name, "deleted": 0, "sequence_reset": False})
            continue

        deleted_rows = int(db.execute(text(f"DELETE FROM {table_name}")).rowcount or 0)
        total_deleted += deleted_rows

        sequence_name = db.execute(text("SELECT pg_get_serial_sequence(:table_name, 'id')"), {"table_name": table_name}).scalar_one_or_none()

        sequence_reset = False
        if sequence_name:
            db.execute(text(f"ALTER SEQUENCE {sequence_name} RESTART WITH 1"))
            sequence_reset = True

        summary.append({"table": table_name, "deleted": deleted_rows, "sequence_reset": sequence_reset})

    return total_deleted, summary
