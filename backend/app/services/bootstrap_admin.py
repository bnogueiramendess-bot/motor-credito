from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.services.security import hash_password

ROLE_MATRIX: dict[str, list[str]] = {
    "administrador_master": [
        "company:manage",
        "bu:manage",
        "users:manage",
        "profiles:view",
        "profiles:manage",
        "scope:all_bu",
    ]
}

DEFAULT_MASTER_EMAIL = "adm@administrador.com"
DEFAULT_MASTER_PASSWORD = "administrador"
DEFAULT_MASTER_NAME = "Administrador"


def _next_available_user_code(db: Session) -> str:
    existing_codes = list(db.scalars(select(User.user_code)).all())
    max_number = 0
    for code in existing_codes:
        if code and code.startswith("USR-"):
            suffix = code.split("USR-")[-1]
            if suffix.isdigit():
                max_number = max(max_number, int(suffix))
    return f"USR-{(max_number + 1):04d}"


def ensure_admin_seed(db: Session) -> None:
    company = db.scalar(select(Company).where(Company.name == "Indorama do Brasil"))
    if company is None:
        company = Company(
            name="Indorama do Brasil",
            legal_name="Indorama do Brasil",
            trade_name="Indorama",
            cnpj=None,
            allowed_domain="indorama.com",
            allowed_domains_json=["indorama.com"],
            corporate_email_required=True,
            is_active=True,
        )
        db.add(company)
        db.flush()

    permission_by_key: dict[str, Permission] = {}
    for key in sorted({item for items in ROLE_MATRIX.values() for item in items}):
        permission = db.scalar(select(Permission).where(Permission.key == key))
        if permission is None:
            permission = Permission(key=key, description=key)
            db.add(permission)
            db.flush()
        permission_by_key[key] = permission

    role_by_name: dict[str, Role] = {}
    used_codes = set(db.scalars(select(Role.code).where(Role.company_id == company.id)).all())

    def _next_available_profile_code() -> str:
        sequence = 1
        while True:
            candidate = f"PERF-{sequence:04d}"
            if candidate not in used_codes:
                used_codes.add(candidate)
                return candidate
            sequence += 1

    for index, (role_name, permissions) in enumerate(ROLE_MATRIX.items(), start=1):
        desired_code = f"PERF-{index:04d}"
        role = db.scalar(select(Role).where(Role.company_id == company.id, Role.name == role_name))
        role_by_code = db.scalar(select(Role).where(Role.company_id == company.id, Role.code == desired_code))

        if role is None and role_by_code is not None:
            role = role_by_code
            role.name = role_name
            role.description = role_name.replace("_", " ").title()

        if role is None:
            code_to_use = desired_code if desired_code not in used_codes else _next_available_profile_code()
            used_codes.add(code_to_use)
            role = Role(
                company_id=company.id,
                code=code_to_use,
                name=role_name,
                description=role_name.replace("_", " ").title(),
                is_active=True,
                is_system=True,
            )
            db.add(role)
            db.flush()
        else:
            role.is_system = True
            role.is_active = True
            if not role.code:
                role.code = _next_available_profile_code()
            used_codes.add(role.code)
        role_by_name[role_name] = role

        existing_keys = set(
            db.scalars(
                select(Permission.key)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .where(RolePermission.role_id == role.id)
            ).all()
        )
        for key in permissions:
            if key not in existing_keys:
                db.add(RolePermission(role_id=role.id, permission_id=permission_by_key[key].id))

    master_email = DEFAULT_MASTER_EMAIL
    master_user = db.scalar(select(User).where(User.email == master_email))
    if master_user is None:
        db.add(
            User(
                company_id=company.id,
                role_id=role_by_name["administrador_master"].id,
                user_code=_next_available_user_code(db),
                username=master_email.split("@")[0],
                full_name=DEFAULT_MASTER_NAME,
                email=master_email,
                phone=None,
                password_hash=hash_password(DEFAULT_MASTER_PASSWORD),
                is_active=True,
                must_change_password=False,
            )
        )

    db.commit()
