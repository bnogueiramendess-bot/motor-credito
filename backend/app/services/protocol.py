from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_analysis import CreditAnalysis


def generate_protocol_number(db: Session) -> str:
    while True:
        protocol_number = f"CA-{uuid4().hex[:12].upper()}"
        existing = db.scalar(
            select(CreditAnalysis.id).where(CreditAnalysis.protocol_number == protocol_number)
        )
        if existing is None:
            return protocol_number
