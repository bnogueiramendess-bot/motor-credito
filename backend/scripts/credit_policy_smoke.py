from decimal import Decimal
from pathlib import Path
import sys
from uuid import uuid4

from sqlalchemy import select

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import EntryMethod, SourceType
from app.routes.credit_analyses import calculate_score, create_credit_analysis, create_external_data_entry
from app.routes.credit_policy import (
    create_policy_draft_rule,
    delete_policy_draft_rule,
    get_active_policy,
    get_draft_policy,
    publish_policy_draft,
    reset_policy_draft,
    update_policy_draft_rule,
)
from app.routes.customers import create_customer
from app.schemas.credit_analysis import CreditAnalysisCreate
from app.schemas.credit_policy import CreditPolicyDraftRuleCreate, CreditPolicyDraftRuleUpdate
from app.schemas.customer import CustomerCreate
from app.schemas.external_data import ExternalDataEntryCreate


def _get_restriction_rule_id(db, policy_id: int) -> int:
    rule = db.scalar(
        select(CreditPolicyRule).where(
            CreditPolicyRule.policy_id == policy_id,
            CreditPolicyRule.field == "score.penalty.restrictions",
            CreditPolicyRule.is_active.is_(True),
        )
    )
    assert rule is not None
    return rule.id


def run() -> None:
    with SessionLocal() as db:
        active_before = get_active_policy(db)
        original_restrictions_points = active_before.score_adjustments.restrictions_points

        customer = create_customer(
            CustomerCreate(
                company_name="Policy Smoke SA",
                document_number=f"{uuid4().int % 10**14:014d}",
                segment="agro",
                region="sudeste",
                relationship_start_date=None,
            ),
            db,
        )
        analysis = create_credit_analysis(
            CreditAnalysisCreate(
                customer_id=customer.id,
                requested_limit=Decimal("50000.00"),
                current_limit=Decimal("10000.00"),
                exposure_amount=Decimal("5000.00"),
                annual_revenue_estimated=Decimal("400000.00"),
                assigned_analyst_name="Analista Policy Smoke",
            ),
            db,
        )
        create_external_data_entry(
            analysis.id,
            ExternalDataEntryCreate(
                entry_method=EntryMethod.MANUAL,
                source_type=SourceType.SERASA,
                has_restrictions=True,
                protests_count=0,
                lawsuits_count=0,
                bounced_checks_count=0,
                declared_revenue=Decimal("800000.00"),
                declared_indebtedness=Decimal("0.00"),
                notes="Entrada para validar impacto da politica.",
            ),
            db,
        )

        score_before = calculate_score(analysis.id, db).score_result
        expected_before = 1000 + original_restrictions_points
        assert score_before.final_score == expected_before

        draft = get_draft_policy(db)
        restriction_rule_id = _get_restriction_rule_id(db, draft.policy_id)

        updated_rule = update_policy_draft_rule(
            restriction_rule_id,
            CreditPolicyDraftRuleUpdate(value=-100, label="Penalidade de restricao ajustada"),
            db,
        )
        assert updated_rule.value == -100

        created_rule = create_policy_draft_rule(
            CreditPolicyDraftRuleCreate(
                pillar="financialCapacity",
                field="score.penalty.debt_ratio",
                operator="gt",
                value=0.95,
                points=-200,
                label="Regra temporaria smoke",
                description="Regra criada e removida para validar CRUD.",
            ),
            db,
        )
        edited_created_rule = update_policy_draft_rule(
            created_rule.id,
            CreditPolicyDraftRuleUpdate(label="Regra temporaria smoke - editada"),
            db,
        )
        assert edited_created_rule.label.endswith("editada")
        delete_policy_draft_rule(created_rule.id, db)

        published = publish_policy_draft(db)
        assert published.policy_status == "active"
        assert published.score_adjustments.restrictions_points == -100

        score_after = calculate_score(analysis.id, db).score_result
        assert score_after.final_score == 900

        # Cleanup: restore original restriction penalty to keep environment predictable.
        draft_restore = reset_policy_draft(db)
        restore_rule_id = _get_restriction_rule_id(db, draft_restore.policy_id)
        update_policy_draft_rule(
            restore_rule_id,
            CreditPolicyDraftRuleUpdate(
                value=original_restrictions_points,
                label="Penalidade por restricao ativa",
            ),
            db,
        )
        publish_policy_draft(db)

        print("Credit policy smoke test passed.")


if __name__ == "__main__":
    run()
