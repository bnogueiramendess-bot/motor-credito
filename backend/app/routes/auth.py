from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user
from app.db.session import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.models.user_invitation import UserInvitation
from app.models.permission import Permission
from app.models.role_permission import RolePermission
from app.schemas.auth import (
    AcceptInviteRequest,
    AuthResponse,
    InvitePreviewResponse,
    LoginRequest,
    RefreshRequest,
    TokenPairResponse,
    UserContextResponse,
)
from app.services.security import (
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_access_token,
    generate_raw_token,
    hash_password,
    hash_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _build_user_context(db: Session, user: User) -> UserContextResponse:
    permissions = list(
        db.scalars(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user.role_id)
        ).all()
    )
    bu_ids = list(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
    return UserContextResponse(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=user.role.name,
        company_id=user.company_id,
        allowed_bu_ids=bu_ids,
        permissions=permissions,
    )


def _issue_tokens(db: Session, user: User) -> TokenPairResponse:
    access_token = create_access_token(user_id=user.id, email=user.email)
    raw_refresh = generate_raw_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
            revoked=False,
        )
    )
    db.commit()
    return TokenPairResponse(access_token=access_token, refresh_token=raw_refresh)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    identifier = (payload.login or payload.email or "").strip().lower()
    user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.email) == identifier,
                func.lower(User.username) == identifier,
            )
        )
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inativo.")

    tokens = _issue_tokens(db, user)
    return AuthResponse(tokens=tokens, user=_build_user_context(db, user))


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    hashed = hash_token(payload.refresh_token)
    token_row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hashed, RefreshToken.revoked.is_(False)))
    if token_row is None or token_row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token invalido.")

    user = db.get(User, token_row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario invalido.")

    token_row.revoked = True
    db.commit()
    return _issue_tokens(db, user)


@router.post("/accept-invite", response_model=AuthResponse)
def accept_invite(payload: AcceptInviteRequest, db: Session = Depends(get_db)) -> AuthResponse:
    invitation = db.scalar(
        select(UserInvitation).where(UserInvitation.token_hash == hash_token(payload.token), UserInvitation.is_active.is_(True))
    )
    if invitation is None or invitation.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Convite invalido ou expirado.")

    user = db.scalar(select(User).where(User.email == invitation.email))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario do convite nao encontrado.")

    if payload.full_name is not None and payload.full_name.strip():
        user.full_name = payload.full_name.strip()
    user.password_hash = hash_password(payload.password)
    user.must_change_password = False
    invitation.is_active = False
    invitation.accepted_at = datetime.now(timezone.utc)
    db.commit()

    return AuthResponse(tokens=_issue_tokens(db, user), user=_build_user_context(db, user))


@router.get("/invite-preview", response_model=InvitePreviewResponse)
def invite_preview(token: str, db: Session = Depends(get_db)) -> InvitePreviewResponse:
    invitation = db.scalar(
        select(UserInvitation).where(UserInvitation.token_hash == hash_token(token), UserInvitation.is_active.is_(True))
    )
    if invitation is None or invitation.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Convite invalido ou expirado.")

    user = db.scalar(select(User).where(User.email == invitation.email))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario do convite nao encontrado.")

    return InvitePreviewResponse(username=user.username)


@router.get("/me", response_model=UserContextResponse)
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> UserContextResponse:
    return _build_user_context(db, current.user)
