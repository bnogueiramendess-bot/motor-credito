from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.approval_matrix_rule import ApprovalMatrixRule
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.models.business_unit import BusinessUnit
from app.models.workflow_role import WorkflowRole
from app.schemas.approval_matrix import ApprovalMatrixRuleWrite

INITIAL_APPROVAL_MATRIX_RULES: list[dict] = [
    {
        "legacy_code": "APPROVAL_BRL_0_1MM",
        "code": "DOA-0001",
        "name": "Alçada BRL 0 a 1MM",
        "description": "Aprovação padrão para valores até BRL 1MM.",
        "min_amount": Decimal("0"),
        "max_amount": Decimal("1000000"),
        "currency": "BRL",
        "required_approvals": 1,
        "requires_committee": False,
        "requires_unanimous": False,
        "priority": 10,
        "workflow_role_codes": ["CREDIT_FINANCE_HEAD"],
    },
    {
        "legacy_code": "APPROVAL_BRL_1_5MM",
        "code": "DOA-0002",
        "name": "Alçada BRL 1MM a 5MM",
        "description": "Aprovação padrão para valores entre BRL 1MM e BRL 5MM.",
        "min_amount": Decimal("1000000"),
        "max_amount": Decimal("5000000"),
        "currency": "BRL",
        "required_approvals": 1,
        "requires_committee": False,
        "requires_unanimous": False,
        "priority": 20,
        "workflow_role_codes": ["CREDIT_FINANCE_DIRECTOR"],
    },
    {
        "legacy_code": "APPROVAL_BRL_5_10MM",
        "code": "DOA-0003",
        "name": "Alçada BRL 5MM a 10MM",
        "description": "Aprovação padrão para valores entre BRL 5MM e BRL 10MM.",
        "min_amount": Decimal("5000000"),
        "max_amount": Decimal("10000000"),
        "currency": "BRL",
        "required_approvals": 1,
        "requires_committee": False,
        "requires_unanimous": False,
        "priority": 30,
        "workflow_role_codes": ["CREDIT_GROUP_CFO"],
    },
    {
        "legacy_code": "APPROVAL_BRL_GT_10MM",
        "code": "DOA-0004",
        "name": "Alçada BRL acima de 10MM",
        "description": "Aprovação executiva para valores acima de BRL 10MM.",
        "min_amount": Decimal("10000000"),
        "max_amount": None,
        "currency": "BRL",
        "required_approvals": 1,
        "requires_committee": False,
        "requires_unanimous": False,
        "priority": 40,
        "workflow_role_codes": ["CREDIT_CEO"],
    },
    {
        "legacy_code": "APPROVAL_EXCEPTIONS_COMMITTEE",
        "code": "DOA-0005",
        "name": "Exceções de Comitê",
        "description": "Canal institucional para exceções e deliberações colegiadas.",
        "min_amount": None,
        "max_amount": None,
        "currency": "BRL",
        "required_approvals": 1,
        "requires_committee": True,
        "requires_unanimous": False,
        "priority": 100,
        "workflow_role_codes": ["CREDIT_COMMITTEE"],
    },
]


def generate_next_approval_matrix_code(db: Session) -> str:
    rules = list(db.scalars(select(ApprovalMatrixRule.code)).all())
    max_suffix = 0
    for raw_code in rules:
        code = (raw_code or "").strip().upper()
        if not code.startswith("DOA-"):
            continue
        suffix = code.removeprefix("DOA-")
        if not suffix.isdigit():
            continue
        max_suffix = max(max_suffix, int(suffix))
    return f"DOA-{max_suffix + 1:04d}"


def list_approval_matrix_rules(db: Session, *, company_id: int) -> list[ApprovalMatrixRule]:
    query = (
        select(ApprovalMatrixRule)
        .outerjoin(BusinessUnit, BusinessUnit.id == ApprovalMatrixRule.business_unit_id)
        .where((ApprovalMatrixRule.business_unit_id.is_(None)) | (BusinessUnit.company_id == company_id))
        .order_by(ApprovalMatrixRule.priority.asc(), ApprovalMatrixRule.id.asc())
    )
    return list(db.scalars(query).all())


def _get_workflow_roles_by_codes(db: Session, codes: Iterable[str]) -> dict[str, WorkflowRole]:
    code_list = [code.strip().upper() for code in codes]
    roles = list(
        db.scalars(
            select(WorkflowRole).where(
                WorkflowRole.code.in_(code_list),
                WorkflowRole.is_active.is_(True),
            )
        ).all()
    )
    return {role.code: role for role in roles}


def _save_rule_roles(db: Session, rule: ApprovalMatrixRule, role_codes: list[str]) -> None:
    role_by_code = _get_workflow_roles_by_codes(db, role_codes)
    missing = [code for code in role_codes if code not in role_by_code]
    if missing:
        raise ValueError(f"Papel de workflow invalido: {', '.join(missing)}.")

    db.query(ApprovalMatrixRuleRole).filter(ApprovalMatrixRuleRole.approval_matrix_rule_id == rule.id).delete()
    for code in role_codes:
        db.add(
            ApprovalMatrixRuleRole(
                approval_matrix_rule_id=rule.id,
                workflow_role_id=role_by_code[code].id,
            )
        )


def create_approval_matrix_rule(
    db: Session,
    *,
    payload: ApprovalMatrixRuleWrite,
    created_by_user_id: int | None,
) -> ApprovalMatrixRule:
    next_code = generate_next_approval_matrix_code(db)
    rule = ApprovalMatrixRule(
        code=next_code,
        name=payload.name,
        description=payload.description,
        is_active=payload.is_active,
        min_amount=payload.min_amount,
        max_amount=payload.max_amount,
        currency=payload.currency.strip().upper(),
        required_approvals=payload.required_approvals,
        requires_committee=payload.requires_committee,
        requires_unanimous=payload.requires_unanimous,
        business_unit_id=payload.business_unit_id,
        priority=payload.priority,
        created_by_user_id=created_by_user_id,
    )
    db.add(rule)
    db.flush()
    _save_rule_roles(db, rule, payload.workflow_role_codes)
    db.flush()
    return rule


def update_approval_matrix_rule(
    db: Session,
    *,
    rule: ApprovalMatrixRule,
    payload: ApprovalMatrixRuleWrite,
) -> ApprovalMatrixRule:
    rule.code = payload.code
    rule.name = payload.name
    rule.description = payload.description
    rule.is_active = payload.is_active
    rule.min_amount = payload.min_amount
    rule.max_amount = payload.max_amount
    rule.currency = payload.currency.strip().upper()
    rule.required_approvals = payload.required_approvals
    rule.requires_committee = payload.requires_committee
    rule.requires_unanimous = payload.requires_unanimous
    rule.business_unit_id = payload.business_unit_id
    rule.priority = payload.priority
    _save_rule_roles(db, rule, payload.workflow_role_codes)
    db.flush()
    return rule


def resolve_required_approval_roles(
    db: Session,
    *,
    amount: Decimal,
    currency: str,
    business_unit_id: int | None = None,
) -> dict:
    try:
        rules = list(
            db.scalars(
                select(ApprovalMatrixRule)
                .where(
                    ApprovalMatrixRule.is_active.is_(True),
                    ApprovalMatrixRule.currency == currency.upper(),
                )
                .order_by(ApprovalMatrixRule.priority.asc(), ApprovalMatrixRule.id.asc())
            ).all()
        )
    except SQLAlchemyError:
        return {
            "rule_id": None,
            "rule_code": None,
            "rule_name": None,
            "rule_range": None,
            "required_roles": [],
            "required_approvals": 0,
            "requires_committee": False,
        }
    for rule in rules:
        min_ok = rule.min_amount is None or amount >= rule.min_amount
        max_ok = rule.max_amount is None or amount <= rule.max_amount
        bu_ok = rule.business_unit_id is None or rule.business_unit_id == business_unit_id
        if min_ok and max_ok and bu_ok:
            role_codes = [
                code
                for code in db.scalars(
                    select(WorkflowRole.code)
                    .join(ApprovalMatrixRuleRole, ApprovalMatrixRuleRole.workflow_role_id == WorkflowRole.id)
                    .where(ApprovalMatrixRuleRole.approval_matrix_rule_id == rule.id)
                    .order_by(WorkflowRole.code.asc())
                ).all()
            ]
            return {
                "rule_id": rule.id,
                "rule_code": rule.code,
                "rule_name": rule.name,
                "rule_range": (
                    f"{rule.min_amount if rule.min_amount is not None else '-inf'}.."
                    f"{rule.max_amount if rule.max_amount is not None else '+inf'}"
                ),
                "required_roles": role_codes,
                "required_approvals": rule.required_approvals,
                "requires_committee": rule.requires_committee,
            }
    return {
        "rule_id": None,
        "rule_code": None,
        "rule_name": None,
        "rule_range": None,
        "required_roles": [],
        "required_approvals": 0,
        "requires_committee": False,
    }


def ensure_approval_matrix_seed(db: Session) -> None:
    try:
        for item in INITIAL_APPROVAL_MATRIX_RULES:
            seed_code = str(item["code"]).strip().upper()
            legacy_code = str(item["legacy_code"]).strip().upper()
            payload = ApprovalMatrixRuleWrite(**{k: v for k, v in item.items() if k != "legacy_code"})

            existing_new = db.scalar(select(ApprovalMatrixRule).where(ApprovalMatrixRule.code == seed_code))
            if existing_new is not None:
                continue

            existing_legacy = db.scalar(select(ApprovalMatrixRule).where(ApprovalMatrixRule.code == legacy_code))
            if existing_legacy is not None:
                existing_legacy.code = seed_code
                db.flush()
                continue

            # Bootstrap inicial: cria seed somente se não houver código novo/legado correspondente.
            rule = ApprovalMatrixRule(
                code=payload.code,
                name=payload.name,
                description=payload.description,
                is_active=payload.is_active,
                min_amount=payload.min_amount,
                max_amount=payload.max_amount,
                currency=payload.currency.strip().upper(),
                required_approvals=payload.required_approvals,
                requires_committee=payload.requires_committee,
                requires_unanimous=payload.requires_unanimous,
                business_unit_id=payload.business_unit_id,
                priority=payload.priority,
                created_by_user_id=None,
            )
            db.add(rule)
            db.flush()
            _save_rule_roles(db, rule, payload.workflow_role_codes)
        db.flush()
    except SQLAlchemyError:
        db.rollback()
        # Base ainda sem migration da matriz: manter startup funcional em modo legado.
        return
