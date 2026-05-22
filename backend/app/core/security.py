from dataclasses import dataclass

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.permission import Permission
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.services.permission_catalog import PROFILE_PERMISSION_CATALOG
from app.services.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

DEFAULT_CLIENTS_PERMISSIONS = {
    "clients.dashboard.view",
    "clients.portfolio.view",
    "clients.portfolio.evolution.view",
    "clients.dossier.view",
    "clients.imports.history.view",
}
DEFAULT_CREDIT_WORKFLOW_PERMISSIONS = {
    "credit.dashboard.view",
    "credit_request_view_own",
    "credit_request_submit",
}

ADMIN_CONTROLLED_PERMISSIONS = {
    "company:manage",
    "bu:manage",
    "users:view",
    "users:manage",
    "profiles:view",
    "profiles:manage",
    "approval.matrix:view",
    "approval.matrix:manage",
}
ADMINISTRATOR_BASE_PERMISSIONS = {"company:manage", "bu:manage", "users:manage"}


@dataclass
class CurrentUser:
    user: User
    permissions: set[str]
    bu_ids: set[int]
    is_administrator: bool
    can_import_ar_aging: bool


def _is_administrator_permissions(user: User, permissions: set[str]) -> bool:
    if user.role and user.role.name == "administrador_master":
        return True
    if ADMINISTRATOR_BASE_PERMISSIONS.issubset(permissions):
        return True
    return set(PROFILE_PERMISSION_CATALOG.keys()).issubset(permissions)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> CurrentUser:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido.") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario invalido.")

    role_permissions = set(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user.role_id)
        ).all()
    )
    is_administrator = _is_administrator_permissions(user, role_permissions)
    can_import_ar_aging = "clients.aging.import" in role_permissions
    permissions = set(role_permissions)
    permissions.update(DEFAULT_CLIENTS_PERMISSIONS)
    permissions.update(DEFAULT_CREDIT_WORKFLOW_PERMISSIONS)
    if is_administrator:
        permissions.update(ADMIN_CONTROLLED_PERMISSIONS)
    bu_ids = set(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
    return CurrentUser(
        user=user,
        permissions=permissions,
        bu_ids=bu_ids,
        is_administrator=is_administrator,
        can_import_ar_aging=can_import_ar_aging,
    )


def require_permissions(required: list[str]):
    def dependency(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if any(permission in ADMIN_CONTROLLED_PERMISSIONS for permission in required):
            if not current.is_administrator:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")
        if not set(required).issubset(current.permissions):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissao para esta operacao.")
        return current

    return dependency


def require_bu_scope(
    bu_id: int = Query(..., alias="bu_id"),
    current: CurrentUser = Depends(get_current_user),
) -> int:
    if "scope:all_bu" in current.permissions:
        return bu_id
    if bu_id not in current.bu_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario sem acesso a esta BU.")
    return bu_id
