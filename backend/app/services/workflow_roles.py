from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, object_session

from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole

logger = logging.getLogger(__name__)

ACTIVE_OPERATIONAL_WORKFLOW_ROLE_CODES: tuple[str, ...] = (
    "CREDIT_REQUESTER",
    "CREDIT_ANALYST",
    "CREDIT_CONSULTANT",
)

LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODES: tuple[str, ...] = (
    "CREDIT_REVIEWER",
    "CREDIT_OPINION",
)

WORKFLOW_ROLE_AUTHORIZATION_COMPATIBILITY: dict[str, str] = {
    "CREDIT_REVIEWER": "CREDIT_ANALYST",
    "CREDIT_OPINION": "CREDIT_ANALYST",
}

# Historical storage still uses workflow_roles.type, but the business concept is
# "Papeis de Aprovacao (DOA)". Keep this boundary explicit so future committee
# roles do not depend on type="approval" or on operational roles.
DOA_APPROVAL_WORKFLOW_ROLE_TYPES: tuple[str, ...] = ("governance", "approval")
COMMITTEE_COMPATIBILITY_WORKFLOW_ROLE_CODES: tuple[str, ...] = ("CREDIT_COMMITTEE",)

WORKFLOW_ROLE_CATALOG: list[dict[str, str]] = [
    {
        "code": "CREDIT_REQUESTER",
        "name": "Solicitante",
        "type": "operational",
        "description": "Pode abrir solicitações de crédito.",
    },
    {
        "code": "CREDIT_ANALYST",
        "name": "Analista de Crédito",
        "type": "operational",
        "description": "Executa a analise de credito completa: documentos, integracoes, politica, score, parecer tecnico, dossie e envio para aprovacao DOA.",
    },
    {
        "code": "CREDIT_CONSULTANT",
        "name": "Consultor",
        "type": "operational",
        "description": "Pode consultar análises, decisões e históricos sem realizar alterações.",
    },
    {
        "code": "CREDIT_COMMITTEE",
        "name": "Comitê de Crédito",
        "type": "governance",
        "description": "Compatibilidade para excecoes colegiadas na DOA atual. O Comite futuro tera arquitetura propria.",
    },
    {
        "code": "CREDIT_FINANCE_HEAD",
        "name": "Finance Head",
        "type": "approval",
        "description": "Papel de aprovação conforme alçada.",
    },
    {
        "code": "CREDIT_FINANCE_DIRECTOR",
        "name": "Finance Director",
        "type": "approval",
        "description": "Papel de aprovação conforme alçada.",
    },
    {
        "code": "CREDIT_GROUP_CFO",
        "name": "Group CFO",
        "type": "approval",
        "description": "Papel executivo de aprovação conforme DoA.",
    },
    {
        "code": "CREDIT_CEO",
        "name": "CEO",
        "type": "approval",
        "description": "Papel máximo de aprovação conforme DoA.",
    },
    {
        "code": "CREDIT_COMMERCIAL_HEAD",
        "name": "Commercial Head",
        "type": "approval",
        "description": "Papel comercial em aprovações conjuntas/exceções.",
    },
    {
        "code": "CEO",
        "name": "CEO",
        "type": "governance",
        "description": "Papel de aprovacao DOA e governanca de credito para politicas.",
    },
    {
        "code": "CFO",
        "name": "CFO",
        "type": "governance",
        "description": "Papel de aprovacao DOA e governanca de credito para politicas.",
    },
    {
        "code": "HEAD_COMMERCIAL",
        "name": "Head Comercial",
        "type": "governance",
        "description": "Papel de aprovacao DOA e governanca de credito para politicas.",
    },
    {
        "code": "HEAD_OPERATIONS",
        "name": "Head de Operações",
        "type": "governance",
        "description": "Governanca de credito para administracao de politicas e workflow.",
    },
    {
        "code": "HEAD_FINANCE",
        "name": "Head Financeiro",
        "type": "governance",
        "description": "Papel de aprovacao DOA e governanca de credito para politicas.",
    },
    {
        "code": "LEGAL",
        "name": "Jurídico",
        "type": "governance",
        "description": "Governanca de credito para administracao juridica de politicas.",
    },
]


def ensure_workflow_roles_seed(db: Session) -> None:
    try:
        for item in WORKFLOW_ROLE_CATALOG:
            existing = db.scalar(select(WorkflowRole).where(WorkflowRole.code == item["code"]))
            if existing is None:
                db.add(
                    WorkflowRole(
                        code=item["code"],
                        name=item["name"],
                        description=item["description"],
                        type=item["type"],
                        is_active=True,
                    )
                )
                continue
            existing.name = item["name"]
            existing.description = item["description"]
            existing.type = item["type"]
            existing.is_active = True
        for legacy_code in LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODES:
            existing = db.scalar(select(WorkflowRole).where(WorkflowRole.code == legacy_code))
            if existing is not None:
                existing.is_active = False
        db.flush()
    except SQLAlchemyError:
        db.rollback()
        logger.warning(
            "workflow_roles seed skipped because workflow tables are unavailable. "
            "Apply alembic migrations to enable workflow governance."
        )


def user_has_workflow_role(user: User, code: str) -> bool:
    session = object_session(user)
    if session is None:
        return False
    found = session.scalar(
        select(UserWorkflowRole.id)
        .join(WorkflowRole, WorkflowRole.id == UserWorkflowRole.workflow_role_id)
        .where(UserWorkflowRole.user_id == user.id, WorkflowRole.code == code, WorkflowRole.is_active.is_(True))
        .limit(1)
    )
    return found is not None


def user_has_any_workflow_role(user: User, codes: list[str]) -> bool:
    if not codes:
        return False
    session = object_session(user)
    if session is None:
        return False
    found = session.scalar(
        select(UserWorkflowRole.id)
        .join(WorkflowRole, WorkflowRole.id == UserWorkflowRole.workflow_role_id)
        .where(
            UserWorkflowRole.user_id == user.id,
            WorkflowRole.code.in_(codes),
            WorkflowRole.is_active.is_(True),
        )
        .limit(1)
    )
    return found is not None
