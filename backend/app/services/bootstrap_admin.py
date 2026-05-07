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
        "scope:all_bu",
    ],
    "administrador_bu": ["bu:manage", "users:manage", "profiles:view"],
    "analista": ["profiles:view"],
    "visualizador": ["profiles:view"],
}


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
    for role_name, permissions in ROLE_MATRIX.items():
        role = db.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            role = Role(name=role_name, description=role_name.replace("_", " ").title())
            db.add(role)
            db.flush()
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

    master_email = "bruno.mendes@indorama.com"
    master_user = db.scalar(select(User).where(User.email == master_email))
    if master_user is None:
        db.add(
            User(
                company_id=company.id,
                role_id=role_by_name["administrador_master"].id,
                full_name="Administrador Master",
                email=master_email,
                password_hash=hash_password("Admin@123"),
                is_active=True,
                must_change_password=True,
            )
        )

    db.commit()
