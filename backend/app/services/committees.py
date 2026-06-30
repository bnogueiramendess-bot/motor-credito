from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.committee import Committee
from app.models.committee_member import CommitteeMember
from app.models.workflow_role import WorkflowRole
from app.schemas.committee import CommitteeDecisionRule, CommitteeStatus, CommitteeWrite
from app.services.workflow_roles import ensure_workflow_roles_seed

DEFAULT_CREDIT_COMMITTEE_CODE = "CREDIT_COMMITTEE"
DEFAULT_CREDIT_COMMITTEE_NAME = "Comite de Credito"
DEFAULT_SLA_HOURS = 48
COMMITTEE_SLA_OPTIONS = [48, 72, 96]
COMMITTEE_ELIGIBLE_WORKFLOW_ROLE_CODES: tuple[str, ...] = (
    "CEO",
    "CFO",
    "HEAD_FINANCE",
    "HEAD_COMMERCIAL",
    "HEAD_OPERATIONS",
    "LEGAL",
)


def generate_next_committee_code(db: Session, *, company_id: int) -> str:
    codes = list(db.scalars(select(Committee.code).where(Committee.company_id == company_id)).all())
    max_suffix = 0
    for raw_code in codes:
        code = (raw_code or "").strip().upper()
        if not code.startswith("COM-"):
            continue
        suffix = code.removeprefix("COM-")
        if suffix.isdigit():
            max_suffix = max(max_suffix, int(suffix))
    return f"COM-{max_suffix + 1:04d}"


def list_committees(db: Session, *, company_id: int) -> list[Committee]:
    return list(
        db.scalars(
            select(Committee)
            .where(Committee.company_id == company_id)
            .order_by(Committee.is_default.desc(), Committee.name.asc(), Committee.id.asc())
        ).all()
    )


def get_committee(db: Session, *, committee_id: int, company_id: int) -> Committee | None:
    return db.scalar(select(Committee).where(Committee.id == committee_id, Committee.company_id == company_id))


def list_committee_eligible_workflow_roles(db: Session) -> list[WorkflowRole]:
    ensure_workflow_roles_seed(db)
    return list(
        db.scalars(
            select(WorkflowRole)
            .where(
                WorkflowRole.code.in_(COMMITTEE_ELIGIBLE_WORKFLOW_ROLE_CODES),
                WorkflowRole.is_active.is_(True),
            )
            .order_by(WorkflowRole.name.asc(), WorkflowRole.code.asc())
        ).all()
    )


def _normalize_members(db: Session, members: list) -> list[tuple[WorkflowRole, object]]:
    role_ids = [item.workflow_role_id for item in members]
    if len(set(role_ids)) != len(role_ids):
        raise ValueError("Nao duplique o mesmo papel DOA no comite.")

    if not role_ids:
        return []

    roles = list(
        db.scalars(
            select(WorkflowRole).where(
                WorkflowRole.id.in_(role_ids),
                WorkflowRole.code.in_(COMMITTEE_ELIGIBLE_WORKFLOW_ROLE_CODES),
                WorkflowRole.is_active.is_(True),
            )
        ).all()
    )
    role_by_id = {role.id: role for role in roles}
    missing = [str(role_id) for role_id in role_ids if role_id not in role_by_id]
    if missing:
        raise ValueError(f"Papel DOA nao elegivel para comite: {', '.join(missing)}.")
    return [(role_by_id[item.workflow_role_id], item) for item in members]


def _save_members(db: Session, committee: Committee, members: list) -> None:
    normalized_members = _normalize_members(db, members)
    chair_count = sum(1 for _, item in normalized_members if item.is_chair)
    if chair_count > 1:
        raise ValueError("Informe apenas um presidente para o comite.")

    db.query(CommitteeMember).filter(CommitteeMember.committee_id == committee.id).delete()
    for role, item in normalized_members:
        db.add(
            CommitteeMember(
                committee_id=committee.id,
                workflow_role_id=role.id,
                sequence_order=item.sequence_order,
                is_required=item.is_required,
                is_chair=item.is_chair,
                is_active=item.is_active,
            )
        )


def _audit(
    db: Session,
    *,
    actor_user_id: int | None,
    action: str,
    committee: Committee,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource="committee",
            resource_id=str(committee.id),
            metadata_json=metadata,
        )
    )


def create_committee(
    db: Session,
    *,
    company_id: int,
    payload: CommitteeWrite,
    created_by_user_id: int | None,
) -> Committee:
    if payload.is_default:
        db.query(Committee).filter(
            Committee.company_id == company_id,
            Committee.is_default.is_(True),
        ).update({Committee.is_default: False}, synchronize_session=False)

    committee = Committee(
        company_id=company_id,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        status=payload.status.value,
        decision_rule=payload.decision_rule.value,
        sla_hours=payload.sla_hours,
        is_default=payload.is_default,
        created_by_user_id=created_by_user_id,
    )
    db.add(committee)
    db.flush()
    _save_members(db, committee, payload.members)
    _audit(
        db,
        actor_user_id=created_by_user_id,
        action="committee_created",
        committee=committee,
        metadata={"code": committee.code, "member_count": len(payload.members)},
    )
    db.flush()
    return committee


def update_committee(
    db: Session,
    *,
    committee: Committee,
    payload: CommitteeWrite,
    actor_user_id: int | None,
) -> Committee:
    if payload.is_default:
        db.query(Committee).filter(
            Committee.company_id == committee.company_id,
            Committee.id != committee.id,
            Committee.is_default.is_(True),
        ).update({Committee.is_default: False}, synchronize_session=False)

    committee.code = payload.code
    committee.name = payload.name
    committee.description = payload.description
    committee.status = payload.status.value
    committee.decision_rule = payload.decision_rule.value
    committee.sla_hours = payload.sla_hours
    committee.is_default = payload.is_default
    _save_members(db, committee, payload.members)
    _audit(
        db,
        actor_user_id=actor_user_id,
        action="committee_updated",
        committee=committee,
        metadata={"code": committee.code, "member_count": len(payload.members)},
    )
    db.flush()
    return committee


def ensure_committees_seed(db: Session) -> None:
    try:
        all_company_ids = list(db.scalars(select(func.distinct(Company.id))).all())
        for company_id in all_company_ids:
            existing = db.scalar(
                select(Committee).where(Committee.company_id == company_id, Committee.code == DEFAULT_CREDIT_COMMITTEE_CODE)
            )
            if existing is not None:
                continue
            db.query(Committee).filter(
                Committee.company_id == company_id,
                Committee.is_default.is_(True),
            ).update({Committee.is_default: False}, synchronize_session=False)
            db.add(
                Committee(
                    company_id=company_id,
                    code=DEFAULT_CREDIT_COMMITTEE_CODE,
                    name=DEFAULT_CREDIT_COMMITTEE_NAME,
                    description="Comite corporativo padrao preparado para futuras decisoes colegiadas de credito.",
                    status=CommitteeStatus.ACTIVE.value,
                    decision_rule=CommitteeDecisionRule.ALL.value,
                    sla_hours=DEFAULT_SLA_HOURS,
                    is_default=True,
                    created_by_user_id=None,
                )
            )
        db.flush()
    except SQLAlchemyError:
        db.rollback()
        return
