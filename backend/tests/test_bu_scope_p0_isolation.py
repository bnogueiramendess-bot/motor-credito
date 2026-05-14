from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.routes.credit_analyses import create_credit_analysis, list_credit_analyses, list_external_data_entries
from app.routes.customers import get_customer, list_customers
from app.routes.portfolio import get_portfolio_customer, get_portfolio_group
from app.schemas.credit_analysis import CreditAnalysisCreate
from app.services.security import hash_password


class BUScopeP0IsolationTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created: dict[str, list[int]] = {
            key: []
            for key in [
                "rows",
                "group_rows",
                "runs",
                "analyses",
                "customers",
                "scopes",
                "users",
                "role_permissions",
                "roles",
                "permissions",
                "bus",
                "companies",
            ]
        }
        self.company_id: int | None = None

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created["rows"]:
                db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.id.in_(self.created["rows"])))
            if self.created["group_rows"]:
                db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.id.in_(self.created["group_rows"])))
            if self.created["runs"]:
                db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created["runs"])))
            if self.created["analyses"]:
                db.execute(delete(CreditAnalysis).where(CreditAnalysis.id.in_(self.created["analyses"])))
            if self.created["customers"]:
                db.execute(delete(Customer).where(Customer.id.in_(self.created["customers"])))
            if self.created["scopes"]:
                db.execute(delete(UserBusinessUnitScope).where(UserBusinessUnitScope.id.in_(self.created["scopes"])))
            if self.created["users"]:
                db.execute(delete(User).where(User.id.in_(self.created["users"])))
            if self.created["role_permissions"]:
                db.execute(delete(RolePermission).where(RolePermission.id.in_(self.created["role_permissions"])))
            if self.created["roles"]:
                db.execute(delete(Role).where(Role.id.in_(self.created["roles"])))
            if self.created["permissions"]:
                db.execute(delete(Permission).where(Permission.id.in_(self.created["permissions"])))
            if self.created["bus"]:
                db.execute(delete(BusinessUnit).where(BusinessUnit.id.in_(self.created["bus"])))
            if self.created["companies"]:
                db.execute(delete(Company).where(Company.id.in_(self.created["companies"])))
            db.commit()

    def _setup_base(self) -> tuple[int, int, int]:
        with SessionLocal() as db:
            suffix = uuid.uuid4().hex[:8]
            company = Company(
                name=f"Empresa BU {suffix}",
                legal_name=f"Empresa BU {suffix} LTDA",
                trade_name=f"Empresa BU {suffix}",
                cnpj=None,
                allowed_domain="indorama.com",
                allowed_domains_json=["indorama.com"],
                corporate_email_required=False,
                is_active=True,
            )
            db.add(company)
            db.flush()
            self.created["companies"].append(company.id)
            self.company_id = company.id

            bu_a = BusinessUnit(company_id=company.id, code="BU01", name="Fertilizer", head_name="Head", head_email="head@indorama.com", is_active=True)
            bu_b = BusinessUnit(company_id=company.id, code="BU02", name="Additive", head_name="Head", head_email="head@indorama.com", is_active=True)
            db.add_all([bu_a, bu_b])
            db.flush()
            self.created["bus"].extend([bu_a.id, bu_b.id])

            run = ArAgingImportRun(
                base_date=date(2026, 5, 9),
                status="valid",
                original_filename="base.xlsx",
                mime_type="application/xlsx",
                file_size=100,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()
            self.created["runs"].append(run.id)
            db.commit()
            return bu_a.id, bu_b.id, run.id

    def _create_user(self, email: str, permissions: list[str], bu_ids: list[int]) -> CurrentUser:
        assert self.company_id is not None
        with SessionLocal() as db:
            role = Role(
                company_id=self.company_id,
                code=f"PERF-{uuid.uuid4().hex[:8]}",
                name=f"perfil_{uuid.uuid4().hex[:6]}",
                description="perfil",
                is_active=True,
                is_system=False,
            )
            db.add(role)
            db.flush()
            self.created["roles"].append(role.id)
            for key in permissions:
                perm = db.scalar(select(Permission).where(Permission.key == key))
                if perm is None:
                    perm = Permission(key=key, description=key)
                    db.add(perm)
                    db.flush()
                    self.created["permissions"].append(perm.id)
                rp = RolePermission(role_id=role.id, permission_id=perm.id)
                db.add(rp)
                db.flush()
                self.created["role_permissions"].append(rp.id)

            user = User(
                company_id=self.company_id,
                role_id=role.id,
                user_code=f"USR-{uuid.uuid4().hex[:8]}",
                username=email.split("@")[0],
                full_name=email,
                email=email,
                phone=None,
                password_hash=hash_password("Senha@123"),
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.flush()
            self.created["users"].append(user.id)
            for bu_id in bu_ids:
                scope = UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id)
                db.add(scope)
                db.flush()
                self.created["scopes"].append(scope.id)
            db.commit()
            db.refresh(user)
            db.expunge(user)
            return CurrentUser(user=user, permissions=set(permissions), bu_ids=set(bu_ids))

    def _add_customer_with_rows(self, run_id: int, document: str, group_name: str, bu_name: str, open_amount: Decimal) -> int:
        with SessionLocal() as db:
            customer = Customer(
                company_name=f"Cliente {document}",
                document_number=document,
                segment="ind",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)

            row = ArAgingDataTotalRow(
                import_run_id=run_id,
                row_number=len(self.created["rows"]) + 1,
                cnpj_raw=document,
                cnpj_normalized=document,
                customer_name=customer.company_name,
                bu_raw=bu_name,
                bu_normalized=bu_name,
                economic_group_raw=group_name,
                economic_group_normalized=group_name,
                open_amount=open_amount,
                due_amount=open_amount,
                overdue_amount=Decimal("0"),
                aging_label="0-30",
                raw_payload_json={},
            )
            db.add(row)
            db.flush()
            self.created["rows"].append(row.id)
            db.commit()
            return customer.id

    def test_portfolio_customer_detail_filters_bu_before_aggregation(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        with SessionLocal() as db:
            db.add_all(
                [
                    ArAgingDataTotalRow(
                        import_run_id=run_id,
                        row_number=1,
                        cnpj_raw="12345678000199",
                        cnpj_normalized="12345678000199",
                        customer_name="Cliente AB",
                        bu_raw="Fertilizer",
                        bu_normalized="Fertilizer",
                        economic_group_raw="GRP-AB",
                        economic_group_normalized="GRP-AB",
                        open_amount=Decimal("100"),
                        due_amount=Decimal("60"),
                        overdue_amount=Decimal("40"),
                        aging_label="0-30",
                        raw_payload_json={},
                    ),
                    ArAgingDataTotalRow(
                        import_run_id=run_id,
                        row_number=2,
                        cnpj_raw="12345678000199",
                        cnpj_normalized="12345678000199",
                        customer_name="Cliente AB",
                        bu_raw="Additive",
                        bu_normalized="Additive",
                        economic_group_raw="GRP-AB",
                        economic_group_normalized="GRP-AB",
                        open_amount=Decimal("900"),
                        due_amount=Decimal("500"),
                        overdue_amount=Decimal("400"),
                        aging_label="31-60",
                        raw_payload_json={},
                    ),
                ]
            )
            db.flush()
            self.created["rows"].extend([row.id for row in db.query(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id == run_id).all()])
            db.commit()

        user_a = self._create_user("a@indorama.com", ["clients.portfolio.view"], [bu_a_id])
        with SessionLocal() as db:
            payload = get_portfolio_customer(cnpj="12345678000199", db=db, current=user_a)
        self.assertEqual(payload.customer.bu, "Fertilizer")
        self.assertEqual(payload.customer.total_open_amount, Decimal("100"))
        self.assertEqual(payload.customer.total_overdue_amount, Decimal("40"))

    def test_portfolio_group_detail_multi_bu_does_not_leak(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        with SessionLocal() as db:
            row_a = ArAgingDataTotalRow(
                import_run_id=run_id,
                row_number=1,
                cnpj_raw="11111111000111",
                cnpj_normalized="11111111000111",
                customer_name="Cliente A",
                bu_raw="Fertilizer",
                bu_normalized="Fertilizer",
                economic_group_raw="GRP-X",
                economic_group_normalized="GRP-X",
                open_amount=Decimal("120"),
                due_amount=Decimal("100"),
                overdue_amount=Decimal("20"),
                aging_label="0-30",
                raw_payload_json={},
            )
            row_b = ArAgingDataTotalRow(
                import_run_id=run_id,
                row_number=2,
                cnpj_raw="22222222000122",
                cnpj_normalized="22222222000122",
                customer_name="Cliente B",
                bu_raw="Additive",
                bu_normalized="Additive",
                economic_group_raw="GRP-X",
                economic_group_normalized="GRP-X",
                open_amount=Decimal("880"),
                due_amount=Decimal("700"),
                overdue_amount=Decimal("180"),
                aging_label="31-60",
                raw_payload_json={},
            )
            grp_a = ArAgingGroupConsolidatedRow(
                import_run_id=run_id,
                row_number=1,
                economic_group_raw="GRP-X",
                economic_group_normalized="GRP-X",
                overdue_amount=Decimal("20"),
                not_due_amount=Decimal("100"),
                aging_amount=Decimal("120"),
                insured_limit_amount=Decimal("80"),
                approved_credit_amount=Decimal("140"),
                exposure_amount=Decimal("40"),
                raw_payload_json={"bu_original": "Fertilizer"},
            )
            grp_b = ArAgingGroupConsolidatedRow(
                import_run_id=run_id,
                row_number=2,
                economic_group_raw="GRP-X",
                economic_group_normalized="GRP-X",
                overdue_amount=Decimal("180"),
                not_due_amount=Decimal("700"),
                aging_amount=Decimal("880"),
                insured_limit_amount=Decimal("500"),
                approved_credit_amount=Decimal("900"),
                exposure_amount=Decimal("380"),
                raw_payload_json={"bu_original": "Additive"},
            )
            db.add_all([row_a, row_b, grp_a, grp_b])
            db.flush()
            self.created["rows"].extend([row_a.id, row_b.id])
            self.created["group_rows"].extend([grp_a.id, grp_b.id])
            db.commit()

        user_a = self._create_user("a2@indorama.com", ["clients.portfolio.view"], [bu_a_id])
        with SessionLocal() as db:
            payload = get_portfolio_group("GRP-X", db=db, current=user_a)
        self.assertEqual(len(payload.customers), 1)
        self.assertEqual(payload.customers[0].cnpj, "11111111000111")
        self.assertEqual(payload.group.aging_amount, Decimal("120"))

    def test_external_data_endpoint_respects_bu_scope(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        customer_id = self._add_customer_with_rows(run_id, "33333333000133", "GRP-Y", "Additive", Decimal("500"))
        with SessionLocal() as db:
            analysis = CreditAnalysis(
                customer_id=customer_id,
                protocol_number=f"PROTO-{uuid.uuid4().hex[:8]}",
                requested_limit=Decimal("10000"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("10000"),
                analysis_status="created",
                decision_memory_json={"triage_submission": {"business_unit": "Additive"}},
            )
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            analysis_id = analysis.id
            db.commit()

        user_a = self._create_user("a3@indorama.com", ["credit.analysis.execute"], [bu_a_id])
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as raised:
                list_external_data_entries(analysis_id=analysis_id, db=db, current=user_a)
        self.assertEqual(raised.exception.status_code, 403)

    def test_legacy_credit_analyses_get_and_post_respect_scope(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        customer_a_id = self._add_customer_with_rows(run_id, "44444444000144", "GRP-A", "Fertilizer", Decimal("100"))
        customer_b_id = self._add_customer_with_rows(run_id, "55555555000155", "GRP-B", "Additive", Decimal("900"))
        with SessionLocal() as db:
            analysis_a = CreditAnalysis(
                customer_id=customer_a_id,
                protocol_number=f"PROTO-{uuid.uuid4().hex[:8]}",
                requested_limit=Decimal("10000"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("10000"),
                analysis_status="created",
            )
            analysis_b = CreditAnalysis(
                customer_id=customer_b_id,
                protocol_number=f"PROTO-{uuid.uuid4().hex[:8]}",
                requested_limit=Decimal("10000"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("10000"),
                analysis_status="created",
            )
            db.add_all([analysis_a, analysis_b])
            db.flush()
            self.created["analyses"].extend([analysis_a.id, analysis_b.id])
            db.commit()

        user_a = self._create_user("a4@indorama.com", ["credit.requests.view", "credit.request.create", "credit.analysis.execute"], [bu_a_id])
        with SessionLocal() as db:
            listed = list_credit_analyses(db=db, current=user_a)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0].customer_id, customer_a_id)

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as raised:
                create_credit_analysis(
                    payload=CreditAnalysisCreate(
                        customer_id=customer_b_id,
                        requested_limit=Decimal("10000"),
                        current_limit=Decimal("0"),
                        exposure_amount=Decimal("0"),
                        annual_revenue_estimated=Decimal("0"),
                        assigned_analyst_name=None,
                    ),
                    db=db,
                    current=user_a,
                )
        self.assertEqual(raised.exception.status_code, 403)

    def test_customers_endpoint_mitigation_indirect_scope(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        customer_a_id = self._add_customer_with_rows(run_id, "66666666000166", "GRP-A", "Fertilizer", Decimal("100"))
        customer_b_id = self._add_customer_with_rows(run_id, "77777777000177", "GRP-B", "Additive", Decimal("900"))
        user_a = self._create_user("a5@indorama.com", ["clients.portfolio.view", "clients.dossier.view"], [bu_a_id])

        with SessionLocal() as db:
            listed = list_customers(db=db, current=user_a)
        listed_ids = {item.id for item in listed}
        self.assertIn(customer_a_id, listed_ids)
        self.assertNotIn(customer_b_id, listed_ids)

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as raised:
                get_customer(customer_id=customer_b_id, db=db, current=user_a)
        self.assertEqual(raised.exception.status_code, 403)

    def test_scope_all_bu_still_sees_consolidated(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base()
        self._add_customer_with_rows(run_id, "88888888000188", "GRP-A", "Fertilizer", Decimal("100"))
        self._add_customer_with_rows(run_id, "99999999000199", "GRP-B", "Additive", Decimal("900"))
        user_master = self._create_user("master@indorama.com", ["clients.portfolio.view", "scope:all_bu"], [bu_a_id])
        with SessionLocal() as db:
            payload = get_portfolio_customer(cnpj="99999999000199", db=db, current=user_master)
        self.assertEqual(payload.customer.total_open_amount, Decimal("900"))


if __name__ == "__main__":
    unittest.main()
