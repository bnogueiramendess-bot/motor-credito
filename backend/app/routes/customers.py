from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, require_permissions
from app.db.session import get_db
from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerRead

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
    _: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> list[Customer]:
    return list(db.scalars(select(Customer).order_by(Customer.id.desc())).all())


@router.get("/{customer_id}", response_model=CustomerRead)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["clients.dossier.view"])),
) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found.",
        )
    return customer
