from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
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
from app.models.user_invitation import UserInvitation
from app.schemas.administration import (
    BusinessUnitCreate,
    BusinessUnitRead,
    BusinessUnitStatusUpdate,
    BusinessUnitUpdate,
    CompanyCreate,
    CompanyRead,
    CompanyUpdate,
    InviteRead,
    ProfileRead,
    ProfileStatusUpdate,
    ProfileUpsert,
    RoleMatrixItem,
    UserCreate,
    UserRead,
    UserStatusUpdate,
    UserUpdate,
)
from app.services.bootstrap_admin import (
    DEFAULT_MASTER_EMAIL,
    DEFAULT_MASTER_NAME,
    DEFAULT_MASTER_PASSWORD,
    ROLE_MATRIX,
)
from app.services.security import generate_raw_token, hash_password, hash_token

router = APIRouter(prefix="/admin", tags=["admin"])

REQUIRED_CONFIRMATION = "RESET_OPERATIONAL_DATA"

TABLES_TO_CLEAN = [
    "external_data_files",
    "decision_events",
    "score_results",
    "external_data_entries",
    "credit_analyses",
    "customers",
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
    "business_units",
    "users",
    "role_permissions",
    "permissions",
    "roles",
    "companies",
]

SYSTEM_PROFILE_NAMES = {"administrador_master"}

PROFILE_PERMISSION_CATALOG: dict[str, str] = {
    "clients.dashboard.view": "Visualizar dashboard de clientes.",
    "clients.portfolio.view": "Visualizar carteira de clientes.",
    "clients.portfolio.evolution.view": "Visualizar evolucao da carteira.",
    "clients.dossier.view": "Abrir detalhe do cliente.",
    "clients.aging.import": "Importar AR Aging.",
    "clients.imports.history.view": "Visualizar historico de importacoes.",
    "credit.dashboard.view": "Visualizar dashboard de credito.",
    "credit.request.create": "Criar solicitacao de credito.",
    "credit.requests.view": "Visualizar solicitacoes de credito.",
    "credit.analysis.execute": "Executar analise de credito.",
    "credit.dossier.edit": "Editar dossie de credito.",
    "credit.request.submit": "Submeter solicitacao para aprovacao.",
    "credit.approval.approve": "Aprovar credito.",
    "credit.approval.reject": "Reprovar credito.",
    "credit.policy.view": "Visualizar politica de credito.",
    "credit.policy.manage": "Gerenciar politica de credito.",
    "company:view": "Visualizar empresa.",
    "company:manage": "Gerenciar empresa.",
    "bu:manage": "Gerenciar unidades de negocio.",
    "users:view": "Visualizar usuarios.",
    "users:manage": "Gerenciar usuarios.",
    "profiles:view": "Visualizar perfis.",
    "profiles:manage": "Gerenciar perfis.",
    "audit:view": "Visualizar auditoria.",
    "scope:all_bu": "Acesso total as unidades de negocio.",
}


class ResetOperationalDataRequest(BaseModel):
    confirm: str


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
    return UserRead(
        id=user.id,
        user_code=user.user_code,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        profile_name=user.role.name,
        is_active=user.is_active,
        first_access_pending=user.must_change_password,
        business_unit_ids=bu_ids,
        business_unit_names=bu_names,
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
    if payload.profile_id is not None:
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
    if role is None:
        raise HTTPException(status_code=400, detail="Perfil invalido.")

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
def list_users(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)) -> list[UserRead]:
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

    role = db.scalar(
        select(Role).where(
            Role.id == payload.profile_id,
            Role.company_id == current.user.company_id,
            Role.is_active.is_(True),
        )
    )
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Perfil invalido.")

    user.full_name = payload.full_name.strip()
    user.phone = payload.phone.strip()
    user.role_id = role.id

    db.query(UserBusinessUnitScope).filter(UserBusinessUnitScope.user_id == user.id).delete()
    for bu_id in payload.business_unit_ids:
        bu = db.get(BusinessUnit, bu_id)
        if bu is None or bu.company_id != current.user.company_id or not bu.is_active:
            raise HTTPException(status_code=400, detail="Escopo de BU invalido para este usuario.")
        db.add(UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id))

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

    summary: list[dict[str, int | str | bool]] = []
    total_deleted = 0

    try:
        for table_name in TABLES_TO_CLEAN:
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
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "ok",
        "total_deleted": total_deleted,
        "tables": summary,
        "default_master_user": {"email": DEFAULT_MASTER_EMAIL, "password": DEFAULT_MASTER_PASSWORD},
    }
