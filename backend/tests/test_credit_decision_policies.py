from __future__ import annotations

from decimal import Decimal
import unittest
import uuid

from sqlalchemy import func, inspect, select, text

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import ensure_active_credit_decision_policy_seed_if_enabled
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.enums import MotorResult
from app.models.user import User
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_policy_service import (
    CreditDecisionPolicyValidationError,
    activate_credit_decision_policy,
    archive_credit_decision_policy,
    create_credit_decision_policy,
    get_active_credit_decision_policy,
    get_credit_decision_policy,
    list_credit_decision_policies,
)
from app.services.recommendation import classify_recommendation


def _valid_config() -> dict:
    return {
        "decision_scenarios": {
            "existing_customer_with_coface": {
                "enabled": True,
                "requires_financial_calculation": False,
                "rules": [
                    {
                        "code": "coface_equals_current_limit",
                        "condition": "coface_limit == current_limit",
                        "recommendation_code": "maintain_current_limit",
                        "recommended_limit_source": "current_limit",
                        "label": "Manutencao do Limite Atual",
                    },
                    {
                        "code": "coface_below_current_limit",
                        "condition": "coface_limit < current_limit",
                        "recommendation_code": "reduce_to_coface_limit",
                        "recommended_limit_source": "coface_limit",
                        "label": "Reducao de Limite devido Exposicao com a COFACE",
                    },
                    {
                        "code": "requested_above_coface",
                        "condition": "coface_limit > current_limit && requested_limit > coface_limit",
                        "recommendation_code": "increase_to_coface_limit",
                        "recommended_limit_source": "coface_limit",
                        "label": "Aumento do Limite conforme Cobertura da COFACE",
                    },
                    {
                        "code": "requested_within_coface",
                        "condition": "coface_limit > current_limit && requested_limit <= coface_limit",
                        "recommendation_code": "approve_requested_with_coface",
                        "recommended_limit_source": "requested_limit",
                        "label": "Aprovacao do Limite Solicitado conforme Cobertura da COFACE",
                    },
                ],
            }
        },
        "pillar_weights": {
            "financial_stability_liquidity": 55,
            "guarantees_credit_insurance": 20,
            "market_conditions": 15,
            "payment_history": 5,
            "relationship_history": 5,
        },
    }


class CreditDecisionPoliciesTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            inspector = inspect(bind)
            if not inspector.has_table("credit_decision_policies"):
                CreditDecisionPolicy.__table__.create(bind, checkfirst=True)
            columns = {column["name"] for column in inspect(bind).get_columns("credit_decision_policies")}
            if "base_policy_id" not in columns:
                db.execute(text("ALTER TABLE credit_decision_policies ADD COLUMN base_policy_id INTEGER"))
                db.commit()

            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is not None:
                active = db.scalar(
                    select(CreditDecisionPolicy)
                    .where(CreditDecisionPolicy.status == "active")
                    .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
                )
                if active is None:
                    user = db.get(User, cls.seed_user_id)
                    payload = CreditDecisionPolicyCreate(
                        code="coface_first",
                        name="Politica Padrao COFACE-first",
                        description="Seed de testes para politica ativa.",
                        config_json=_valid_config(),
                    )
                    created = create_credit_decision_policy(db, payload, user)
                    activate_credit_decision_policy(db, created.id, user)
                    db.commit()
        if cls.seed_user_id is None:
            raise unittest.SkipTest("No user found for credit decision policy tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.current_user = self.db.get(User, self.seed_user_id)
        self.assertIsNotNone(self.current_user)
        self.code_prefix = f"test_policy_{uuid.uuid4().hex[:8]}"

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _create_draft(self, *, suffix: str, config: dict | None = None) -> CreditDecisionPolicy:
        payload = CreditDecisionPolicyCreate(
            code=f"{self.code_prefix}_{suffix}",
            name=f"Policy {suffix}",
            description="policy test",
            config_json=config or _valid_config(),
        )
        return create_credit_decision_policy(self.db, payload, self.current_user)

    def test_seed_default_exists_and_active(self) -> None:
        active = get_active_credit_decision_policy(self.db)
        self.assertEqual(active.status, "active")

    def test_list_policies(self) -> None:
        items = list_credit_decision_policies(self.db)
        self.assertGreaterEqual(len(items), 1)

    def test_get_active_policy(self) -> None:
        active = get_active_credit_decision_policy(self.db)
        fetched = get_credit_decision_policy(self.db, active.id)
        self.assertEqual(fetched.id, active.id)

    def test_create_valid_draft(self) -> None:
        created = self._create_draft(suffix="a")
        self.assertEqual(created.status, "draft")
        self.assertEqual(created.version, 1)

    def test_reject_invalid_weights(self) -> None:
        config = _valid_config()
        config["pillar_weights"]["relationship_history"] = 6
        with self.assertRaises(CreditDecisionPolicyValidationError):
            self._create_draft(suffix="bad_weights", config=config)

    def test_reject_missing_required_scenario(self) -> None:
        config = _valid_config()
        config["decision_scenarios"].pop("existing_customer_with_coface")
        with self.assertRaises(CreditDecisionPolicyValidationError):
            self._create_draft(suffix="bad_scenario", config=config)

    def test_activate_draft_archives_previous_active_and_keeps_single_active(self) -> None:
        current_active = get_active_credit_decision_policy(self.db)
        draft = self._create_draft(suffix="activate")
        activated = activate_credit_decision_policy(self.db, draft.id, self.current_user)
        self.assertEqual(activated.status, "active")

        active_count = self.db.scalar(
            select(func.count(CreditDecisionPolicy.id)).where(CreditDecisionPolicy.status == "active")
        )
        self.assertEqual(active_count, 1)

        previous = self.db.get(CreditDecisionPolicy, current_active.id)
        self.assertEqual(previous.status, "archived")

    def test_archive_policy_idempotent(self) -> None:
        draft = self._create_draft(suffix="archive")
        first = archive_credit_decision_policy(self.db, draft.id, self.current_user)
        second = archive_credit_decision_policy(self.db, draft.id, self.current_user)
        self.assertEqual(first.status, "archived")
        self.assertEqual(second.status, "archived")

    def test_feature_flag_default_false(self) -> None:
        self.assertFalse(settings.credit_decision_policy_engine_enabled)

    def test_decision_policy_seed_flag_default_true(self) -> None:
        self.assertTrue(settings.credit_decision_policy_seed_enabled)

    def test_seed_flag_false_does_not_bootstrap_active_policy(self) -> None:
        active_policies = self.db.scalars(
            select(CreditDecisionPolicy).where(CreditDecisionPolicy.status == "active")
        ).all()
        for policy in active_policies:
            policy.status = "archived"
        before_total = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))
        self.db.flush()

        ensure_active_credit_decision_policy_seed_if_enabled(self.db, enabled=False)
        self.db.flush()

        active_count = self.db.scalar(select(func.count(CreditDecisionPolicy.id)).where(CreditDecisionPolicy.status == "active"))
        after_total = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))
        self.assertEqual(active_count, 0)
        self.assertEqual(after_total, before_total)

    def test_seed_flag_true_does_not_create_new_version_when_active_exists(self) -> None:
        active_before = get_active_credit_decision_policy(self.db)
        total_before = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))

        ensure_active_credit_decision_policy_seed_if_enabled(self.db, enabled=True)
        self.db.flush()

        active_after = get_active_credit_decision_policy(self.db)
        total_after = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))
        self.assertEqual(active_after.id, active_before.id)
        self.assertEqual(total_after, total_before)

    def test_seed_flag_true_creates_single_active_when_missing(self) -> None:
        active_policies = self.db.scalars(
            select(CreditDecisionPolicy).where(CreditDecisionPolicy.status == "active")
        ).all()
        for policy in active_policies:
            policy.status = "archived"
        before_total = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))
        self.db.flush()

        ensure_active_credit_decision_policy_seed_if_enabled(self.db, enabled=True)
        self.db.flush()

        active_policies_after = self.db.scalars(
            select(CreditDecisionPolicy).where(CreditDecisionPolicy.status == "active")
        ).all()
        after_total = self.db.scalar(select(func.count(CreditDecisionPolicy.id)))
        self.assertEqual(len(active_policies_after), 1)
        self.assertEqual(after_total, before_total + 1)

    def test_motor_current_behavior_unchanged(self) -> None:
        classification = classify_recommendation(
            requested_limit=Decimal("1000"),
            engine_recommended_limit=Decimal("700"),
            coface_coverage_limit=Decimal("700"),
            current_approved_limit=Decimal("900"),
            is_existing_customer=True,
            motor_result=MotorResult.APPROVED,
        )
        self.assertEqual(classification["code"], "reduction")


if __name__ == "__main__":
    unittest.main()
