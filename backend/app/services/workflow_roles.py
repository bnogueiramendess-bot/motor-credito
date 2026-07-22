from __future__ import annotations

import logging

from sqlalchemy import case, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, object_session

from app.models.approval_matrix_rule import ApprovalMatrixRule
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.models.business_unit import BusinessUnit
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
NON_USER_ASSIGNABLE_WORKFLOW_ROLE_CODES: tuple[str, ...] = COMMITTEE_COMPATIBILITY_WORKFLOW_ROLE_CODES
LEGACY_APPROVAL_WORKFLOW_ROLE_CANONICAL_CODE_MAP: dict[str, str] = {
    "CREDIT_CEO": "CEO",
    "CREDIT_GROUP_CFO": "CFO",
    "CREDIT_FINANCE_HEAD": "HEAD_FINANCE",
    "CREDIT_FINANCE_DIRECTOR": "CFO",
    "CREDIT_COMMERCIAL_HEAD": "HEAD_COMMERCIAL",
}
LEGACY_APPROVAL_WORKFLOW_ROLE_CODES: tuple[str, ...] = tuple(LEGACY_APPROVAL_WORKFLOW_ROLE_CANONICAL_CODE_MAP)
LEGACY_WORKFLOW_ROLE_CODES: tuple[str, ...] = LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODES + LEGACY_APPROVAL_WORKFLOW_ROLE_CODES
USER_ASSIGNABLE_OPERATIONAL_WORKFLOW_ROLE_CODES: tuple[str, ...] = ACTIVE_OPERATIONAL_WORKFLOW_ROLE_CODES
USER_ASSIGNABLE_WORKFLOW_ROLE_ORDER: dict[str, int] = {
    "CREDIT_REQUESTER": 10,
    "CREDIT_ANALYST": 20,
    "CREDIT_CONSULTANT": 30,
    "HEAD_FINANCE": 110,
    "HEAD_COMMERCIAL": 120,
    "HEAD_OPERATIONS": 130,
    "CFO": 140,
    "GROUP_CFO": 150,
    "CEO": 160,
    "LEGAL": 170,
}

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
            if item["code"] not in LEGACY_APPROVAL_WORKFLOW_ROLE_CANONICAL_CODE_MAP:
                existing.is_active = True
        for legacy_code in LEGACY_WORKFLOW_ROLE_CODES:
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


def canonical_workflow_role_code(code: str) -> str:
    normalized = code.strip().upper()
    return LEGACY_APPROVAL_WORKFLOW_ROLE_CANONICAL_CODE_MAP.get(normalized, normalized)


def list_user_assignable_workflow_roles(db: Session, *, company_id: int) -> list[WorkflowRole]:
    """Return roles that may be assigned from user administration."""

    order_case = case(USER_ASSIGNABLE_WORKFLOW_ROLE_ORDER, value=WorkflowRole.code, else_=999)
    doa_role_ids = (
        select(ApprovalMatrixRuleRole.workflow_role_id)
        .join(ApprovalMatrixRule, ApprovalMatrixRule.id == ApprovalMatrixRuleRole.approval_matrix_rule_id)
        .outerjoin(BusinessUnit, BusinessUnit.id == ApprovalMatrixRule.business_unit_id)
        .where(
            ApprovalMatrixRule.is_active.is_(True),
            ApprovalMatrixRule.requires_committee.is_(False),
            or_(ApprovalMatrixRule.business_unit_id.is_(None), BusinessUnit.company_id == company_id),
        )
    )
    return list(
        db.scalars(
            select(WorkflowRole)
            .where(
                WorkflowRole.is_active.is_(True),
                WorkflowRole.code.not_in(LEGACY_WORKFLOW_ROLE_CODES),
                WorkflowRole.code.not_in(NON_USER_ASSIGNABLE_WORKFLOW_ROLE_CODES),
                or_(
                    WorkflowRole.code.in_(USER_ASSIGNABLE_OPERATIONAL_WORKFLOW_ROLE_CODES),
                    WorkflowRole.id.in_(doa_role_ids),
                ),
            )
            .order_by(WorkflowRole.type.asc(), order_case.asc(), WorkflowRole.name.asc(), WorkflowRole.code.asc())
        ).all()
    )

