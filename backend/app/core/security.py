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
from app.services.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


@dataclass
class CurrentUser:
    user: User
    permissions: set[str]
    bu_ids: set[int]


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> CurrentUser:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido.") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario invalido.")

    permissions = set(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user.role_id)
        ).all()
    )
    bu_ids = set(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
    return CurrentUser(user=user, permissions=permissions, bu_ids=bu_ids)


def require_permissions(required: list[str]):
    def dependency(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
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
