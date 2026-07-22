
from __future__ import annotations

import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import delete, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.approval_matrix_rule import ApprovalMatrixRule
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.role import Role
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.routes.admin import _replace_user_workflow_roles, list_user_workflow_role_options
from app.services.approval_matrix import ensure_approval_matrix_seed
from app.services.security import hash_password
from app.services.workflow_roles import ensure_workflow_roles_seed, list_user_assignable_workflow_roles


class AdminWorkflowRoleOptionsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.suffix = uuid.uuid4().hex[:8]
        self.created: dict[str, list[int]] = {"companies": [], "roles": [], "users": [], "bus": [], "rules": []}
        ensure_workflow_roles_seed(self.db)
        ensure_approval_matrix_seed(self.db)
        self.company = self._company("target")
        self.other_company = self._company("other")
        self.user = self._user(self.company.id, "admin")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.rollback()
        if any(self.created.values()):
            cleanup = SessionLocal()
            try:
                if self.created["users"]:
                    cleanup.execute(delete(UserWorkflowRole).where(UserWorkflowRole.user_id.in_(self.created["users"])))
                    cleanup.execute(delete(User).where(User.id.in_(self.created["users"])))
                if self.created["rules"]:
                    cleanup.execute(delete(ApprovalMatrixRuleRole).where(ApprovalMatrixRuleRole.approval_matrix_rule_id.in_(self.created["rules"])))
                    cleanup.execute(delete(ApprovalMatrixRule).where(ApprovalMatrixRule.id.in_(self.created["rules"])))
                if self.created["bus"]:
                    cleanup.execute(delete(BusinessUnit).where(BusinessUnit.id.in_(self.created["bus"])))
                if self.created["roles"]:
                    cleanup.execute(delete(Role).where(Role.id.in_(self.created["roles"])))
                if self.created["companies"]:
                    cleanup.execute(delete(Company).where(Company.id.in_(self.created["companies"])))
                cleanup.commit()
            finally:
                cleanup.close()
        self.db.close()

    def _company(self, label: str) -> Company:
        company = Company(
            name=f"Role Options {label} {self.suffix}",
            legal_name=f"Role Options {label} {self.suffix} LTDA",
            trade_name=f"Role Options {label} {self.suffix}",
            cnpj=None,
            allowed_domain="example.com",
            allowed_domains_json=["example.com"],
            corporate_email_required=False,
            is_active=True,
        )
        self.db.add(company)
        self.db.flush()
        self.created["companies"].append(company.id)
        return company

    def _role_profile(self, company_id: int, label: str) -> Role:
        role = Role(
            company_id=company_id,
            code=f"TEST-{self.suffix}-{label}",
            name=f"Perfil {label} {self.suffix}",
            description="Perfil de teste",
            is_active=True,
            is_system=False,
        )
        self.db.add(role)
        self.db.flush()
        self.created["roles"].append(role.id)
        return role

    def _user(self, company_id: int, label: str) -> User:
        profile = self._role_profile(company_id, label)
        user = User(
            company_id=company_id,
            role_id=profile.id,
            user_code=f"USR-{self.suffix}-{label}",
            username=f"{label}.{self.suffix}",
            full_name=f"Usuario {label}",
            email=f"{label}.{self.suffix}@example.com",
            phone="11999999999",
            password_hash=hash_password("Password123!"),
            is_active=True,
            must_change_password=False,
        )
        self.db.add(user)
        self.db.flush()
        self.created["users"].append(user.id)
        return user

    def _workflow_role(self, code: str) -> WorkflowRole:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
        self.assertIsNotNone(role)
        return role

    def _business_unit(self, company_id: int, label: str) -> BusinessUnit:
        unit = BusinessUnit(
            company_id=company_id,
            code=f"BU-{self.suffix}-{label}",
            name=f"BU {label} {self.suffix}",
            head_name="Head",
            head_email=f"head.{label}.{self.suffix}@example.com",
            is_active=True,
        )
        self.db.add(unit)
        self.db.flush()
        self.created["bus"].append(unit.id)
        return unit

    def _matrix_rule(self, *, role_code: str, company_id: int | None = None, requires_committee: bool = False) -> ApprovalMatrixRule:
        unit_id = self._business_unit(company_id, role_code).id if company_id is not None else None
        rule = ApprovalMatrixRule(
            code=f"DOA-T-{self.suffix}-{len(self.created['rules'])}",
            name=f"Regra {role_code}",
            description="Regra de teste",
            is_active=True,
            min_amount=Decimal("0"),
            max_amount=Decimal("1000"),
            currency="BRL",
            required_approvals=1,
            requires_committee=requires_committee,
            requires_unanimous=False,
            business_unit_id=unit_id,
            priority=900 + len(self.created["rules"]),
        )
        self.db.add(rule)
        self.db.flush()
        self.db.add(ApprovalMatrixRuleRole(approval_matrix_rule_id=rule.id, workflow_role_id=self._workflow_role(role_code).id))
        self.db.flush()
        self.created["rules"].append(rule.id)
        return rule

    def test_user_role_options_endpoint_returns_canonical_assignable_doa_roles(self) -> None:
        current = CurrentUser(
            user=self.user,
            permissions={"users:view"},
            bu_ids=set(),
            is_administrator=True,
            can_import_ar_aging=False,
        )

        roles = list_user_workflow_role_options(db=self.db, current=current)
        codes = [role.code for role in roles]

        self.assertEqual(len(codes), len(set(codes)))
        self.assertIn("CREDIT_REQUESTER", codes)
        self.assertIn("CREDIT_ANALYST", codes)
        self.assertIn("CREDIT_CONSULTANT", codes)
        self.assertIn("HEAD_FINANCE", codes)
        self.assertIn("CFO", codes)
        self.assertIn("CEO", codes)
        self.assertNotIn("CREDIT_COMMITTEE", codes)
        self.assertNotIn("CREDIT_FINANCE_HEAD", codes)
        self.assertNotIn("CREDIT_COMMERCIAL_HEAD", codes)
        self.assertNotIn("CREDIT_GROUP_CFO", codes)
        self.assertNotIn("LEGAL", codes)
        self.assertNotIn("HEAD_OPERATIONS", codes)
        self.assertTrue(all(role.is_active for role in roles))

    def test_company_scoped_doa_role_does_not_leak_to_another_company(self) -> None:
        self._matrix_rule(role_code="HEAD_COMMERCIAL", company_id=self.other_company.id)

        target_codes = [role.code for role in list_user_assignable_workflow_roles(self.db, company_id=self.company.id)]
        other_codes = [role.code for role in list_user_assignable_workflow_roles(self.db, company_id=self.other_company.id)]

        self.assertNotIn("HEAD_COMMERCIAL", target_codes)
        self.assertIn("HEAD_COMMERCIAL", other_codes)

    def test_committee_route_placeholder_is_not_user_assignable(self) -> None:
        self._matrix_rule(role_code="CREDIT_COMMITTEE", requires_committee=True)

        codes = [role.code for role in list_user_assignable_workflow_roles(self.db, company_id=self.company.id)]

        self.assertNotIn("CREDIT_COMMITTEE", codes)

    def test_existing_legacy_assignment_is_saved_as_canonical_and_deduplicated(self) -> None:
        target_user = self._user(self.company.id, "approver")
        payload = [
            SimpleNamespace(code="CREDIT_FINANCE_HEAD", business_unit_id=None),
            SimpleNamespace(code="HEAD_FINANCE", business_unit_id=None),
        ]

        _replace_user_workflow_roles(
            self.db,
            company_id=self.company.id,
            target_user_id=target_user.id,
            actor_user_id=self.user.id,
            assignments=payload,
        )
        self.db.flush()

        codes = list(
            self.db.scalars(
                select(WorkflowRole.code)
                .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
                .where(UserWorkflowRole.user_id == target_user.id)
                .order_by(WorkflowRole.code.asc())
            ).all()
        )
        self.assertEqual(codes, ["HEAD_FINANCE"])

    def test_non_doa_governance_role_cannot_be_assigned_from_user_admin(self) -> None:
        target_user = self._user(self.company.id, "legal")

        with self.assertRaises(Exception):
            _replace_user_workflow_roles(
                self.db,
                company_id=self.company.id,
                target_user_id=target_user.id,
                actor_user_id=self.user.id,
                assignments=[SimpleNamespace(code="LEGAL", business_unit_id=None)],
            )
