from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, inspect, select, text

from app.core.security import CurrentUser, require_permissions
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.routes.credit_decision_policies import create_policy_version, delete_policy_draft
from app.schemas.credit_decision_policy import (
    CreditDecisionPolicyIndicatorPatch,
    CreditDecisionPolicyScoreRangePatch,
    CreditDecisionPolicyScoreStructurePatch,
    CreditDecisionPolicyVersionCreate,
)
from app.services.credit_decision_policy_governance_summary import build_policy_change_summary
from app.services.credit_decision_policy_score_seed import ensure_default_score_structure
from app.services.credit_decision_policy_service import (
    CreditDecisionPolicyDraftExistsError,
    CreditDecisionPolicyValidationError,
    create_credit_decision_policy_version,
    delete_credit_decision_policy_draft,
    update_credit_decision_policy_score_structure,
)


def _valid_config() -> dict:
    return {
        "decision_scenarios": {
            "existing_customer_with_coface": {
                "enabled": True,
                "requires_financial_calculation": False,
                "rules": [
                    {
                        "code": code,
                        "condition": "coface_limit == current_limit",
                        "recommendation_code": code,
                        "recommended_limit_source": "current_limit",
                        "label": code,
                    }
                    for code in (
                        "coface_equals_current_limit",
                        "coface_below_current_limit",
                        "requested_above_coface",
                        "requested_within_coface",
                    )
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


class CreditDecisionPolicyVersioningTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CreditDecisionPolicy.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyPillar.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicySubgroup.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyIndicator.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyScoreRange.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequest.__table__.create(bind, checkfirst=True)
            columns = {column["name"] for column in inspect(bind).get_columns("credit_decision_policies")}
            if "base_policy_id" not in columns:
                db.execute(text("ALTER TABLE credit_decision_policies ADD COLUMN base_policy_id INTEGER"))
                db.commit()
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("User is required for policy versioning tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.code = f"versioning_{uuid.uuid4().hex[:10]}"
        self.base_policy = CreditDecisionPolicy(
            code=self.code,
            name="Policy Versioning",
            version=1,
            status="active",
            description="Base policy",
            config_json=_valid_config(),
            effective_from=datetime.now(timezone.utc),
            activated_at=datetime.now(timezone.utc),
            created_by_user_id=self.user.id,
            updated_by_user_id=self.user.id,
            activated_by_user_id=self.user.id,
        )
        self.db.add(self.base_policy)
        self.db.flush()
        ensure_default_score_structure(self.db, self.base_policy)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _current(self, permissions: set[str] | None = None) -> CurrentUser:
        return CurrentUser(
            user=self.user,
            permissions=permissions or {"credit.policy.view", "credit.policy.manage"},
            bu_ids=set(),
            is_administrator=False,
            can_import_ar_aging=False,
        )

    def _counts(self, policy_id: int) -> dict[str, int]:
        return {
            "pillars": self.db.scalar(select(func.count(CreditDecisionPolicyPillar.id)).where(CreditDecisionPolicyPillar.policy_id == policy_id)),
            "subgroups": self.db.scalar(select(func.count(CreditDecisionPolicySubgroup.id)).where(CreditDecisionPolicySubgroup.policy_id == policy_id)),
            "indicators": self.db.scalar(select(func.count(CreditDecisionPolicyIndicator.id)).where(CreditDecisionPolicyIndicator.policy_id == policy_id)),
            "ranges": self.db.scalar(select(func.count(CreditDecisionPolicyScoreRange.id)).where(CreditDecisionPolicyScoreRange.policy_id == policy_id)),
        }

    def _create_version(self) -> CreditDecisionPolicy:
        return create_credit_decision_policy_version(
            self.db,
            base_policy_id=self.base_policy.id,
            current_user=self.user,
            justification="Criar nova versao para ajustes.",
            metadata_json={"source": "unit_test"},
        )

    def _first_indicator(self, policy_id: int) -> CreditDecisionPolicyIndicator:
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator)
            .where(CreditDecisionPolicyIndicator.policy_id == policy_id)
            .order_by(CreditDecisionPolicyIndicator.id.asc())
        )
        self.assertIsNotNone(indicator)
        assert indicator is not None
        return indicator

    def _first_score_range(self, policy_id: int) -> CreditDecisionPolicyScoreRange:
        score_range = self.db.scalar(
            select(CreditDecisionPolicyScoreRange)
            .where(CreditDecisionPolicyScoreRange.policy_id == policy_id)
            .order_by(CreditDecisionPolicyScoreRange.id.asc())
        )
        self.assertIsNotNone(score_range)
        assert score_range is not None
        return score_range

    def test_create_new_version_from_active_policy_as_draft(self) -> None:
        new_policy = self._create_version()

        self.assertEqual(new_policy.status, "draft")
        self.assertEqual(new_policy.version, self.base_policy.version + 1)
        self.assertEqual(new_policy.code, self.base_policy.code)
        self.assertEqual(new_policy.name, self.base_policy.name)
        self.assertEqual(new_policy.description, self.base_policy.description)
        self.assertEqual(new_policy.config_json, self.base_policy.config_json)
        self.assertEqual(new_policy.base_policy_id, self.base_policy.id)
        self.assertIsNone(new_policy.activated_at)
        self.assertIsNone(new_policy.activated_by_user_id)
        self.db.refresh(self.base_policy)
        self.assertEqual(self.base_policy.status, "active")

    def test_clone_copies_full_score_structure_with_new_ids(self) -> None:
        base_counts = self._counts(self.base_policy.id)
        base_pillar_ids = set(self.db.scalars(select(CreditDecisionPolicyPillar.id).where(CreditDecisionPolicyPillar.policy_id == self.base_policy.id)).all())
        base_subgroup_ids = set(self.db.scalars(select(CreditDecisionPolicySubgroup.id).where(CreditDecisionPolicySubgroup.policy_id == self.base_policy.id)).all())
        base_indicator_ids = set(self.db.scalars(select(CreditDecisionPolicyIndicator.id).where(CreditDecisionPolicyIndicator.policy_id == self.base_policy.id)).all())
        base_range_ids = set(self.db.scalars(select(CreditDecisionPolicyScoreRange.id).where(CreditDecisionPolicyScoreRange.policy_id == self.base_policy.id)).all())

        new_policy = self._create_version()
        new_counts = self._counts(new_policy.id)
        new_pillar_ids = set(self.db.scalars(select(CreditDecisionPolicyPillar.id).where(CreditDecisionPolicyPillar.policy_id == new_policy.id)).all())
        new_subgroup_ids = set(self.db.scalars(select(CreditDecisionPolicySubgroup.id).where(CreditDecisionPolicySubgroup.policy_id == new_policy.id)).all())
        new_indicator_ids = set(self.db.scalars(select(CreditDecisionPolicyIndicator.id).where(CreditDecisionPolicyIndicator.policy_id == new_policy.id)).all())
        new_range_ids = set(self.db.scalars(select(CreditDecisionPolicyScoreRange.id).where(CreditDecisionPolicyScoreRange.policy_id == new_policy.id)).all())

        self.assertEqual(new_counts, base_counts)
        self.assertFalse(base_pillar_ids & new_pillar_ids)
        self.assertFalse(base_subgroup_ids & new_subgroup_ids)
        self.assertFalse(base_indicator_ids & new_indicator_ids)
        self.assertFalse(base_range_ids & new_range_ids)

    def test_cloned_ranges_point_to_new_policy_and_new_indicators(self) -> None:
        new_policy = self._create_version()
        new_indicator_ids = set(
            self.db.scalars(select(CreditDecisionPolicyIndicator.id).where(CreditDecisionPolicyIndicator.policy_id == new_policy.id)).all()
        )
        ranges = self.db.scalars(
            select(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.policy_id == new_policy.id)
        ).all()

        self.assertGreater(len(ranges), 0)
        self.assertTrue(all(item.indicator_id in new_indicator_ids for item in ranges))
        self.assertTrue(all(item.policy_id == new_policy.id for item in ranges))

    def test_new_version_is_not_published_and_does_not_change_motor(self) -> None:
        new_policy = self._create_version()

        self.assertEqual(new_policy.status, "draft")
        self.assertIsNone(new_policy.activated_at)
        self.db.refresh(self.base_policy)
        self.assertEqual(self.base_policy.status, "active")

    def test_policy_version_created_audit_is_recorded(self) -> None:
        new_policy = self._create_version()

        audit = self.db.scalar(
            select(AuditLog).where(
                AuditLog.action == "policy_version_created",
                AuditLog.resource == "credit_decision_policy",
                AuditLog.resource_id == str(new_policy.id),
            )
        )
        self.assertIsNotNone(audit)
        assert audit is not None
        self.assertEqual(audit.metadata_json["base_policy_id"], self.base_policy.id)
        self.assertEqual(audit.metadata_json["new_policy_id"], new_policy.id)

    def test_user_without_manage_permission_receives_403(self) -> None:
        current = self._current({"credit.policy.view"})

        with self.assertRaises(HTTPException) as exc:
            require_permissions(["credit.policy.manage"])(current=current)

        self.assertEqual(exc.exception.status_code, 403)

    def test_existing_draft_for_same_code_blocks_new_version(self) -> None:
        first = self._create_version()

        with self.assertRaises(CreditDecisionPolicyDraftExistsError) as exc:
            self._create_version()

        self.assertEqual(exc.exception.existing_policy_id, first.id)

    def test_route_returns_409_with_existing_policy_id_when_draft_exists(self) -> None:
        first = self._create_version()

        with self.assertRaises(HTTPException) as exc:
            create_policy_version(
                self.base_policy.id,
                CreditDecisionPolicyVersionCreate(justification="Nova tentativa."),
                self.db,
                self._current(),
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(exc.exception.detail["existing_policy_id"], first.id)

    def test_summary_uses_base_policy_id_for_comparison(self) -> None:
        new_policy = self._create_version()
        request = CreditDecisionPolicyGovernanceRequest(
            company_id=self.user.company_id,
            policy_id=new_policy.id,
            action_type="policy_publish",
            approval_item_type="CREDIT_POLICY",
            requested_by_user_id=self.user.id,
            status="pending",
            metadata_json={},
        )
        self.db.add(request)
        self.db.flush()

        summary = build_policy_change_summary(self.db, request=request, target_policy=new_policy)

        self.assertTrue(summary["has_comparison"])
        self.assertEqual(summary["base_policy_id"], self.base_policy.id)
        self.assertEqual(summary["target_policy_id"], new_policy.id)

    def test_draft_allows_indicator_weight_update(self) -> None:
        new_policy = self._create_version()
        indicator = self._first_indicator(new_policy.id)

        update_credit_decision_policy_score_structure(
            self.db,
            new_policy.id,
            CreditDecisionPolicyScoreStructurePatch(
                indicators=[CreditDecisionPolicyIndicatorPatch(id=indicator.id, weight_percent=42)]
            ),
            self.user,
        )
        self.db.flush()
        self.db.refresh(indicator)

        self.assertEqual(str(indicator.weight_percent), "42.00")

    def test_active_blocks_score_structure_update(self) -> None:
        indicator = self._first_indicator(self.base_policy.id)

        with self.assertRaises(CreditDecisionPolicyValidationError):
            update_credit_decision_policy_score_structure(
                self.db,
                self.base_policy.id,
                CreditDecisionPolicyScoreStructurePatch(
                    indicators=[CreditDecisionPolicyIndicatorPatch(id=indicator.id, weight_percent=42)]
                ),
                self.user,
            )

    def test_archived_blocks_score_structure_update(self) -> None:
        self.base_policy.status = "archived"
        self.db.flush()
        indicator = self._first_indicator(self.base_policy.id)

        with self.assertRaises(CreditDecisionPolicyValidationError):
            update_credit_decision_policy_score_structure(
                self.db,
                self.base_policy.id,
                CreditDecisionPolicyScoreStructurePatch(
                    indicators=[CreditDecisionPolicyIndicatorPatch(id=indicator.id, weight_percent=42)]
                ),
                self.user,
            )

    def test_weight_out_of_bounds_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            CreditDecisionPolicyScoreStructurePatch(
                indicators=[CreditDecisionPolicyIndicatorPatch(id=1, weight_percent=101)]
            )

    def test_score_range_can_be_updated_in_draft(self) -> None:
        new_policy = self._create_version()
        score_range = self._first_score_range(new_policy.id)

        update_credit_decision_policy_score_structure(
            self.db,
            new_policy.id,
            CreditDecisionPolicyScoreStructurePatch(
                score_ranges=[
                    CreditDecisionPolicyScoreRangePatch(
                        id=score_range.id,
                        threshold_value="1.2500",
                        score="8.50",
                        label="Ajustada em rascunho",
                    )
                ]
            ),
            self.user,
        )
        self.db.flush()
        self.db.refresh(score_range)

        self.assertEqual(str(score_range.threshold_value), "1.2500")
        self.assertEqual(str(score_range.score), "8.50")
        self.assertEqual(score_range.label, "Ajustada em rascunho")

    def test_score_out_of_bounds_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            CreditDecisionPolicyScoreStructurePatch(
                score_ranges=[CreditDecisionPolicyScoreRangePatch(id=1, score=11)]
            )

    def test_policy_draft_updated_audit_is_recorded(self) -> None:
        new_policy = self._create_version()
        indicator = self._first_indicator(new_policy.id)

        update_credit_decision_policy_score_structure(
            self.db,
            new_policy.id,
            CreditDecisionPolicyScoreStructurePatch(
                indicators=[CreditDecisionPolicyIndicatorPatch(id=indicator.id, weight_percent=42)]
            ),
            self.user,
        )
        self.db.flush()

        audit = self.db.scalar(
            select(AuditLog).where(
                AuditLog.action == "policy_draft_updated",
                AuditLog.resource == "credit_decision_policy",
                AuditLog.resource_id == str(new_policy.id),
            )
        )

        self.assertIsNotNone(audit)
        assert audit is not None
        self.assertEqual(audit.metadata_json["policy_id"], new_policy.id)

    def test_score_structure_update_does_not_publish_or_create_governance_request(self) -> None:
        new_policy = self._create_version()
        indicator = self._first_indicator(new_policy.id)
        requests_before = self.db.scalar(select(func.count(CreditDecisionPolicyGovernanceRequest.id)))

        update_credit_decision_policy_score_structure(
            self.db,
            new_policy.id,
            CreditDecisionPolicyScoreStructurePatch(
                indicators=[CreditDecisionPolicyIndicatorPatch(id=indicator.id, weight_percent=42)]
            ),
            self.user,
        )
        self.db.flush()
        self.db.refresh(new_policy)
        self.db.refresh(self.base_policy)
        requests_after = self.db.scalar(select(func.count(CreditDecisionPolicyGovernanceRequest.id)))

        self.assertEqual(new_policy.status, "draft")
        self.assertIsNone(new_policy.activated_at)
        self.assertEqual(self.base_policy.status, "active")
        self.assertEqual(requests_after, requests_before)

    def test_delete_draft_policy_success(self) -> None:
        new_policy = self._create_version()
        policy_id = new_policy.id

        delete_credit_decision_policy_draft(self.db, policy_id, self.user)
        self.db.flush()

        self.assertIsNone(self.db.get(CreditDecisionPolicy, policy_id))

    def test_delete_draft_removes_normalized_structure(self) -> None:
        new_policy = self._create_version()
        policy_id = new_policy.id
        counts_before = self._counts(policy_id)

        delete_credit_decision_policy_draft(self.db, policy_id, self.user)
        self.db.flush()

        self.assertGreater(counts_before["pillars"], 0)
        self.assertEqual(self._counts(policy_id), {"pillars": 0, "subgroups": 0, "indicators": 0, "ranges": 0})

    def test_delete_draft_does_not_affect_active_base(self) -> None:
        new_policy = self._create_version()

        delete_credit_decision_policy_draft(self.db, new_policy.id, self.user)
        self.db.flush()
        self.db.refresh(self.base_policy)

        self.assertEqual(self.base_policy.status, "active")
        self.assertIsNotNone(self.db.get(CreditDecisionPolicy, self.base_policy.id))

    def test_delete_active_is_rejected(self) -> None:
        with self.assertRaises(CreditDecisionPolicyValidationError):
            delete_credit_decision_policy_draft(self.db, self.base_policy.id, self.user)

    def test_delete_archived_is_rejected(self) -> None:
        self.base_policy.status = "archived"
        self.db.flush()

        with self.assertRaises(CreditDecisionPolicyValidationError):
            delete_credit_decision_policy_draft(self.db, self.base_policy.id, self.user)

    def test_delete_draft_requires_manage_permission(self) -> None:
        current = self._current({"credit.policy.view"})

        with self.assertRaises(HTTPException) as exc:
            require_permissions(["credit.policy.manage"])(current=current)

        self.assertEqual(exc.exception.status_code, 403)

    def test_delete_draft_with_pending_governance_request_is_rejected(self) -> None:
        new_policy = self._create_version()
        request = CreditDecisionPolicyGovernanceRequest(
            company_id=self.user.company_id,
            policy_id=new_policy.id,
            action_type="policy_publish",
            approval_item_type="CREDIT_POLICY",
            requested_by_user_id=self.user.id,
            status="pending",
            metadata_json={},
        )
        self.db.add(request)
        self.db.flush()

        with self.assertRaises(CreditDecisionPolicyValidationError):
            delete_credit_decision_policy_draft(self.db, new_policy.id, self.user)

    def test_policy_draft_deleted_audit_is_recorded(self) -> None:
        new_policy = self._create_version()
        policy_id = new_policy.id
        policy_version = new_policy.version

        delete_credit_decision_policy_draft(self.db, policy_id, self.user)
        self.db.flush()

        audit = self.db.scalar(
            select(AuditLog).where(
                AuditLog.action == "policy_draft_deleted",
                AuditLog.resource == "credit_decision_policy",
                AuditLog.resource_id == str(policy_id),
            )
        )
        self.assertIsNotNone(audit)
        assert audit is not None
        self.assertEqual(audit.metadata_json["policy_id"], policy_id)
        self.assertEqual(audit.metadata_json["policy_version"], policy_version)
        self.assertEqual(audit.metadata_json["base_policy_id"], self.base_policy.id)

    def test_list_does_not_return_deleted_draft(self) -> None:
        new_policy = self._create_version()
        policy_id = new_policy.id

        delete_credit_decision_policy_draft(self.db, policy_id, self.user)
        self.db.flush()
        listed_ids = set(self.db.scalars(select(CreditDecisionPolicy.id)).all())

        self.assertNotIn(policy_id, listed_ids)

    def test_delete_draft_does_not_change_motor_active_policy(self) -> None:
        new_policy = self._create_version()

        delete_credit_decision_policy_draft(self.db, new_policy.id, self.user)
        self.db.flush()
        active = self.db.scalar(select(CreditDecisionPolicy).where(CreditDecisionPolicy.status == "active", CreditDecisionPolicy.code == self.code))

        self.assertIsNotNone(active)
        assert active is not None
        self.assertEqual(active.id, self.base_policy.id)

    def test_delete_route_returns_204_for_draft(self) -> None:
        new_policy = self._create_version()
        policy_id = new_policy.id

        result = delete_policy_draft(policy_id, self.db, self._current())
        self.db.flush()

        self.assertIsNone(result)
        self.assertIsNone(self.db.get(CreditDecisionPolicy, policy_id))


if __name__ == "__main__":
    unittest.main()
