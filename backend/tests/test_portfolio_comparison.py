from __future__ import annotations

from datetime import date
from decimal import Decimal
import random
import unittest

from fastapi import HTTPException
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import get_portfolio_comparison


class PortfolioComparisonTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []
        self.test_year = random.randint(2080, 2099)

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def _seed_monthly_run(self, *, base_date_value: date, month: int, year: int, status: str = "valid") -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status=status,
                original_filename=f"{base_date_value.strftime('%d%m%Y')}-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
                snapshot_type="monthly_closing",
                is_month_end_closing=True,
                closing_month=month,
                closing_year=year,
                closing_label=f"Fechamento {month:02d}/{year}",
                closing_status="official",
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            self.created_import_run_ids.append(run.id)
            return run.id

    def _seed_daily_run(self, *, base_date_value: date) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status="valid",
                original_filename=f"{base_date_value.strftime('%d%m%Y')}-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
                snapshot_type="daily",
                is_month_end_closing=False,
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            self.created_import_run_ids.append(run.id)
            return run.id

    def _seed_group(
        self,
        *,
        import_run_id: int,
        group_name: str,
        cnpj: str,
        open_amount: Decimal,
        overdue_amount: Decimal,
        due_amount: Decimal,
        insured_amount: Decimal,
        exposure_amount: Decimal,
    ) -> None:
        with SessionLocal() as db:
            db.add(
                ArAgingDataTotalRow(
                    import_run_id=import_run_id,
                    row_number=1,
                    cnpj_raw=cnpj,
                    cnpj_normalized=cnpj,
                    customer_name=f"Cliente {group_name}",
                    bu_raw="Fertilizer",
                    bu_normalized="Fertilizer",
                    economic_group_raw=group_name,
                    economic_group_normalized=group_name,
                    open_amount=open_amount,
                    due_amount=due_amount,
                    overdue_amount=overdue_amount,
                    aging_label="90+",
                    raw_payload_json={},
                )
            )
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=import_run_id,
                    row_number=1,
                    economic_group_raw=group_name,
                    economic_group_normalized=group_name,
                    overdue_amount=overdue_amount,
                    not_due_amount=due_amount,
                    aging_amount=open_amount,
                    insured_limit_amount=insured_amount,
                    approved_credit_amount=Decimal("0"),
                    exposure_amount=exposure_amount,
                    raw_payload_json={},
                )
            )
            db.commit()

    def test_requires_two_non_empty_snapshots(self) -> None:
        self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_portfolio_comparison(from_snapshot_id="", to_snapshot_id=f"closing-{self.test_year}-03", db=db)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_rejects_current_snapshot(self) -> None:
        self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_portfolio_comparison(from_snapshot_id="current", to_snapshot_id=f"closing-{self.test_year}-03", db=db)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_rejects_equal_snapshots(self) -> None:
        self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_portfolio_comparison(
                    from_snapshot_id=f"closing-{self.test_year}-03",
                    to_snapshot_id=f"closing-{self.test_year}-03",
                    db=db,
                )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_returns_404_when_snapshot_not_found(self) -> None:
        self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_portfolio_comparison(
                    from_snapshot_id=f"closing-{self.test_year}-03",
                    to_snapshot_id=f"closing-{self.test_year}-04",
                    db=db,
                )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_allows_current_as_destination(self) -> None:
        self._seed_daily_run(base_date_value=date(self.test_year, 4, 30))
        self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        with SessionLocal() as db:
            response = get_portfolio_comparison(from_snapshot_id=f"closing-{self.test_year}-03", to_snapshot_id="current", db=db)
        payload = response.model_dump(mode="json")
        self.assertEqual(payload["to_snapshot"]["id"], "current")

    def test_calculates_summary_and_group_movements(self) -> None:
        from_id = self._seed_monthly_run(base_date_value=date(self.test_year, 3, 31), month=3, year=self.test_year)
        to_id = self._seed_monthly_run(base_date_value=date(self.test_year, 4, 30), month=4, year=self.test_year)

        self._seed_group(
            import_run_id=from_id,
            group_name="MOSAIC",
            cnpj="11111111000111",
            open_amount=Decimal("100"),
            overdue_amount=Decimal("40"),
            due_amount=Decimal("60"),
            insured_amount=Decimal("30"),
            exposure_amount=Decimal("70"),
        )
        self._seed_group(
            import_run_id=from_id,
            group_name="REMOVIDO",
            cnpj="22222222000111",
            open_amount=Decimal("80"),
            overdue_amount=Decimal("20"),
            due_amount=Decimal("60"),
            insured_amount=Decimal("10"),
            exposure_amount=Decimal("70"),
        )
        self._seed_group(
            import_run_id=to_id,
            group_name="MOSAIC",
            cnpj="11111111000111",
            open_amount=Decimal("220"),
            overdue_amount=Decimal("50"),
            due_amount=Decimal("170"),
            insured_amount=Decimal("80"),
            exposure_amount=Decimal("140"),
        )
        self._seed_group(
            import_run_id=to_id,
            group_name="NOVO",
            cnpj="33333333000111",
            open_amount=Decimal("90"),
            overdue_amount=Decimal("10"),
            due_amount=Decimal("80"),
            insured_amount=Decimal("20"),
            exposure_amount=Decimal("70"),
        )

        with SessionLocal() as db:
            response = get_portfolio_comparison(
                from_snapshot_id=f"closing-{self.test_year}-03",
                to_snapshot_id=f"closing-{self.test_year}-04",
                db=db,
            )
        payload = response.model_dump(mode="json")

        self.assertEqual(payload["summary"]["total_open_amount"]["from_value"], "180.00")
        self.assertEqual(payload["summary"]["total_open_amount"]["to_value"], "310.00")
        self.assertEqual(payload["summary"]["total_open_amount"]["delta"], "130.00")

        self.assertIn("waterfall", payload)
        waterfall = payload["waterfall"]
        self.assertEqual(waterfall["starting_amount"], "180.00")
        self.assertEqual(waterfall["ending_amount"], "310.00")
        self.assertEqual(waterfall["new_groups_amount"], "90.00")
        self.assertEqual(waterfall["removed_groups_amount"], "-80.00")
        self.assertEqual(waterfall["existing_growth_amount"], "120.00")
        self.assertEqual(Decimal(waterfall["existing_reduction_amount"]), Decimal("0"))
        total = (
            Decimal(waterfall["starting_amount"])
            + Decimal(waterfall["new_groups_amount"])
            + Decimal(waterfall["existing_growth_amount"])
            + Decimal(waterfall["existing_reduction_amount"])
            + Decimal(waterfall["removed_groups_amount"])
        )
        self.assertEqual(total, Decimal(waterfall["ending_amount"]))

        new_groups = [item["economic_group"] for item in payload["new_groups"]]
        removed_groups = [item["economic_group"] for item in payload["removed_groups"]]
        self.assertIn("NOVO", new_groups)
        self.assertIn("REMOVIDO", removed_groups)

        self.assertGreaterEqual(len(payload["top_increases"]), 1)
        self.assertGreaterEqual(len(payload["top_decreases"]), 1)


if __name__ == "__main__":
    unittest.main()
