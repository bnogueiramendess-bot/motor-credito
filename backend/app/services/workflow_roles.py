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

# Operational roles execute analysis; DOA approval roles decide credit;
# governance administers policy/configuration; future collegial structures must
# be modeled independently. Historical storage still uses workflow_roles.type,
# so both governance and approval are accepted for DOA compatibility.
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
        "name": "Excecao Colegiada",
        "type": "governance",
        "description": "Compatibilidade para operacoes que exigem decisao colegiada dentro da DOA atual.",
    },
    {
        "code": "CREDIT_FINANCE_HEAD",
        "name": "Finance Head",
        "type": "approval",
        "description": "Aprova operacoes enquadradas na faixa financeira sob sua alcada.",
    },
    {
        "code": "CREDIT_FINANCE_DIRECTOR",
        "name": "Finance Director",
        "type": "approval",
        "description": "Responsavel por decisoes estrategicas acima das alcadas gerenciais.",
    },
    {
        "code": "CREDIT_GROUP_CFO",
        "name": "Group CFO",
        "type": "approval",
        "description": "Responsavel por decisoes financeiras de maior exposicao conforme politica corporativa DOA.",
    },
    {
        "code": "CREDIT_CEO",
        "name": "CEO",
        "type": "approval",
        "description": "Autoridade executiva para decisoes estrategicas acima das alcadas inferiores.",
    },
    {
        "code": "CREDIT_COMMERCIAL_HEAD",
        "name": "Commercial Head",
        "type": "approval",
        "description": "Avaliador executivo para operacoes com impacto comercial relevante na politica DOA.",
    },
    {
        "code": "CEO",
        "name": "CEO",
        "type": "governance",
        "description": "Autoridade executiva para decisoes estrategicas acima das alcadas inferiores.",
    },
    {
        "code": "CFO",
        "name": "CFO",
        "type": "governance",
        "description": "Responsavel por decisoes financeiras de maior exposicao conforme politica corporativa DOA.",
    },
    {
        "code": "HEAD_COMMERCIAL",
        "name": "Head Comercial",
        "type": "governance",
        "description": "Avaliador executivo para operacoes com impacto comercial relevante na politica DOA.",
    },
    {
        "code": "HEAD_OPERATIONS",
        "name": "Head de Operacoes",
        "type": "governance",
        "description": "Governanca de credito para administracao de politicas, score e fluxo de aprovacao.",
    },
    {
        "code": "HEAD_FINANCE",
        "name": "Head Financeiro",
        "type": "governance",
        "description": "Aprova operacoes enquadradas na faixa financeira sob sua alcada.",
    },
    {
        "code": "LEGAL",
        "name": "Juridico",
        "type": "governance",
        "description": "Governanca de credito para administracao juridica de politicas corporativas.",
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
