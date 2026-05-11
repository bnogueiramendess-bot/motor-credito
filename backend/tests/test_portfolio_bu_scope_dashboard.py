from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
import uuid

from fastapi import HTTPException
from sqlalchemy import delete

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.routes.portfolio import get_latest_aging_summary, get_portfolio_comparison
from app.services.security import hash_password


class PortfolioDashboardBUScopeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created: dict[str, list[int]] = {k: [] for k in ["rows", "group_rows", "runs", "scopes", "users", "role_permissions", "roles", "permissions", "bus", "companies"]}
        self.company_id: int | None = None

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created["rows"]:
                db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.id.in_(self.created["rows"])))
            if self.created["group_rows"]:
                db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.id.in_(self.created["group_rows"])))
            if self.created["runs"]:
                db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created["runs"])))
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

    def _setup_base(self) -> tuple[int, int, int, int]:
        unique_month = (uuid.uuid4().int % 12) + 1
        unique_year = 2035 + (uuid.uuid4().int % 10)
        with SessionLocal() as db:
            company = Company(name="Empresa Scope Dashboard", legal_name="Empresa Scope Dashboard LTDA", trade_name="Empresa Scope Dashboard", cnpj=None, allowed_domain="indorama.com", allowed_domains_json=["indorama.com"], corporate_email_required=False, is_active=True)
            db.add(company)
            db.flush()
            self.created["companies"].append(company.id)
            self.company_id = company.id

            bu_a = BusinessUnit(company_id=company.id, code="BU01", name="Fertilizer", head_name="Head", head_email="head@indorama.com", is_active=True)
            bu_b = BusinessUnit(company_id=company.id, code="BU02", name="Additive", head_name="Head", head_email="head@indorama.com", is_active=True)
            db.add_all([bu_a, bu_b])
            db.flush()
            self.created["bus"].extend([bu_a.id, bu_b.id])

            run_closing = ArAgingImportRun(
                base_date=date(unique_year, unique_month, 1),
                status="valid",
                original_filename="closing.xlsx",
                mime_type="application/xlsx",
                file_size=100,
                warnings_json=[],
                totals_json={},
                snapshot_type="monthly_closing",
                closing_month=unique_month,
                closing_year=unique_year,
                closing_status="official",
                closing_label=f"Fechamento {unique_month:02d}/{unique_year}",
            )
            run_current = ArAgingImportRun(
                base_date=date(2026, 5, 9),
                status="valid",
                original_filename="current.xlsx",
                mime_type="application/xlsx",
                file_size=100,
                warnings_json=[],
                totals_json={},
            )
            db.add_all([run_closing, run_current])
            db.flush()
            self.created["runs"].extend([run_closing.id, run_current.id])

            self._seed_run_data(db, run_closing.id, bu_a="Fertilizer", bu_b="Additive", a_open=Decimal("100"), b_open=Decimal("200"))
            self._seed_run_data(db, run_current.id, bu_a="Fertilizer", bu_b="Additive", a_open=Decimal("130"), b_open=Decimal("260"))
            db.commit()
            self.closing_snapshot_id = f"closing-{unique_year}-{unique_month:02d}"
            return bu_a.id, bu_b.id, run_closing.id, run_current.id

    def _seed_run_data(self, db: SessionLocal, run_id: int, *, bu_a: str, bu_b: str, a_open: Decimal, b_open: Decimal) -> None:
        row_a = ArAgingDataTotalRow(
            import_run_id=run_id,
            row_number=len(self.created["rows"]) + 1,
            cnpj_raw="11111111000111",
            cnpj_normalized="11111111000111",
            customer_name="Cliente A",
            bu_raw=bu_a,
            bu_normalized=bu_a,
            economic_group_raw="GRP-A",
            economic_group_normalized="GRP-A",
            open_amount=a_open,
            due_amount=Decimal("70"),
            overdue_amount=Decimal("30"),
            aging_label="0-30",
            raw_payload_json={},
        )
        row_b = ArAgingDataTotalRow(
            import_run_id=run_id,
            row_number=len(self.created["rows"]) + 2,
            cnpj_raw="22222222000122",
            cnpj_normalized="22222222000122",
            customer_name="Cliente B",
            bu_raw=bu_b,
            bu_normalized=bu_b,
            economic_group_raw="GRP-B",
            economic_group_normalized="GRP-B",
            open_amount=b_open,
            due_amount=Decimal("100"),
            overdue_amount=Decimal("160"),
            aging_label="31-60",
            raw_payload_json={},
        )
        db.add_all([row_a, row_b])
        db.flush()
        self.created["rows"].extend([row_a.id, row_b.id])

        grp_a = ArAgingGroupConsolidatedRow(
            import_run_id=run_id,
            row_number=len(self.created["group_rows"]) + 1,
            economic_group_raw="GRP-A",
            economic_group_normalized="GRP-A",
            overdue_amount=Decimal("30"),
            not_due_amount=Decimal("70"),
            aging_amount=a_open,
            insured_limit_amount=Decimal("80"),
            approved_credit_amount=Decimal("120"),
            exposure_amount=Decimal("40"),
            raw_payload_json={
                "bu_original": bu_a,
                "economic_group_original": "GRP-A",
                "not_due_bucket_1_30": "70",
                "overdue_bucket_1_30": "30",
            },
        )
        grp_b = ArAgingGroupConsolidatedRow(
            import_run_id=run_id,
            row_number=len(self.created["group_rows"]) + 2,
            economic_group_raw="GRP-B",
            economic_group_normalized="GRP-B",
            overdue_amount=Decimal("160"),
            not_due_amount=Decimal("100"),
            aging_amount=b_open,
            insured_limit_amount=Decimal("180"),
            approved_credit_amount=Decimal("250"),
            exposure_amount=Decimal("90"),
            raw_payload_json={
                "bu_original": bu_b,
                "economic_group_original": "GRP-B",
                "not_due_bucket_31_60": "100",
                "overdue_bucket_31_60": "160",
            },
        )
        db.add_all([grp_a, grp_b])
        db.flush()
        self.created["group_rows"].extend([grp_a.id, grp_b.id])

    def _create_user(self, email: str, permissions: list[str], bu_ids: list[int]) -> CurrentUser:
        assert self.company_id is not None
        with SessionLocal() as db:
            role = Role(company_id=self.company_id, code=f"PERF-{uuid.uuid4().hex[:8]}", name=f"perfil_{uuid.uuid4().hex[:6]}", description="perfil", is_active=True, is_system=False)
            db.add(role)
            db.flush()
            self.created["roles"].append(role.id)
            for key in permissions:
                perm = db.query(Permission).filter(Permission.key == key).one_or_none()
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

    def test_single_bu_user_sees_only_own_bu_totals(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_a = self._create_user("a@indorama.com", ["credit_request_view_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_a)
        self.assertEqual(response.totals["total_open_amount"], Decimal("130"))
        self.assertEqual(response.totals["total_overdue_amount"], Decimal("30"))
        self.assertEqual(response.totals["total_not_due_amount"], Decimal("70"))
        self.assertEqual(response.totals["total_insured_limit_amount"], Decimal("80"))

    def test_multi_bu_user_sees_sum_of_linked_bus(self) -> None:
        bu_a_id, bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_multi = self._create_user("multi@indorama.com", ["credit_request_view_bu"], [bu_a_id, bu_b_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_multi)
        self.assertEqual(response.totals["total_open_amount"], Decimal("390"))
        self.assertEqual(response.totals["total_insured_limit_amount"], Decimal("260"))
        self.assertEqual(response.totals["distinct_customers"], 2)

    def test_scope_all_bu_user_sees_global_totals(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_master = self._create_user("master@indorama.com", ["credit_request_view_bu", "scope:all_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_master)
        self.assertEqual(response.totals["total_open_amount"], Decimal("390"))
        self.assertEqual(response.totals["total_overdue_amount"], Decimal("190"))

    def test_buckets_respect_scope(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_a = self._create_user("a2@indorama.com", ["credit_request_view_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_a)
        not_due_buckets = response.totals["aging_buckets_by_bu"]["not_due"]
        overdue_buckets = response.totals["aging_buckets_by_bu"]["overdue"]
        flattened_bus = {entry["bu"] for bucket in not_due_buckets for entry in bucket["values"]}
        flattened_bus.update({entry["bu"] for bucket in overdue_buckets for entry in bucket["values"]})
        self.assertEqual(flattened_bus, {"Fertilizer"})
        not_due_total = sum((entry["amount"] for bucket in not_due_buckets for entry in bucket["values"]), Decimal("0"))
        overdue_total = sum((entry["amount"] for bucket in overdue_buckets for entry in bucket["values"]), Decimal("0"))
        self.assertEqual(not_due_total, Decimal("70"))
        self.assertEqual(overdue_total, Decimal("30"))

    def test_single_bu_additive_sees_only_additive_bucket_series(self) -> None:
        _bu_a_id, bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_b = self._create_user("additive@indorama.com", ["credit_request_view_bu"], [bu_b_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_b)
        not_due_buckets = response.totals["aging_buckets_by_bu"]["not_due"]
        overdue_buckets = response.totals["aging_buckets_by_bu"]["overdue"]
        flattened_bus = {entry["bu"] for bucket in not_due_buckets for entry in bucket["values"]}
        flattened_bus.update({entry["bu"] for bucket in overdue_buckets for entry in bucket["values"]})
        self.assertEqual(flattened_bus, {"Additive"})
        self.assertEqual(response.totals["total_not_due_amount"], Decimal("100"))
        self.assertEqual(response.totals["total_overdue_amount"], Decimal("160"))

    def test_multi_bu_user_sees_only_linked_bucket_series(self) -> None:
        bu_a_id, bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_multi = self._create_user("multi-buckets@indorama.com", ["credit_request_view_bu"], [bu_a_id, bu_b_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_multi)
        not_due_buckets = response.totals["aging_buckets_by_bu"]["not_due"]
        overdue_buckets = response.totals["aging_buckets_by_bu"]["overdue"]
        flattened_bus = {entry["bu"] for bucket in not_due_buckets for entry in bucket["values"]}
        flattened_bus.update({entry["bu"] for bucket in overdue_buckets for entry in bucket["values"]})
        self.assertEqual(flattened_bus, {"Fertilizer", "Additive"})

    def test_scope_all_bu_user_sees_all_bucket_series(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_master = self._create_user("master-buckets@indorama.com", ["credit_request_view_bu", "scope:all_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_master)
        not_due_buckets = response.totals["aging_buckets_by_bu"]["not_due"]
        overdue_buckets = response.totals["aging_buckets_by_bu"]["overdue"]
        flattened_bus = {entry["bu"] for bucket in not_due_buckets for entry in bucket["values"]}
        flattened_bus.update({entry["bu"] for bucket in overdue_buckets for entry in bucket["values"]})
        self.assertEqual(flattened_bus, {"Fertilizer", "Additive"})

    def test_scope_all_bu_with_specific_context_filters_totals(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_master = self._create_user("master-context@indorama.com", ["credit_request_view_bu", "scope:all_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_master, business_unit_context="Fertilizer")
        self.assertEqual(response.totals["total_open_amount"], Decimal("130"))
        self.assertEqual(response.totals["total_overdue_amount"], Decimal("30"))
        self.assertEqual(response.totals["total_not_due_amount"], Decimal("70"))

    def test_business_unit_context_consolidated_for_multi_bu(self) -> None:
        bu_a_id, bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_multi = self._create_user("ctx-multi@indorama.com", ["credit_request_view_bu"], [bu_a_id, bu_b_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_multi, business_unit_context="consolidated")
        self.assertEqual(response.totals["total_open_amount"], Decimal("390"))

    def test_business_unit_context_specific_bu(self) -> None:
        bu_a_id, bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_multi = self._create_user("ctx-specific@indorama.com", ["credit_request_view_bu"], [bu_a_id, bu_b_id])
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db, current=user_multi, business_unit_context="Fertilizer")
        self.assertEqual(response.totals["total_open_amount"], Decimal("130"))

    def test_business_unit_context_additive_intl_with_and_without_dot_are_equivalent(self) -> None:
        bu_a_id, bu_b_id, _run_closing_id, run_current_id = self._setup_base()
        with SessionLocal() as db:
            bu_intl = BusinessUnit(
                company_id=self.company_id,
                code="BU03",
                name="Additive Intl.",
                head_name="Head",
                head_email="head@indorama.com",
                is_active=True,
            )
            db.add(bu_intl)
            db.flush()
            self.created["bus"].append(bu_intl.id)
            row = ArAgingGroupConsolidatedRow(
                import_run_id=run_current_id,
                row_number=999,
                economic_group_raw="GRP-I",
                economic_group_normalized="GRP-I",
                overdue_amount=Decimal("10"),
                not_due_amount=Decimal("40"),
                aging_amount=Decimal("50"),
                insured_limit_amount=Decimal("20"),
                approved_credit_amount=Decimal("30"),
                exposure_amount=Decimal("30"),
                raw_payload_json={"bu_original": "Additive Intl.", "economic_group_original": "GRP-I", "not_due_bucket_1_30": "40", "overdue_bucket_1_30": "10"},
            )
            db.add(row)
            db.flush()
            self.created["group_rows"].append(row.id)
            db.commit()

        user_multi = self._create_user("intl@indorama.com", ["credit_request_view_bu"], [bu_a_id, bu_b_id, self.created["bus"][-1]])
        with SessionLocal() as db:
            with_dot = get_latest_aging_summary(db=db, current=user_multi, business_unit_context="Additive Intl.")
            without_dot = get_latest_aging_summary(db=db, current=user_multi, business_unit_context="Additive Intl")
        self.assertEqual(with_dot.totals["total_open_amount"], without_dot.totals["total_open_amount"])

    def test_business_unit_context_out_of_scope_returns_403(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_single = self._create_user("ctx-403@indorama.com", ["credit_request_view_bu"], [bu_a_id])
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as raised:
                get_latest_aging_summary(db=db, current=user_single, business_unit_context="Additive")
        self.assertEqual(raised.exception.status_code, 403)

    def test_comparison_waterfall_respects_scope(self) -> None:
        bu_a_id, _bu_b_id, _run_closing_id, _run_current_id = self._setup_base()
        user_a = self._create_user("a3@indorama.com", ["credit_request_view_bu"], [bu_a_id])
        with SessionLocal() as db:
            response = get_portfolio_comparison(
                from_snapshot_id=self.closing_snapshot_id,
                to_snapshot_id="current",
                db=db,
                current=user_a,
            )
        self.assertEqual(response.summary.total_open_amount.from_value, Decimal("100"))
        self.assertEqual(response.summary.total_open_amount.to_value, Decimal("130"))
        self.assertEqual(response.waterfall.ending_amount, Decimal("130"))


if __name__ == "__main__":
    unittest.main()
