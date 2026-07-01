from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser
from app.models.audit_log import AuditLog
from app.models.committee import Committee
from app.models.committee_member import CommitteeMember
from app.models.committee_session import CommitteeSession
from app.models.committee_session_vote import CommitteeSessionVote
from app.models.credit_analysis import CreditAnalysis
from app.models.enums import AnalysisStatus
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.schemas.committee_session import CommitteeSessionRead, CommitteeSessionVoteRead
from app.services.workflow_approval import get_active_approval_step, user_has_approval_step_role


class CommitteeSessionError(ValueError):
    pass


class CommitteeSessionPermissionError(PermissionError):
    pass


def _display_user(user: User | None) -> str | None:
    if user is None:
        return None
    return user.full_name.strip() if user.full_name and user.full_name.strip() else user.email


def get_open_committee_session(db: Session, *, analysis_id: int) -> CommitteeSession | None:
    return db.scalar(
        select(CommitteeSession)
        .where(CommitteeSession.analysis_id == analysis_id, CommitteeSession.status == "OPEN")
        .order_by(CommitteeSession.created_at.desc(), CommitteeSession.id.desc())
        .limit(1)
    )


def get_latest_committee_session(db: Session, *, analysis_id: int) -> CommitteeSession | None:
    return db.scalar(
        select(CommitteeSession)
        .where(CommitteeSession.analysis_id == analysis_id)
        .order_by(CommitteeSession.created_at.desc(), CommitteeSession.id.desc())
        .limit(1)
    )


def committee_session_to_read(db: Session, session: CommitteeSession | None) -> CommitteeSessionRead | None:
    if session is None:
        return None

    rows = db.execute(
        select(CommitteeSessionVote, WorkflowRole, User)
        .join(WorkflowRole, WorkflowRole.id == CommitteeSessionVote.workflow_role_id)
        .outerjoin(User, User.id == CommitteeSessionVote.resolved_user_id)
        .where(CommitteeSessionVote.session_id == session.id)
        .order_by(WorkflowRole.name.asc(), User.full_name.asc(), CommitteeSessionVote.id.asc())
    ).all()
    votes: list[CommitteeSessionVoteRead] = []
    warnings: list[str] = []
    if not rows:
        warnings.append("Comite sem membros ativos configurados para esta sessao.")

    for vote, role, user in rows:
        votes.append(
            CommitteeSessionVoteRead(
                role_name=role.name or role.code,
                role_code=role.code,
                user_name=_display_user(user),
                status=vote.status,
            )
        )
        if vote.resolved_user_id is None:
            warnings.append(f"Papel {role.name or role.code} sem usuario resolvido para voto.")

    return CommitteeSessionRead(
        id=session.id,
        committee_name=session.committee.name,
        status=session.status,
        requested_by=_display_user(session.requested_by),
        requested_at=session.requested_at,
        reason=session.reason,
        votes=votes,
        warnings=warnings,
    )


def open_credit_committee_session(
    db: Session,
    *,
    analysis: CreditAnalysis,
    current: CurrentUser,
    reason: str,
) -> CommitteeSession:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise CommitteeSessionError("Informe a justificativa para submeter ao comite.")
    if analysis.analysis_status != AnalysisStatus.IN_APPROVAL:
        raise CommitteeSessionError("A analise precisa estar em aprovacao para abrir sessao de comite.")
    if get_open_committee_session(db, analysis_id=analysis.id) is not None:
        raise CommitteeSessionError("Ja existe uma Sessao de Comite em andamento para esta analise.")

    active_step = get_active_approval_step(db, analysis.id)
    if active_step is None:
        raise CommitteeSessionError("Nao existe etapa ativa de aprovacao para esta analise.")
    if not user_has_approval_step_role(db, current, active_step):
        raise CommitteeSessionPermissionError("Somente o aprovador atual da etapa ativa pode abrir sessao de comite.")

    committee = db.scalar(
        select(Committee).where(
            Committee.company_id == current.user.company_id,
            Committee.is_default.is_(True),
            Committee.status == "active",
        )
    )
    if committee is None:
        raise CommitteeSessionError("Comite de Credito padrao ativo nao encontrado para a empresa.")

    session = CommitteeSession(
        analysis_id=analysis.id,
        committee_id=committee.id,
        requested_by_user_id=current.user.id,
        reason=normalized_reason,
        status="OPEN",
    )
    db.add(session)
    db.flush()

    members = list(
        db.scalars(
            select(CommitteeMember)
            .where(CommitteeMember.committee_id == committee.id, CommitteeMember.is_active.is_(True))
            .order_by(CommitteeMember.sequence_order.asc(), CommitteeMember.id.asc())
        ).all()
    )
    for member in members:
        resolved_users = list(
            db.scalars(
                select(User)
                .join(UserWorkflowRole, UserWorkflowRole.user_id == User.id)
                .where(
                    UserWorkflowRole.workflow_role_id == member.workflow_role_id,
                    User.company_id == current.user.company_id,
                    User.is_active.is_(True),
                )
                .distinct()
                .order_by(User.full_name.asc(), User.id.asc())
            ).all()
        )
        if not resolved_users:
            db.add(
                CommitteeSessionVote(
                    session_id=session.id,
                    workflow_role_id=member.workflow_role_id,
                    resolved_user_id=None,
                    status="PENDING",
                )
            )
            continue
        for user in resolved_users:
            db.add(
                CommitteeSessionVote(
                    session_id=session.id,
                    workflow_role_id=member.workflow_role_id,
                    resolved_user_id=user.id,
                    status="PENDING",
                )
            )

    db.add(
        AuditLog(
            actor_user_id=current.user.id,
            action="committee_submitted",
            resource="credit_analysis",
            resource_id=str(analysis.id),
            metadata_json={
                "committee_session_id": session.id,
                "committee_id": committee.id,
                "reason": normalized_reason,
                "member_count": len(members),
            },
        )
    )
    db.flush()
    return session
