from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, object_session

from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole

logger = logging.getLogger(__name__)

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
        "description": "Pode executar análise técnica.",
    },
    {
        "code": "CREDIT_CONSULTANT",
        "name": "Consultor",
        "type": "operational",
        "description": "Pode consultar análises, decisões e históricos sem realizar alterações.",
    },
    {
        "code": "CREDIT_REVIEWER",
        "name": "Revisor de Crédito",
        "type": "operational",
        "description": "Pode revisar análise antes do parecer.",
    },
    {
        "code": "CREDIT_OPINION",
        "name": "Parecerista Financeiro",
        "type": "operational",
        "description": "Pode emitir parecer e submeter para aprovação.",
    },
    {
        "code": "CREDIT_COMMITTEE",
        "name": "Comitê de Crédito",
        "type": "governance",
        "description": "Participa de exceções, discussões e aprovações colegiadas.",
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
        "description": "Papel executivo para governança administrativa de políticas.",
    },
    {
        "code": "CFO",
        "name": "CFO",
        "type": "governance",
        "description": "Papel financeiro executivo para governança administrativa de políticas.",
    },
    {
        "code": "HEAD_COMMERCIAL",
        "name": "Head Comercial",
        "type": "governance",
        "description": "Liderança comercial para governança administrativa de políticas.",
    },
    {
        "code": "HEAD_OPERATIONS",
        "name": "Head de Operações",
        "type": "governance",
        "description": "Liderança operacional para governança administrativa de políticas.",
    },
    {
        "code": "HEAD_FINANCE",
        "name": "Head Financeiro",
        "type": "governance",
        "description": "Liderança financeira para governança administrativa de políticas.",
    },
    {
        "code": "LEGAL",
        "name": "Jurídico",
        "type": "governance",
        "description": "Papel jurídico para governança administrativa de políticas.",
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
