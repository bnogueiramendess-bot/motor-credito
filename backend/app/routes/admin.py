from __future__ import annotations

import os
import re
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user, require_permissions
from app.db.session import get_db
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.models.user_workflow_role import UserWorkflowRole
from app.models.user_invitation import UserInvitation
from app.models.workflow_role import WorkflowRole
from app.schemas.administration import (
    BusinessUnitCreate,
    BusinessUnitRead,
    BusinessUnitStatusUpdate,
    BusinessUnitUpdate,
    CompanyCreate,
    CompanyPolicyGovernanceRead,
    CompanyPolicyGovernanceUpdate,
    CompanyRead,
    CompanyUpdate,
    InviteRead,
    ProfileRead,
    ProfileStatusUpdate,
    ProfileUpsert,
    RoleMatrixItem,
    UserCreate,
    UserRead,
    UserWorkflowRoleRead,
    UserWorkflowRolesUpdate,
    UserStatusUpdate,
    UserUpdate,
    WorkflowRoleRead,
)
from app.schemas.approval_matrix import (
    ApprovalMatrixOptionBusinessUnit,
    ApprovalMatrixOptionWorkflowRole,
    ApprovalMatrixOptionsRead,
    ApprovalMatrixRuleRead,
    ApprovalMatrixRuleRoleRead,
    ApprovalMatrixRuleWrite,
)
from app.models.approval_matrix_rule import ApprovalMatrixRule
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.services.bootstrap_admin import (
    DEFAULT_MASTER_EMAIL,
    DEFAULT_MASTER_NAME,
    DEFAULT_MASTER_PASSWORD,
    ROLE_MATRIX,
)
from app.services.permission_catalog import PROFILE_PERMISSION_CATALOG
from app.services.operational_reset import (
    build_execution_plan,
    count_business_impact,
    execute_table_cleanup,
    list_reset_domains,
    validate_registry_coverage,
)
from app.services.security import generate_raw_token, hash_password, hash_token
from app.services.workflow_roles import (
    LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODES,
    ensure_workflow_roles_seed,
)
from app.services.approval_matrix import (
    create_approval_matrix_rule,
    ensure_approval_matrix_seed,
    generate_next_approval_matrix_code,
    list_approval_matrix_rules,
    update_approval_matrix_rule,
)
from app.services.company_policy_governance_roles import (
    CompanyPolicyGovernanceRoleError,
    get_company_policy_governance_config,
    update_company_policy_governance_config,
)

router = APIRouter(prefix="/admin", tags=["admin"])

REQUIRED_CONFIRMATION = "RESET_OPERATIONAL_DATA"

SYSTEM_PROFILE_NAMES = {"administrador_master"}
ADMINISTRATOR_PROFILE_NAME = "administrador"
AR_AGING_IMPORT_PERMISSION_KEY = "clients.aging.import"
STANDARD_USER_ROLE_NAME = "usuario_padrao"
LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODE_SET = set(LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODES)


class ResetOperationalDataRequest(BaseModel):
    confirm: str
    domains: list[str] | None = None
    preview_only: bool = False


def _table_exists(db: Session, table_name: str) -> bool:
    try:
        return inspect(db.get_bind()).has_table(table_name)
    except SQLAlchemyError:
        db.rollback()
        return False


def _is_production_env() -> bool:
    for env_key in ("ENV", "APP_ENV", "ENVIRONMENT", "FASTAPI_ENV", "PYTHON_ENV"):
        value = os.getenv(env_key, "").strip().lower()
        if value in {"prod", "production"}:
            return True
    return False


def _guard_sensitive_environment(db: Session) -> None:
    if _is_production_env():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operacao bloqueada em ambiente de producao.")

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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operacao bloqueada por seguranca (database sensivel).")


def _seed_default_governance(db: Session) -> tuple[Company, Role]:
    company = Company(
        name="Empresa Padrao",
        legal_name="Empresa Padrao",
        trade_name="Empresa Padrao",
        cnpj=None,
        allowed_domain="indorama.com",
        allowed_domains_json=["indorama.com"],
        corporate_email_required=False,
        is_active=True,
    )
    db.add(company)
    db.flush()

    permission_by_key: dict[str, Permission] = {}
    for key in sorted({permission for permissions in ROLE_MATRIX.values() for permission in permissions}):
        permission = Permission(key=key, description=key)
        db.add(permission)
        db.flush()
        permission_by_key[key] = permission

    role_by_name: dict[str, Role] = {}
    for index, (role_name, permissions) in enumerate(ROLE_MATRIX.items(), start=1):
        role = Role(
            company_id=company.id,
            code=f"PERF-{index:04d}",
            name=role_name,
            description=role_name.replace("_", " ").title(),
            is_active=True,
            is_system=role_name in SYSTEM_PROFILE_NAMES,
        )
        db.add(role)
        db.flush()
        role_by_name[role_name] = role
        for key in permissions:
            db.add(RolePermission(role_id=role.id, permission_id=permission_by_key[key].id))

    return company, role_by_name["administrador_master"]


def _next_business_unit_code(db: Session, company_id: int) -> str:
    existing_codes = list(
        db.scalars(select(BusinessUnit.code).where(BusinessUnit.company_id == company_id))
    )
    numeric_codes = [int(code) for code in existing_codes if code.isdigit()]
    next_number = (max(numeric_codes) + 1) if numeric_codes else 1
    return f"{next_number:03d}"


def _next_profile_code(db: Session, company_id: int) -> str:
    latest = db.scalar(
        select(Role.code).where(Role.company_id == company_id).order_by(Role.id.desc()).limit(1)
    )
    if latest and latest.startswith("PERF-"):
        suffix = latest.split("PERF-")[-1]
        if suffix.isdigit():
            return f"PERF-{(int(suffix) + 1):04d}"
    return "PERF-0001"


def _next_user_code(db: Session, company_id: int) -> str:
    latest = db.scalar(
        select(User.user_code).where(User.company_id == company_id).order_by(User.id.desc()).limit(1)
    )
    if latest and latest.startswith("USR-"):
        suffix = latest.split("USR-")[-1]
        if suffix.isdigit():
            return f"USR-{(int(suffix) + 1):04d}"
    return "USR-0001"


def _next_username(db: Session, email: str) -> str:
    base = email.split("@")[0].strip().lower()
    base = re.sub(r"[^a-z0-9._-]", "", base)
    if not base:
        base = "usuario"

    username = base
    sequence = 2
    while db.scalar(select(User.id).where(User.username == username)) is not None:
        username = f"{base}.{sequence}"
        sequence += 1
    return username


def _ensure_permissions_exist(db: Session) -> None:
    for key, description in PROFILE_PERMISSION_CATALOG.items():
        existing = db.scalar(select(Permission).where(Permission.key == key))
        if existing is None:
            db.add(Permission(key=key, description=description))
    db.flush()


def _role_to_profile_read(db: Session, role: Role) -> ProfileRead:
    permission_keys = list(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role.id)
            .order_by(Permission.key.asc())
        ).all()
    )
    return ProfileRead(
        id=role.id,
        code=role.code,
        name=role.name,
        description=role.description,
        type="Sistemico" if role.is_system else "Customizado",
        status="active" if role.is_active else "inactive",
        permission_keys=permission_keys,
        is_protected=role.is_system,
    )


def _role_has_full_access(db: Session, role_id: int) -> bool:
    role_permission_keys = set(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
        ).all()
    )
    return set(PROFILE_PERMISSION_CATALOG.keys()).issubset(role_permission_keys)


def _role_has_permission(db: Session, role_id: int, permission_key: str) -> bool:
    found = db.scalar(
        select(RolePermission.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(RolePermission.role_id == role_id, Permission.key == permission_key)
        .limit(1)
    )
    return found is not None


def _get_or_create_role_with_extra_permissions(
    db: Session,
    *,
    company_id: int,
    base_role: Role,
    extra_permission_keys: list[str],
) -> Role:
    _ensure_permissions_exist(db)
    key_suffix = "_".join(sorted(extra_permission_keys)).replace(".", "_").replace(":", "_")
    digest = hashlib.sha1(key_suffix.encode("utf-8")).hexdigest()[:6].upper()
    code = f"PERF-X-{base_role.id}-{digest}"
    role = db.scalar(select(Role).where(Role.company_id == company_id, Role.code == code))
    if role is None:
        role = Role(
            company_id=company_id,
            code=code,
            name=f"{base_role.name} + AR Aging Import",
            description=f"Perfil derivado de {base_role.name} com permissões adicionais específicas.",
            is_active=True,
            is_system=True,
        )
        db.add(role)
        db.flush()

    role.is_active = True
    role.is_system = True
    db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()

    base_permission_keys = list(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == base_role.id)
        ).all()
    )
    target_keys = sorted(set(base_permission_keys + extra_permission_keys))
    permissions = list(db.scalars(select(Permission).where(Permission.key.in_(target_keys))).all())
    for permission in permissions:
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.flush()
    return role


def _get_or_create_administrator_role(db: Session, company_id: int) -> Role:
    _ensure_permissions_exist(db)
    admin_role = db.scalar(
        select(Role).where(
            Role.company_id == company_id,
            Role.name.in_([ADMINISTRATOR_PROFILE_NAME, "administrador_master"]),
        )
    )
    if admin_role is None:
        admin_role = Role(
            company_id=company_id,
            code=_next_profile_code(db, company_id),
            name=ADMINISTRATOR_PROFILE_NAME,
            description="Perfil administrativo com acesso integral à plataforma.",
            is_active=True,
            is_system=True,
        )
        db.add(admin_role)
        db.flush()

    admin_role.is_active = True
    admin_role.is_system = True
    permission_by_key = {
        permission.key: permission
        for permission in db.scalars(select(Permission).where(Permission.key.in_(PROFILE_PERMISSION_CATALOG.keys()))).all()
    }
    existing_keys = set(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == admin_role.id)
        ).all()
    )
    for key in PROFILE_PERMISSION_CATALOG.keys():
        if key in existing_keys:
            continue
        permission = permission_by_key.get(key)
        if permission is None:
            continue
        db.add(RolePermission(role_id=admin_role.id, permission_id=permission.id))
    db.flush()
    return admin_role


def _get_or_create_standard_user_role(db: Session, company_id: int) -> Role:
    role = db.scalar(
        select(Role).where(
            Role.company_id == company_id,
            Role.name == STANDARD_USER_ROLE_NAME,
        )
    )
    if role is None:
        role = Role(
            company_id=company_id,
            code=_next_profile_code(db, company_id),
            name=STANDARD_USER_ROLE_NAME,
            description="Papel técnico padrão para usuários sem privilégios administrativos.",
            is_active=True,
            is_system=True,
        )
        db.add(role)
        db.flush()
    role.is_active = True
    role.is_system = True
    return role


def _user_to_read(db: Session, user: User) -> UserRead:
    bu_ids = list(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
    bu_names = list(
        db.scalars(
            select(BusinessUnit.name)
            .join(UserBusinessUnitScope, UserBusinessUnitScope.business_unit_id == BusinessUnit.id)
            .where(UserBusinessUnitScope.user_id == user.id)
            .order_by(BusinessUnit.name.asc())
        ).all()
    )
    workflow_role_codes: list[str] = []
    if _table_exists(db, "workflow_roles") and _table_exists(db, "user_workflow_roles"):
        try:
            workflow_role_codes = list(
                db.scalars(
                    select(WorkflowRole.code)
                    .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
                    .where(
                        UserWorkflowRole.user_id == user.id,
                        WorkflowRole.is_active.is_(True),
                    )
                    .distinct()
                    .order_by(WorkflowRole.code.asc())
                ).all()
            )
        except SQLAlchemyError:
            db.rollback()
            workflow_role_codes = []
    return UserRead(
        id=user.id,
        user_code=user.user_code,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        profile_name=user.role.name,
        is_administrator=_role_has_full_access(db, user.role_id),
        can_import_ar_aging=_role_has_permission(db, user.role_id, AR_AGING_IMPORT_PERMISSION_KEY),
        is_active=user.is_active,
        first_access_pending=user.must_change_password,
        business_unit_ids=bu_ids,
        business_unit_names=bu_names,
        workflow_role_codes=workflow_role_codes,
    )


def _list_user_workflow_roles(db: Session, user_id: int) -> list[UserWorkflowRoleRead]:
    if not _table_exists(db, "workflow_roles") or not _table_exists(db, "user_workflow_roles"):
        return []
    rows = db.execute(
        select(
            WorkflowRole.id,
            WorkflowRole.code,
            WorkflowRole.name,
            WorkflowRole.description,
            WorkflowRole.type,
            UserWorkflowRole.business_unit_id,
            BusinessUnit.name,
        )
        .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
        .outerjoin(BusinessUnit, BusinessUnit.id == UserWorkflowRole.business_unit_id)
        .where(UserWorkflowRole.user_id == user_id)
        .order_by(WorkflowRole.type.asc(), WorkflowRole.name.asc(), BusinessUnit.name.asc())
    ).all()
    return [
        UserWorkflowRoleRead(
            role_id=row[0],
            code=row[1],
            name=row[2],
            description=row[3],
            type=row[4],
            business_unit_id=row[5],
            business_unit_name=row[6],
        )
        for row in rows
    ]


def _replace_user_workflow_roles(
    db: Session,
    *,
    company_id: int,
    target_user_id: int,
    actor_user_id: int,
    assignments: list,
) -> None:
    if not _table_exists(db, "workflow_roles") or not _table_exists(db, "user_workflow_roles"):
        return
    role_by_code = {
        role.code: role
        for role in db.scalars(
            select(WorkflowRole).where(
                WorkflowRole.is_active.is_(True),
                WorkflowRole.code.not_in(LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODE_SET),
            )
        ).all()
    }
    normalized_assignments: list[tuple[WorkflowRole, int | None]] = []
    seen_pairs: set[tuple[int, int | None]] = set()
    for assignment in assignments:
        role_code = assignment.code.strip().upper()
        role = role_by_code.get(role_code)
        if role is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Papel de workflow invalido ou descontinuado: {assignment.code}.",
            )

        if assignment.business_unit_id is not None:
            bu = db.get(BusinessUnit, assignment.business_unit_id)
            if bu is None or bu.company_id != company_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BU informada e invalida.")

        key = (role.id, assignment.business_unit_id)
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        normalized_assignments.append((role, assignment.business_unit_id))

    db.query(UserWorkflowRole).filter(UserWorkflowRole.user_id == target_user_id).delete()
    for role, business_unit_id in normalized_assignments:
        db.add(
            UserWorkflowRole(
                user_id=target_user_id,
                workflow_role_id=role.id,
                business_unit_id=business_unit_id,
                created_by_user_id=actor_user_id,
            )
        )


def _approval_rule_to_read(db: Session, rule: ApprovalMatrixRule) -> ApprovalMatrixRuleRead:
    roles = list(
        db.execute(
            select(WorkflowRole.id, WorkflowRole.code, WorkflowRole.name, WorkflowRole.type)
            .join(ApprovalMatrixRuleRole, ApprovalMatrixRuleRole.workflow_role_id == WorkflowRole.id)
            .where(ApprovalMatrixRuleRole.approval_matrix_rule_id == rule.id)
            .order_by(WorkflowRole.type.asc(), WorkflowRole.name.asc())
        ).all()
    )
    business_unit_name = None
    if rule.business_unit_id is not None:
        business_unit_name = db.scalar(
            select(BusinessUnit.name).where(BusinessUnit.id == rule.business_unit_id)
        )
    return ApprovalMatrixRuleRead(
        id=rule.id,
        code=rule.code,
        name=rule.name,
        description=rule.description,
        is_active=rule.is_active,
        min_amount=rule.min_amount,
        max_amount=rule.max_amount,
        currency=rule.currency,
        required_approvals=rule.required_approvals,
        requires_committee=rule.requires_committee,
        requires_unanimous=rule.requires_unanimous,
        business_unit_id=rule.business_unit_id,
        business_unit_name=business_unit_name,
        priority=rule.priority,
        roles=[
            ApprovalMatrixRuleRoleRead(
                workflow_role_id=row[0],
                workflow_role_code=row[1],
                workflow_role_name=row[2],
                workflow_role_type=row[3],
            )
            for row in roles
        ],
    )


@router.post("/company", response_model=CompanyRead)
def create_or_update_company(
    payload: CompanyCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["company:manage"])),
) -> CompanyRead:
    company = db.get(Company, current.user.company_id)
    if company is None:
        company = Company(
            name=payload.legal_name.strip(),
            legal_name=payload.legal_name.strip(),
            trade_name=payload.trade_name.strip() if payload.trade_name else None,
            cnpj=payload.cnpj.strip() if payload.cnpj else None,
            allowed_domain=payload.allowed_domains[0],
            allowed_domains_json=payload.allowed_domains,
            corporate_email_required=payload.corporate_email_required,
            is_active=payload.is_active,
        )
        db.add(company)
    else:
        company.name = payload.legal_name.strip()
        company.legal_name = payload.legal_name.strip()
        company.trade_name = payload.trade_name.strip() if payload.trade_name else None
        company.cnpj = payload.cnpj.strip() if payload.cnpj else None
        company.allowed_domain = payload.allowed_domains[0]
        company.allowed_domains_json = payload.allowed_domains
        company.corporate_email_required = payload.corporate_email_required
        company.is_active = payload.is_active
    db.commit()
    db.refresh(company)
    return CompanyRead(
        id=company.id,
        legal_name=company.legal_name,
        trade_name=company.trade_name,
        cnpj=company.cnpj,
        is_active=company.is_active,
        corporate_email_required=company.corporate_email_required,
        allowed_domains=company.allowed_domains_json,
    )


@router.get("/company", response_model=CompanyRead)
def get_company(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["company:manage"])),
) -> CompanyRead:
    company = db.get(Company, current.user.company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empresa nao encontrada.")
    return CompanyRead(
        id=company.id,
        legal_name=company.legal_name,
        trade_name=company.trade_name,
        cnpj=company.cnpj,
        is_active=company.is_active,
        corporate_email_required=company.corporate_email_required,
        allowed_domains=company.allowed_domains_json,
    )


@router.patch("/company", response_model=CompanyRead)
def update_company(
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["company:manage"])),
) -> CompanyRead:
    if not payload.legal_name.strip():
        raise HTTPException(status_code=400, detail="Informe uma razao social valida.")
    if not payload.cnpj.strip():
        raise HTTPException(status_code=400, detail="Informe um CNPJ valido.")
    if payload.corporate_email_required and not payload.allowed_domains:
        raise HTTPException(status_code=400, detail="Adicione ao menos um dominio autorizado.")

    company = db.get(Company, current.user.company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empresa nao encontrada.")

    company.name = payload.legal_name.strip()
    company.legal_name = payload.legal_name.strip()
    company.trade_name = payload.trade_name.strip() if payload.trade_name else None
    company.cnpj = payload.cnpj.strip()
    company.allowed_domains_json = payload.allowed_domains
    company.allowed_domain = payload.allowed_domains[0] if payload.allowed_domains else company.allowed_domain
    company.corporate_email_required = payload.corporate_email_required
    company.is_active = payload.is_active
    db.commit()
    db.refresh(company)
    return CompanyRead(
        id=company.id,
        legal_name=company.legal_name,
        trade_name=company.trade_name,
        cnpj=company.cnpj,
        is_active=company.is_active,
        corporate_email_required=company.corporate_email_required,
        allowed_domains=company.allowed_domains_json,
    )


@router.get("/company/policy-governance", response_model=CompanyPolicyGovernanceRead)
def get_company_policy_governance(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["company:manage"])),
) -> CompanyPolicyGovernanceRead:
    try:
        return CompanyPolicyGovernanceRead(
            **get_company_policy_governance_config(db, company_id=current.user.company_id)
        )
    except CompanyPolicyGovernanceRoleError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/company/policy-governance", response_model=CompanyPolicyGovernanceRead)
def update_company_policy_governance(
    payload: CompanyPolicyGovernanceUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["company:manage"])),
) -> CompanyPolicyGovernanceRead:
    try:
        result = update_company_policy_governance_config(
            db,
            company_id=current.user.company_id,
            approval_roles=payload.approval_roles,
            current_user_id=current.user.id,
        )
        db.commit()
        return CompanyPolicyGovernanceRead(**result)
    except CompanyPolicyGovernanceRoleError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/business-units", response_model=BusinessUnitRead, status_code=status.HTTP_201_CREATED)
def create_business_unit(
    payload: BusinessUnitCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["bu:manage"])),
) -> BusinessUnit:
    normalized_name = payload.name.strip()
    duplicated_name = db.scalar(
        select(BusinessUnit).where(
            BusinessUnit.company_id == current.user.company_id,
            BusinessUnit.name == normalized_name,
        )
    )
    if duplicated_name is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma BU cadastrada com esse nome.")

    normalized_code = _next_business_unit_code(db, current.user.company_id)

    bu = BusinessUnit(
        company_id=current.user.company_id,
        code=normalized_code,
        name=normalized_name,
        head_name=payload.head_name.strip(),
        head_email=str(payload.head_email).strip().lower(),
        is_active=payload.is_active,
    )
    db.add(bu)
    db.commit()
    db.refresh(bu)
    return bu


@router.get("/business-units", response_model=list[BusinessUnitRead])
def list_business_units(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)) -> list[BusinessUnit]:
    query = select(BusinessUnit).where(BusinessUnit.company_id == current.user.company_id).order_by(BusinessUnit.name.asc())
    return list(db.scalars(query).all())


@router.patch("/business-units/{business_unit_id}", response_model=BusinessUnitRead)
def update_business_unit(
    business_unit_id: int,
    payload: BusinessUnitUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["bu:manage"])),
) -> BusinessUnit:
    bu = db.get(BusinessUnit, business_unit_id)
    if bu is None or bu.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BU nao encontrada.")

    normalized_name = payload.name.strip()
    duplicated = db.scalar(
        select(BusinessUnit).where(
            BusinessUnit.company_id == current.user.company_id,
            BusinessUnit.id != business_unit_id,
            BusinessUnit.name == normalized_name,
        )
    )
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma BU cadastrada com esse nome.")

    bu.name = normalized_name
    bu.head_name = payload.head_name.strip()
    bu.head_email = str(payload.head_email).strip().lower()
    bu.is_active = payload.is_active
    db.commit()
    db.refresh(bu)
    return bu


@router.patch("/business-units/{business_unit_id}/status", response_model=BusinessUnitRead)
def update_business_unit_status(
    business_unit_id: int,
    payload: BusinessUnitStatusUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["bu:manage"])),
) -> BusinessUnit:
    bu = db.get(BusinessUnit, business_unit_id)
    if bu is None or bu.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BU nao encontrada.")

    bu.is_active = payload.is_active
    db.commit()
    db.refresh(bu)
    return bu


@router.post("/users/invite", response_model=InviteRead)
def invite_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:manage"])),
) -> InviteRead:
    company = db.get(Company, current.user.company_id)
    if company is None:
        raise HTTPException(status_code=400, detail="Empresa nao encontrada.")
    email = payload.email.lower()
    allowed_domains = company.allowed_domains_json or [company.allowed_domain]
    if company.corporate_email_required and not any(email.endswith(f"@{domain}") for domain in allowed_domains):
        raise HTTPException(status_code=400, detail="Dominio de email nao permitido.")

    role: Role | None = None
    if payload.is_administrator:
        role = _get_or_create_administrator_role(db, current.user.company_id)
    elif payload.profile_id is not None:
        role = db.scalar(
            select(Role).where(
                Role.id == payload.profile_id,
                Role.company_id == current.user.company_id,
                Role.is_active.is_(True),
            )
        )
    elif payload.role:
        role = db.scalar(
            select(Role).where(
                Role.company_id == current.user.company_id,
                Role.name == payload.role,
                Role.is_active.is_(True),
            )
        )
    if role is None and not payload.is_administrator:
        role = _get_or_create_standard_user_role(db, current.user.company_id)
    if role is None:
        raise HTTPException(status_code=400, detail="Configuração de acesso inválida.")
    if payload.can_import_ar_aging and not payload.is_administrator:
        role = _get_or_create_role_with_extra_permissions(
            db,
            company_id=current.user.company_id,
            base_role=role,
            extra_permission_keys=[AR_AGING_IMPORT_PERMISSION_KEY],
        )

    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Usuario ja cadastrado.")

    user = User(
        company_id=current.user.company_id,
        role_id=role.id,
        user_code=_next_user_code(db, current.user.company_id),
        username=_next_username(db, email),
        full_name=payload.full_name.strip(),
        email=email,
        phone=payload.phone.strip(),
        password_hash=hash_password(generate_raw_token()),
        must_change_password=True,
        is_active=True,
    )
    db.add(user)
    db.flush()

    for bu_id in payload.business_unit_ids:
        bu = db.get(BusinessUnit, bu_id)
        if bu is None or bu.company_id != current.user.company_id or not bu.is_active:
            raise HTTPException(status_code=400, detail="Escopo de BU invalido para este usuario.")
        db.add(UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id))

    ensure_workflow_roles_seed(db)
    _replace_user_workflow_roles(
        db,
        company_id=current.user.company_id,
        target_user_id=user.id,
        actor_user_id=current.user.id,
        assignments=payload.workflow_role_assignments,
    )

    raw_token = generate_raw_token()
    db.add(
        UserInvitation(
            company_id=current.user.company_id,
            role_id=role.id,
            email=email,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            is_active=True,
        )
    )
    db.commit()

    return InviteRead(invitation_token=raw_token, email=email)


@router.get("/users", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:view"])),
) -> list[UserRead]:
    users = list(db.scalars(select(User).where(User.company_id == current.user.company_id).order_by(User.full_name.asc())).all())
    return [_user_to_read(db, user) for user in users]


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:manage"])),
) -> UserRead:
    user = db.get(User, user_id)
    if user is None or user.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario nao encontrado.")

    if payload.is_administrator:
        role = _get_or_create_administrator_role(db, current.user.company_id)
    elif payload.profile_id is not None:
        role = db.scalar(
            select(Role).where(
                Role.id == payload.profile_id,
                Role.company_id == current.user.company_id,
                Role.is_active.is_(True),
            )
        )
    else:
        role = _get_or_create_standard_user_role(db, current.user.company_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configuração de acesso inválida.")
    if payload.can_import_ar_aging and not payload.is_administrator:
        role = _get_or_create_role_with_extra_permissions(
            db,
            company_id=current.user.company_id,
            base_role=role,
            extra_permission_keys=[AR_AGING_IMPORT_PERMISSION_KEY],
        )

    user.full_name = payload.full_name.strip()
    user.phone = payload.phone.strip()
    user.role_id = role.id

    db.query(UserBusinessUnitScope).filter(UserBusinessUnitScope.user_id == user.id).delete()
    for bu_id in payload.business_unit_ids:
        bu = db.get(BusinessUnit, bu_id)
        if bu is None or bu.company_id != current.user.company_id or not bu.is_active:
            raise HTTPException(status_code=400, detail="Escopo de BU invalido para este usuario.")
        db.add(UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id))

    ensure_workflow_roles_seed(db)
    _replace_user_workflow_roles(
        db,
        company_id=current.user.company_id,
        target_user_id=user.id,
        actor_user_id=current.user.id,
        assignments=payload.workflow_role_assignments,
    )

    db.commit()
    db.refresh(user)
    return _user_to_read(db, user)


@router.patch("/users/{user_id}/status", response_model=UserRead)
def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:manage"])),
) -> UserRead:
    user = db.get(User, user_id)
    if user is None or user.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario nao encontrado.")
    if user.id == current.user.id and not payload.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nao e permitido inativar o proprio usuario.")

    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return _user_to_read(db, user)


@router.post("/users/{user_id}/invite-token", response_model=InviteRead)
def regenerate_invite_token(
    user_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:manage"])),
) -> InviteRead:
    user = db.get(User, user_id)
    if user is None or user.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario nao encontrado.")
    if not user.must_change_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este usuario ja concluiu o primeiro acesso.")

    db.query(UserInvitation).filter(
        UserInvitation.email == user.email,
        UserInvitation.is_active.is_(True),
    ).update({UserInvitation.is_active: False}, synchronize_session=False)

    raw_token = generate_raw_token()
    db.add(
        UserInvitation(
            company_id=current.user.company_id,
            role_id=user.role_id,
            email=user.email,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            is_active=True,
        )
    )
    db.commit()
    return InviteRead(invitation_token=raw_token, email=user.email)


@router.get("/roles/matrix", response_model=list[RoleMatrixItem])
def role_matrix(_: CurrentUser = Depends(require_permissions(["profiles:view"]))) -> list[RoleMatrixItem]:
    return [RoleMatrixItem(role=role, permissions=permissions) for role, permissions in ROLE_MATRIX.items()]


@router.get("/profiles", response_model=list[ProfileRead])
def list_profiles(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["profiles:view"])),
) -> list[ProfileRead]:
    profiles = list(
        db.scalars(
            select(Role).where(Role.company_id == current.user.company_id).order_by(Role.is_system.desc(), Role.name.asc())
        ).all()
    )
    return [_role_to_profile_read(db, role) for role in profiles]


@router.get("/profiles/{profile_id}", response_model=ProfileRead)
def get_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["profiles:view"])),
) -> ProfileRead:
    role = db.get(Role, profile_id)
    if role is None or role.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil nao encontrado.")
    return _role_to_profile_read(db, role)


@router.post("/profiles", response_model=ProfileRead, status_code=status.HTTP_201_CREATED)
def create_profile(
    payload: ProfileUpsert,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["profiles:manage"])),
) -> ProfileRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um nome valido para o perfil.")
    if not payload.permission_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione ao menos uma permissao.")
    if payload.status not in {"active", "inactive"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de perfil invalido.")
    invalid_keys = [key for key in payload.permission_keys if key not in PROFILE_PERMISSION_CATALOG]
    if invalid_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Permissoes invalidas para este perfil.")

    _ensure_permissions_exist(db)
    duplicated = db.scalar(select(Role).where(Role.company_id == current.user.company_id, Role.name == name))
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe um perfil com este nome.")

    role = Role(
        company_id=current.user.company_id,
        code=_next_profile_code(db, current.user.company_id),
        name=name,
        description=(payload.description or "").strip() or name,
        is_active=payload.status == "active",
        is_system=False,
    )
    db.add(role)
    db.flush()
    permissions = list(db.scalars(select(Permission).where(Permission.key.in_(payload.permission_keys))).all())
    for permission in permissions:
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.commit()
    db.refresh(role)
    return _role_to_profile_read(db, role)


@router.patch("/profiles/{profile_id}", response_model=ProfileRead)
def update_profile(
    profile_id: int,
    payload: ProfileUpsert,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["profiles:manage"])),
) -> ProfileRead:
    role = db.get(Role, profile_id)
    if role is None or role.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil nao encontrado.")
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este perfil e protegido e nao pode ser alterado nesta acao.",
        )
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um nome valido para o perfil.")
    if not payload.permission_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione ao menos uma permissao.")
    if payload.status not in {"active", "inactive"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de perfil invalido.")
    invalid_keys = [key for key in payload.permission_keys if key not in PROFILE_PERMISSION_CATALOG]
    if invalid_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Permissoes invalidas para este perfil.")

    _ensure_permissions_exist(db)
    duplicated = db.scalar(
        select(Role).where(Role.company_id == current.user.company_id, Role.name == name, Role.id != profile_id)
    )
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe um perfil com este nome.")

    role.name = name
    role.description = (payload.description or "").strip() or name
    role.is_active = payload.status == "active"
    db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
    permissions = list(db.scalars(select(Permission).where(Permission.key.in_(payload.permission_keys))).all())
    for permission in permissions:
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.commit()
    db.refresh(role)
    return _role_to_profile_read(db, role)


@router.patch("/profiles/{profile_id}/status", response_model=ProfileRead)
def update_profile_status(
    profile_id: int,
    payload: ProfileStatusUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["profiles:manage"])),
) -> ProfileRead:
    role = db.get(Role, profile_id)
    if role is None or role.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil nao encontrado.")
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este perfil e protegido e nao pode ser alterado nesta acao.",
        )
    if payload.status not in {"active", "inactive"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de perfil invalido.")

    role.is_active = payload.status == "active"
    db.commit()
    db.refresh(role)
    return _role_to_profile_read(db, role)


@router.post("/reset-operational-data")
def reset_operational_data(
    payload: ResetOperationalDataRequest,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["company:manage"])),
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

    current_role_name = db.scalar(select(Role.name).where(Role.id == _.user.role_id))
    if current_role_name != "administrador_master":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operacao permitida apenas para Master/Admin.")

    try:
        plan = build_execution_plan(payload.domains)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    coverage = validate_registry_coverage()
    domain_catalog = list_reset_domains()
    domain_summary = [
        {
            "key": key,
            "label": domain_catalog[key]["label"],
            "group": domain_catalog[key].get("group"),
            "description": domain_catalog[key]["description"],
            "tables": domain_catalog[key]["tables"],
        }
        for key in plan.domains
    ]
    impact_preview = count_business_impact(db, plan.table_order)

    if payload.preview_only:
        return {
            "status": "preview",
            "preview_only": True,
            "reset_scope": "total_operational" if plan.is_total_reset else "partial_operational",
            "domains": plan.domains,
            "domain_summary": domain_summary,
            "impact_preview": impact_preview,
            "total_deleted": 0,
            "tables": [],
            "coverage": {
                "missing_in_registry": coverage["missing_in_registry"],
                "unknown_in_registry": coverage["unknown_in_registry"],
            },
        }

    try:
        total_deleted, summary = execute_table_cleanup(db, plan.table_order)

        master_admin = {
            "status": "preserved",
            "email": DEFAULT_MASTER_EMAIL,
            "profile": "administrador_master",
            "is_active": True,
            "full_access": True,
        }
        if plan.should_reseed_master:
            company, master_role = _seed_default_governance(db)
            db.add(
                User(
                    company_id=company.id,
                    role_id=master_role.id,
                    user_code="USR-0001",
                    username=DEFAULT_MASTER_EMAIL.split("@")[0],
                    full_name=DEFAULT_MASTER_NAME,
                    email=DEFAULT_MASTER_EMAIL,
                    phone=None,
                    password_hash=hash_password(DEFAULT_MASTER_PASSWORD),
                    is_active=True,
                    must_change_password=False,
                )
            )
            db.flush()
            master_admin["status"] = "recreated"

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "ok",
        "preview_only": False,
        "reset_scope": "total_operational" if plan.is_total_reset else "partial_operational",
        "domains": plan.domains,
        "domain_summary": domain_summary,
        "impact_preview": impact_preview,
        "total_deleted": total_deleted,
        "tables": summary,
        "master_admin": master_admin,
        "coverage": {
            "missing_in_registry": coverage["missing_in_registry"],
            "unknown_in_registry": coverage["unknown_in_registry"],
        },
        "default_master_user": {
            "email": DEFAULT_MASTER_EMAIL,
            "password_reset_required": False,
        },
    }


@router.get("/workflow-roles", response_model=list[WorkflowRoleRead])
def list_workflow_roles(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["users:view"])),
) -> list[WorkflowRole]:
    if not _table_exists(db, "workflow_roles"):
        return []
    ensure_workflow_roles_seed(db)
    try:
        db.commit()
        return list(
            db.scalars(
                select(WorkflowRole)
                .where(
                    WorkflowRole.is_active.is_(True),
                    WorkflowRole.code.not_in(LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODE_SET),
                )
                .order_by(WorkflowRole.type.asc(), WorkflowRole.name.asc())
            ).all()
        )
    except SQLAlchemyError:
        db.rollback()
        return []


@router.get("/users/{user_id}/workflow-roles", response_model=list[UserWorkflowRoleRead])
def list_user_workflow_roles(
    user_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:view"])),
) -> list[UserWorkflowRoleRead]:
    user = db.get(User, user_id)
    if user is None or user.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario nao encontrado.")
    return _list_user_workflow_roles(db, user_id)


@router.put("/users/{user_id}/workflow-roles", response_model=list[UserWorkflowRoleRead])
def update_user_workflow_roles(
    user_id: int,
    payload: UserWorkflowRolesUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["users:manage"])),
) -> list[UserWorkflowRoleRead]:
    user = db.get(User, user_id)
    if user is None or user.company_id != current.user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario nao encontrado.")

    if not _table_exists(db, "workflow_roles") or not _table_exists(db, "user_workflow_roles"):
        return []
    ensure_workflow_roles_seed(db)
    _replace_user_workflow_roles(
        db,
        company_id=current.user.company_id,
        target_user_id=user.id,
        actor_user_id=current.user.id,
        assignments=payload.assignments,
    )
    db.commit()
    return _list_user_workflow_roles(db, user.id)


@router.get("/approval-matrix/options", response_model=ApprovalMatrixOptionsRead)
def get_approval_matrix_options(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["approval.matrix:view"])),
) -> ApprovalMatrixOptionsRead:
    workflow_roles = []
    if _table_exists(db, "workflow_roles"):
        ensure_workflow_roles_seed(db)
        try:
            workflow_roles = list(
                db.scalars(
                    select(WorkflowRole)
                    .where(
                        WorkflowRole.is_active.is_(True),
                        WorkflowRole.code.not_in(LEGACY_OPERATIONAL_WORKFLOW_ROLE_CODE_SET),
                    )
                    .order_by(WorkflowRole.type.asc(), WorkflowRole.name.asc())
                ).all()
            )
        except SQLAlchemyError:
            db.rollback()
            workflow_roles = []
    business_units = list(
        db.scalars(
            select(BusinessUnit)
            .where(BusinessUnit.company_id == current.user.company_id)
            .order_by(BusinessUnit.name.asc())
        ).all()
    )
    return ApprovalMatrixOptionsRead(
        workflow_roles=[ApprovalMatrixOptionWorkflowRole.model_validate(role) for role in workflow_roles],
        business_units=[ApprovalMatrixOptionBusinessUnit.model_validate(unit) for unit in business_units],
    )


@router.get("/approval-matrix", response_model=list[ApprovalMatrixRuleRead])
def get_approval_matrix_rules(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["approval.matrix:view"])),
) -> list[ApprovalMatrixRuleRead]:
    if not _table_exists(db, "approval_matrix_rules"):
        return []
    ensure_workflow_roles_seed(db)
    ensure_approval_matrix_seed(db)
    try:
        db.commit()
        rules = list_approval_matrix_rules(db, company_id=current.user.company_id)
    except SQLAlchemyError:
        db.rollback()
        return []
    return [_approval_rule_to_read(db, rule) for rule in rules]


@router.post("/approval-matrix", response_model=ApprovalMatrixRuleRead, status_code=status.HTTP_201_CREATED)
def create_approval_matrix_rule_endpoint(
    payload: ApprovalMatrixRuleWrite,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["approval.matrix:manage"])),
) -> ApprovalMatrixRuleRead:
    if not _table_exists(db, "approval_matrix_rules") or not _table_exists(db, "approval_matrix_rule_roles"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Matriz de aprovacao indisponivel. Aplique as migrations de governanca.",
        )
    ensure_workflow_roles_seed(db)
    if payload.business_unit_id is not None:
        bu = db.get(BusinessUnit, payload.business_unit_id)
        if bu is None or bu.company_id != current.user.company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BU invalida para esta regra.")
    next_code = generate_next_approval_matrix_code(db)
    duplicated = db.scalar(select(ApprovalMatrixRule.id).where(ApprovalMatrixRule.code == next_code))
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma regra com este codigo.")
    try:
        rule = create_approval_matrix_rule(db, payload=payload, created_by_user_id=current.user.id)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _approval_rule_to_read(db, rule)


@router.get("/approval-matrix/next-code")
def get_approval_matrix_next_code(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["approval.matrix:view"])),
) -> dict[str, str]:
    if not _table_exists(db, "approval_matrix_rules"):
        return {"code": "DOA-0001"}
    return {"code": generate_next_approval_matrix_code(db)}


@router.put("/approval-matrix/{rule_id}", response_model=ApprovalMatrixRuleRead)
def update_approval_matrix_rule_endpoint(
    rule_id: int,
    payload: ApprovalMatrixRuleWrite,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["approval.matrix:manage"])),
) -> ApprovalMatrixRuleRead:
    if not _table_exists(db, "approval_matrix_rules") or not _table_exists(db, "approval_matrix_rule_roles"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Matriz de aprovacao indisponivel. Aplique as migrations de governanca.",
        )
    rule = db.get(ApprovalMatrixRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regra de aprovacao nao encontrada.")
    if payload.business_unit_id is not None:
        bu = db.get(BusinessUnit, payload.business_unit_id)
        if bu is None or bu.company_id != current.user.company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BU invalida para esta regra.")
    duplicated = db.scalar(
        select(ApprovalMatrixRule.id).where(ApprovalMatrixRule.code == payload.code, ApprovalMatrixRule.id != rule_id)
    )
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma regra com este codigo.")
    try:
        updated = update_approval_matrix_rule(db, rule=rule, payload=payload)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _approval_rule_to_read(db, updated)
