from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, require_permissions
from app.db.session import get_db
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerRead
from app.services.bu_scope import bu_name_in_scope, get_user_allowed_business_units, resolve_analysis_business_unit, user_has_all_bu_scope

router = APIRouter(prefix="/customers", tags=["customers"])


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["credit.request.create"])),
) -> Customer:
    customer = Customer(**payload.model_dump())
    db.add(customer)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Customer with this document number already exists.",
        ) from exc
    db.refresh(customer)
    return customer


@router.get("", response_model=list[CustomerRead])
def list_customers(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> list[Customer]:
    if user_has_all_bu_scope(current):
        return list(db.scalars(select(Customer).order_by(Customer.id.desc())).all())

    allowed_bu_names = get_user_allowed_business_units(db, current)
    if not allowed_bu_names:
        return []

    allowed_documents = set(
        db.scalars(
            select(ArAgingDataTotalRow.cnpj_normalized)
            .where(ArAgingDataTotalRow.cnpj_normalized.is_not(None), ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
            .distinct()
        ).all()
    )
    analysis_customer_ids: set[int] = set()
    analyses = db.scalars(select(CreditAnalysis)).all()
    for analysis in analyses:
        analysis_bu = resolve_analysis_business_unit(db, analysis)
        if bu_name_in_scope(allowed_bu_names, analysis_bu, has_all_scope=False):
            analysis_customer_ids.add(analysis.customer_id)

    customers = list(db.scalars(select(Customer).order_by(Customer.id.desc())).all())
    return [item for item in customers if item.document_number in allowed_documents or item.id in analysis_customer_ids]


@router.get("/{customer_id}", response_model=CustomerRead)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.dossier.view"])),
) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found.",
        )
    if user_has_all_bu_scope(current):
        return customer

    allowed_bu_names = get_user_allowed_business_units(db, current)
    if not allowed_bu_names:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Customer out of allowed BU scope.")

    customer_bu = db.scalar(
        select(ArAgingDataTotalRow.bu_normalized)
        .where(
            ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
            ArAgingDataTotalRow.bu_normalized.is_not(None),
        )
        .limit(1)
    )
    if bu_name_in_scope(allowed_bu_names, customer_bu, has_all_scope=False):
        return customer

    analyses = db.scalars(select(CreditAnalysis).where(CreditAnalysis.customer_id == customer.id)).all()
    for analysis in analyses:
        if bu_name_in_scope(allowed_bu_names, resolve_analysis_business_unit(db, analysis), has_all_scope=False):
            return customer
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Customer out of allowed BU scope.")
