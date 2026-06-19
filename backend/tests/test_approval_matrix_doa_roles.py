from __future__ import annotations

import unittest
from decimal import Decimal

from app.db.session import SessionLocal
from app.schemas.approval_matrix import ApprovalMatrixRuleWrite
from app.services.approval_matrix import create_approval_matrix_rule
from app.services.workflow_roles import ensure_workflow_roles_seed


class ApprovalMatrixDoaRolesTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            ensure_workflow_roles_seed(db)
            db.commit()

    def setUp(self) -> None:
        self.db = SessionLocal()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _payload(self, role_code: str) -> ApprovalMatrixRuleWrite:
        return ApprovalMatrixRuleWrite(
            code="DOA-TEST",
            name="Regra DOA teste",
            description=None,
            is_active=True,
            min_amount=Decimal("0"),
            max_amount=Decimal("1000"),
            currency="BRL",
            required_approvals=1,
            requires_committee=False,
            requires_unanimous=False,
            business_unit_id=None,
            priority=999,
            workflow_role_codes=[role_code],
        )

    def test_new_approval_matrix_rule_accepts_official_doa_role(self) -> None:
        rule = create_approval_matrix_rule(
            self.db,
            payload=self._payload("HEAD_FINANCE"),
            created_by_user_id=None,
        )

        self.assertEqual(rule.role_links[0].workflow_role.code, "HEAD_FINANCE")

    def test_new_approval_matrix_rule_rejects_legacy_approval_role(self) -> None:
        with self.assertRaises(ValueError):
            create_approval_matrix_rule(
                self.db,
                payload=self._payload("CREDIT_FINANCE_HEAD"),
                created_by_user_id=None,
            )
