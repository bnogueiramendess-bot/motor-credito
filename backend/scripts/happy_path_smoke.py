from decimal import Decimal
from pathlib import Path
import sys
from uuid import uuid4

from sqlalchemy import select

# Allow running this script directly from the backend folder.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.credit_analysis import CreditAnalysis
from app.models.decision_event import DecisionEvent
from app.models.enums import EntryMethod, FinalDecision, SourceType
from app.routes.credit_analyses import (
    apply_analysis_final_decision,
    calculate_decision,
    calculate_score,
    create_credit_analysis,
    create_external_data_entry,
    get_analysis_final_decision,
)
from app.routes.customers import create_customer
from app.schemas.credit_analysis import CreditAnalysisCreate
from app.schemas.customer import CustomerCreate
from app.schemas.external_data import ExternalDataEntryCreate
from app.schemas.final_decision import FinalDecisionApplyRequest


def run() -> None:
    with SessionLocal() as db:
        customer = create_customer(
            CustomerCreate(
                company_name="Happy Path SA",
                document_number=f"{uuid4().int % 10**14:014d}",
                segment="servicos",
                region="sudeste",
                relationship_start_date=None,
            ),
            db,
        )

        analysis = create_credit_analysis(
            CreditAnalysisCreate(
                customer_id=customer.id,
                requested_limit=Decimal("180000.00"),
                current_limit=Decimal("45000.00"),
                exposure_amount=Decimal("15000.00"),
                annual_revenue_estimated=Decimal("1400000.00"),
                assigned_analyst_name="Analista Happy Path",
            ),
            db,
        )

        create_external_data_entry(
            analysis.id,
            ExternalDataEntryCreate(
                entry_method=EntryMethod.MANUAL,
                source_type=SourceType.SERASA,
                has_restrictions=False,
                protests_count=0,
                lawsuits_count=0,
                bounced_checks_count=0,
                declared_revenue=Decimal("2000000.00"),
                declared_indebtedness=Decimal("700000.00"),
                notes="Entrada para smoke test integrado.",
            ),
            db,
        )

        calculate_score(analysis.id, db)
        calculate_decision(analysis.id, db)
        apply_analysis_final_decision(
            analysis.id,
            FinalDecisionApplyRequest(
                final_decision=FinalDecision.APPROVED,
                analyst_name="Analista Happy Path",
                analyst_notes="Aprovacao do fluxo integrado.",
            ),
            db,
        )

        final_view = get_analysis_final_decision(analysis.id, db)
        persisted = db.get(CreditAnalysis, analysis.id)
        events = list(
            db.scalars(
                select(DecisionEvent)
                .where(DecisionEvent.credit_analysis_id == analysis.id)
                .order_by(DecisionEvent.id.asc())
            ).all()
        )

        assert final_view.final_decision == FinalDecision.APPROVED
        assert persisted is not None and persisted.analysis_status.value == "completed"
        assert persisted.completed_at is not None
        assert any(event.event_type == "score_calculated" for event in events)
        assert any(event.event_type == "decision_calculated" for event in events)
        assert any(event.event_type == "analysis_approved" for event in events)

        print("Happy-path smoke test passed.")


if __name__ == "__main__":
    run()
