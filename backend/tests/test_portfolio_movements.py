from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
from unittest.mock import patch

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.services.portfolio_movements import build_latest_portfolio_movements


class PortfolioMovementsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_ids)))
            db.commit()

    def _seed_run(self, *, base_date_value: date, cnpj: str, customer_name: str, overdue: Decimal, open_amount: Decimal) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status="valid",
                original_filename=f"{base_date_value.strftime('%d%m%Y')}.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=100,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()

            db.add(
                ArAgingDataTotalRow(
                    import_run_id=run.id,
                    row_number=1,
                    cnpj_raw=cnpj,
                    cnpj_normalized=cnpj,
                    customer_name=customer_name,
                    bu_raw="ADITIVOS",
                    bu_normalized="ADITIVOS",
                    economic_group_raw="Grupo A",
                    economic_group_normalized="grupo a",
                    open_amount=open_amount,
                    due_amount=max(open_amount - overdue, Decimal("0")),
                    overdue_amount=overdue,
                    aging_label="90+",
                    raw_payload_json={},
                )
            )
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="Grupo A",
                    economic_group_normalized="grupo a",
                    overdue_amount=overdue,
                    not_due_amount=max(open_amount - overdue, Decimal("0")),
                    aging_amount=open_amount,
                    insured_limit_amount=open_amount - Decimal("10000"),
                    approved_credit_amount=Decimal("0"),
                    exposure_amount=open_amount,
                    raw_payload_json={},
                )
            )
            db.commit()
            self.created_ids.append(run.id)
            return run.id

    def test_should_return_empty_when_no_previous_base(self) -> None:
        self._seed_run(
            base_date_value=date(2025, 4, 27),
            cnpj="11111111000111",
            customer_name="Cliente A",
            overdue=Decimal("200000"),
            open_amount=Decimal("500000"),
        )
        with patch("app.services.portfolio_movements._previous_valid_import_run", return_value=None):
            with SessionLocal() as db:
                payload = build_latest_portfolio_movements(db)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["movements"], [])
        self.assertEqual(payload["message"], "Não há base anterior para comparação.")

    def test_should_capture_overdue_increase_and_decrease(self) -> None:
        self._seed_run(
            base_date_value=date(2025, 4, 26),
            cnpj="11111111000111",
            customer_name="Cliente A",
            overdue=Decimal("200000"),
            open_amount=Decimal("500000"),
        )
        self._seed_run(
            base_date_value=date(2025, 4, 27),
            cnpj="11111111000111",
            customer_name="Cliente A",
            overdue=Decimal("260000"),
            open_amount=Decimal("500000"),
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_movements(db)
        self.assertIsNotNone(payload)
        self.assertTrue(any(m["metric"] == "overdue_amount" and m["delta"] > 0 for m in payload["movements"]))

    def test_should_rank_largest_deterioration_first(self) -> None:
        self._seed_run(base_date_value=date(2025, 4, 26), cnpj="11111111000111", customer_name="Cliente A", overdue=Decimal("100000"), open_amount=Decimal("500000"))
        self._seed_run(base_date_value=date(2025, 4, 27), cnpj="11111111000111", customer_name="Cliente A", overdue=Decimal("500000"), open_amount=Decimal("700000"))
        self._seed_run(base_date_value=date(2025, 4, 26), cnpj="22222222000122", customer_name="Cliente B", overdue=Decimal("120000"), open_amount=Decimal("500000"))
        self._seed_run(base_date_value=date(2025, 4, 27), cnpj="22222222000122", customer_name="Cliente B", overdue=Decimal("200000"), open_amount=Decimal("550000"))
        with SessionLocal() as db:
            payload = build_latest_portfolio_movements(db)
        self.assertIsNotNone(payload)
        if payload["movements"]:
            first = payload["movements"][0]
            self.assertEqual(first["metric"], "overdue_amount")

    def test_should_ignore_small_variation(self) -> None:
        self._seed_run(base_date_value=date(2025, 4, 26), cnpj="11111111000111", customer_name="Cliente A", overdue=Decimal("100000"), open_amount=Decimal("500000"))
        self._seed_run(base_date_value=date(2025, 4, 27), cnpj="11111111000111", customer_name="Cliente A", overdue=Decimal("100500"), open_amount=Decimal("500500"))
        with SessionLocal() as db:
            payload = build_latest_portfolio_movements(db)
        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["movements"]), 0)


if __name__ == "__main__":
    unittest.main()
