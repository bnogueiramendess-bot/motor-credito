from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.business_unit import BusinessUnit
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_text_key


BU_SCOPE_FORBIDDEN_MESSAGE = "Você não possui permissão para acessar informações desta unidade de negócio."


@dataclass(frozen=True, slots=True)
class ScopedBusinessUnit:
    id: int
    code: str
    name: str


@dataclass(frozen=True, slots=True)
class BusinessUnitContextResolution:
    selected_context: str
    effective_bu_names: set[str]
    effective_bu_codes: set[str]
    has_all_scope: bool
    is_consolidated: bool


def user_has_all_bu_scope(current: CurrentUser) -> bool:
    return "scope:all_bu" in current.permissions


def get_user_allowed_business_unit_records(db: Session, current: CurrentUser) -> list[ScopedBusinessUnit]:
    query = select(BusinessUnit.id, BusinessUnit.code, BusinessUnit.name).where(
        BusinessUnit.company_id == current.user.company_id,
        BusinessUnit.is_active.is_(True),
    )
    if not user_has_all_bu_scope(current):
        query = query.join(UserBusinessUnitScope, UserBusinessUnitScope.business_unit_id == BusinessUnit.id).where(
            UserBusinessUnitScope.user_id == current.user.id
        )

    rows = db.execute(query.order_by(BusinessUnit.name.asc(), BusinessUnit.id.asc())).all()
    unique: dict[int, ScopedBusinessUnit] = {}
    for bu_id, code, name in rows:
        if not name:
            continue
        unique[int(bu_id)] = ScopedBusinessUnit(id=int(bu_id), code=str(code or ""), name=str(name))
    return list(unique.values())


def get_user_allowed_business_units(db: Session, current: CurrentUser) -> set[str]:
    return {normalize_bu(item.name).bu_normalized for item in get_user_allowed_business_unit_records(db, current) if item.name}


def bu_name_in_scope(allowed_bu_names: set[str], bu_name: str | None, *, has_all_scope: bool) -> bool:
    if has_all_scope:
        return True
    if not allowed_bu_names or not bu_name:
        return False
    canonical_bu = normalize_bu(bu_name).bu_normalized
    if not canonical_bu:
        return False
    canonical_allowed = {normalize_bu(name).bu_normalized for name in allowed_bu_names if name}
    return canonical_bu in canonical_allowed


def assert_bu_in_scope(allowed_bu_names: set[str], bu_name: str | None, *, has_all_scope: bool) -> None:
    if bu_name_in_scope(allowed_bu_names, bu_name, has_all_scope=has_all_scope):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BU_SCOPE_FORBIDDEN_MESSAGE)


def resolve_business_unit_context(db: Session, current: CurrentUser, business_unit_context: str | None) -> BusinessUnitContextResolution:
    allowed_records = get_user_allowed_business_unit_records(db, current)
    has_all_scope = user_has_all_bu_scope(current)
    allowed_by_name = {item.name: item for item in allowed_records}
    allowed_by_code = {item.code: item for item in allowed_records if item.code}
    allowed_by_id = {str(item.id): item for item in allowed_records}

    candidate_raw = business_unit_context if isinstance(business_unit_context, str) else ""
    candidate = candidate_raw.strip()
    if candidate.casefold() == "consolidated":
        effective_names = {normalize_bu(item.name).bu_normalized for item in allowed_records if item.name}
        return BusinessUnitContextResolution(
            selected_context="consolidated",
            effective_bu_names=effective_names,
            effective_bu_codes=set(allowed_by_code.keys()),
            has_all_scope=has_all_scope,
            is_consolidated=True,
        )

    if candidate:
        normalized = normalize_text_key(candidate)
        canonical_candidate = normalize_bu(candidate).bu_normalized
        chosen = allowed_by_id.get(candidate) or allowed_by_code.get(candidate) or allowed_by_name.get(candidate)
        if chosen is None and normalized:
            for item in allowed_records:
                if (
                    normalize_text_key(item.name) == normalized
                    or normalize_text_key(item.code) == normalized
                    or normalize_bu(item.name).bu_normalized == canonical_candidate
                ):
                    chosen = item
                    break
        if chosen is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BU_SCOPE_FORBIDDEN_MESSAGE)
        canonical_name = normalize_bu(chosen.name).bu_normalized
        return BusinessUnitContextResolution(
            selected_context=chosen.code or chosen.name,
            effective_bu_names={canonical_name},
            effective_bu_codes={chosen.code} if chosen.code else set(),
            has_all_scope=False,
            is_consolidated=False,
        )

    if len(allowed_records) == 1:
        single = allowed_records[0]
        canonical_name = normalize_bu(single.name).bu_normalized
        return BusinessUnitContextResolution(
            selected_context=single.code or single.name,
            effective_bu_names={canonical_name},
            effective_bu_codes={single.code} if single.code else set(),
            has_all_scope=False,
            is_consolidated=False,
        )

    effective_names = {normalize_bu(item.name).bu_normalized for item in allowed_records if item.name}
    return BusinessUnitContextResolution(
        selected_context="consolidated",
        effective_bu_names=effective_names,
        effective_bu_codes=set(allowed_by_code.keys()),
        has_all_scope=has_all_scope,
        is_consolidated=True,
    )


def resolve_analysis_business_unit(db: Session, analysis: CreditAnalysis) -> str | None:
    customer = db.get(Customer, analysis.customer_id)
    if customer is None:
        return None
    bu_name = db.scalar(
        select(func.max(ArAgingDataTotalRow.bu_normalized)).where(
            ArAgingDataTotalRow.cnpj_normalized == customer.document_number
        )
    )
    if bu_name:
        return str(bu_name)

    triage = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    triage_submission = triage.get("triage_submission") if isinstance(triage.get("triage_submission"), dict) else {}
    bu_from_triage = triage_submission.get("business_unit")
    if isinstance(bu_from_triage, str) and bu_from_triage.strip():
        return bu_from_triage.strip()
    return None


def normalize_bu_name(name: str | None) -> str | None:
    if not name:
        return None
    normalized = normalize_text_key(name)
    return normalized or None
