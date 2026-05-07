from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user, require_permissions
from app.db.session import get_db
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.role import Role
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
    RoleMatrixItem,
    UserCreate,
    UserRead,
)
from app.services.bootstrap_admin import ROLE_MATRIX
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
]


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
    normalized_code = (payload.code or normalized_name).strip().upper()

    duplicated = db.scalar(
        select(BusinessUnit).where(
            BusinessUnit.company_id == current.user.company_id,
            (BusinessUnit.code == normalized_code) | (BusinessUnit.name == normalized_name),
        )
    )
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma BU cadastrada com essas informacoes.")

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
    normalized_code = (payload.code or normalized_name).strip().upper()
    duplicated = db.scalar(
        select(BusinessUnit).where(
            BusinessUnit.company_id == current.user.company_id,
            BusinessUnit.id != business_unit_id,
            (BusinessUnit.code == normalized_code) | (BusinessUnit.name == normalized_name),
        )
    )
    if duplicated is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ja existe uma BU cadastrada com essas informacoes.")

    bu.name = normalized_name
    bu.code = normalized_code
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

    role = db.scalar(select(Role).where(Role.name == payload.role))
    if role is None:
        raise HTTPException(status_code=400, detail="Perfil invalido.")

    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Usuario ja cadastrado.")

    user = User(
        company_id=current.user.company_id,
        role_id=role.id,
        full_name=payload.full_name.strip(),
        email=email,
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
    result: list[UserRead] = []
    for user in users:
        bu_ids = list(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
        result.append(
            UserRead(
                id=user.id,
                full_name=user.full_name,
                email=user.email,
                role=user.role.name,
                is_active=user.is_active,
                business_unit_ids=bu_ids,
            )
        )
    return result


@router.get("/roles/matrix", response_model=list[RoleMatrixItem])
def role_matrix(_: CurrentUser = Depends(require_permissions(["profiles:view"]))) -> list[RoleMatrixItem]:
    return [RoleMatrixItem(role=role, permissions=permissions) for role, permissions in ROLE_MATRIX.items()]


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

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"status": "ok", "total_deleted": total_deleted, "tables": summary}
