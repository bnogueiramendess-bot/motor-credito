from decimal import Decimal
from pathlib import Path
import sys
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import EntryMethod, SourceType
from app.routes.credit_analyses import calculate_decision, calculate_score, create_credit_analysis, create_external_data_entry
from app.routes.credit_policy import get_active_policy, get_draft_policy, publish_policy_draft, update_policy_draft_rule
from app.routes.customers import create_customer
from app.schemas.credit_analysis import CreditAnalysisCreate
from app.schemas.credit_policy import CreditPolicyDraftRuleUpdate
from app.schemas.customer import CustomerCreate
from app.schemas.external_data import ExternalDataEntryCreate


def _get_restrictions_penalty_rule_id(policy_id: int, db) -> int:
    rule = (
        db.query(CreditPolicyRule)
        .filter(
            CreditPolicyRule.policy_id == policy_id,
            CreditPolicyRule.field == "score.penalty.restrictions",
            CreditPolicyRule.is_active.is_(True),
        )
        .first()
    )
    assert rule is not None
    return rule.id


def run() -> None:
    with SessionLocal() as db:
        active_before = get_active_policy(db)
        original_restrictions_points = active_before.score_adjustments.restrictions_points

        draft = get_draft_policy(db)
        restrictions_rule_id = _get_restrictions_penalty_rule_id(draft.policy_id, db)
        update_policy_draft_rule(
            restrictions_rule_id,
            CreditPolicyDraftRuleUpdate(value=-120, label="Penalidade por restrições ativa (smoke)"),
            db,
        )
        publish_policy_draft(db)

        active_after_publish = get_active_policy(db)
        assert active_after_publish.score_adjustments.restrictions_points == -120

        customer = create_customer(
            CustomerCreate(
                company_name="Explainability Smoke SA",
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
                requested_limit=Decimal("120000.00"),
                current_limit=Decimal("30000.00"),
                exposure_amount=Decimal("15000.00"),
                annual_revenue_estimated=Decimal("1000000.00"),
                assigned_analyst_name="Analista Explainability",
            ),
            db,
        )

        create_external_data_entry(
            analysis.id,
            ExternalDataEntryCreate(
                entry_method=EntryMethod.MANUAL,
                source_type=SourceType.SERASA,
                has_restrictions=True,
                protests_count=1,
                lawsuits_count=0,
                bounced_checks_count=0,
                declared_revenue=Decimal("500000.00"),
                declared_indebtedness=Decimal("300000.00"),
                notes="Entrada para validar explicabilidade de score e decisão.",
            ),
            db,
        )

        score_response = calculate_score(analysis.id, db).score_result
        decision_response = calculate_decision(analysis.id, db).decision

        score_memory = score_response.calculation_memory_json
        decision_memory = decision_response.decision_memory_json

        score_explainability = score_memory.get("explainability")
        assert isinstance(score_explainability, dict)
        assert isinstance(score_explainability.get("rules_evaluated"), list)
        assert len(score_explainability["rules_evaluated"]) > 0

        matched_values = {item.get("matched") for item in score_explainability["rules_evaluated"] if isinstance(item, dict)}
        assert True in matched_values
        assert False in matched_values

        score_policy = score_explainability.get("policy")
        assert isinstance(score_policy, dict)
        assert score_policy.get("policy_id") == active_after_publish.policy_id

        decision_explainability = decision_memory.get("explainability")
        assert isinstance(decision_explainability, dict)
        decision_summary = decision_explainability.get("decision_summary")
        assert isinstance(decision_summary, dict)
        assert isinstance(decision_summary.get("executive_reason"), str)
        assert decision_summary.get("evaluated_rules", 0) > 0

        decision_rules = decision_explainability.get("rules_evaluated")
        assert isinstance(decision_rules, list)
        assert len(decision_rules) > 0

        # Cleanup: restore previous penalty value and publish again.
        draft_restore = get_draft_policy(db)
        restore_rule_id = _get_restrictions_penalty_rule_id(draft_restore.policy_id, db)
        update_policy_draft_rule(
            restore_rule_id,
            CreditPolicyDraftRuleUpdate(value=original_restrictions_points, label="Penalidade por restrições ativa"),
            db,
        )
        publish_policy_draft(db)

        print("Explainability smoke test passed.")


if __name__ == "__main__":
    run()
