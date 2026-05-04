from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
from unittest.mock import patch

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.services.portfolio_alerts import build_latest_portfolio_alerts


class PortfolioAlertsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def _seed_valid_run(
        self,
        *,
        base_date_value: date,
        overdue: Decimal,
        not_due: Decimal,
        aging: Decimal,
        insured: Decimal,
        with_snapshot: bool,
        probable_amount: Decimal | None = None,
        warnings: list[str] | None = None,
    ) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status="valid_with_warnings" if warnings else "valid",
                original_filename=f"{base_date_value.strftime('%d%m%Y')}-AR.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=warnings or [],
                totals_json={},
            )
            db.add(run)
            db.flush()

            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="Grupo A",
                    economic_group_normalized="grupo a",
                    overdue_amount=overdue,
                    not_due_amount=not_due,
                    aging_amount=aging,
                    insured_limit_amount=insured,
                    approved_credit_amount=Decimal("0"),
                    exposure_amount=aging,
                    raw_payload_json={},
                )
            )

            if with_snapshot:
                db.add(
                    ArAgingBodSnapshot(
                        import_run_id=run.id,
                        reference_date=base_date_value,
                        probable_amount=probable_amount,
                        possible_amount=Decimal("0"),
                        rare_amount=Decimal("0"),
                        probable_customers_count=1,
                        possible_customers_count=0,
                        rare_customers_count=0,
                        not_due_buckets_json=[],
                        overdue_buckets_json=[],
                        totals_json={},
                        raw_bod_json={},
                        warnings_json=[],
                    )
                )

            db.commit()
            db.refresh(run)
            self.created_import_run_ids.append(run.id)
            return run.id

    def test_should_generate_critical_overdue_alert(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("400"),
            not_due=Decimal("100"),
            aging=Decimal("500"),
            insured=Decimal("500"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        alerts = payload["alerts"]
        self.assertTrue(any(alert["id"] == "overdue-critical" for alert in alerts))

    def test_should_generate_warning_overdue_alert(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("80"),
            not_due=Decimal("320"),
            aging=Decimal("400"),
            insured=Decimal("400"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        alerts = payload["alerts"]
        self.assertTrue(any(alert["id"] == "overdue-warning" for alert in alerts))

    def test_should_generate_uncovered_exposure_alert(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("120"),
            not_due=Decimal("180"),
            aging=Decimal("300"),
            insured=Decimal("100"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        alerts = payload["alerts"]
        self.assertTrue(any(alert["id"] == "uncovered-exposure-warning" for alert in alerts))

    def test_should_not_generate_probable_risk_alert_when_bod_snapshot_missing(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("120"),
            not_due=Decimal("180"),
            aging=Decimal("300"),
            insured=Decimal("300"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        alerts = payload["alerts"]
        self.assertFalse(any(alert["id"] == "probable-risk-critical" for alert in alerts))

    def test_should_return_empty_alerts_for_balanced_base_without_warnings(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("10"),
            not_due=Decimal("190"),
            aging=Decimal("200"),
            insured=Decimal("200"),
            with_snapshot=True,
            probable_amount=Decimal("0"),
            warnings=[],
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["alerts"], [])

    def test_should_include_up_delta_when_overdue_worsens(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 26),
            overdue=Decimal("40"),
            not_due=Decimal("160"),
            aging=Decimal("200"),
            insured=Decimal("200"),
            with_snapshot=False,
        )
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("80"),
            not_due=Decimal("120"),
            aging=Decimal("200"),
            insured=Decimal("200"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        overdue_alert = next(alert for alert in payload["alerts"] if alert["metric"] == "overdue_ratio_percent")
        self.assertIn("delta", overdue_alert)
        self.assertEqual(overdue_alert["delta"]["direction"], "up")

    def test_should_include_down_delta_when_uncovered_reduces(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 26),
            overdue=Decimal("60"),
            not_due=Decimal("140"),
            aging=Decimal("200"),
            insured=Decimal("80"),
            with_snapshot=False,
        )
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("60"),
            not_due=Decimal("140"),
            aging=Decimal("200"),
            insured=Decimal("150"),
            with_snapshot=False,
        )
        with SessionLocal() as db:
            payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        uncovered_alert = next(alert for alert in payload["alerts"] if alert["metric"] == "uncovered_exposure_amount")
        self.assertIn("delta", uncovered_alert)
        self.assertEqual(uncovered_alert["delta"]["direction"], "down")

    def test_should_not_include_delta_without_previous_valid_base(self) -> None:
        self._seed_valid_run(
            base_date_value=date(2025, 4, 27),
            overdue=Decimal("80"),
            not_due=Decimal("120"),
            aging=Decimal("200"),
            insured=Decimal("100"),
            with_snapshot=False,
        )
        with patch("app.services.portfolio_alerts._previous_valid_import_run", return_value=None):
            with SessionLocal() as db:
                payload = build_latest_portfolio_alerts(db)

        self.assertIsNotNone(payload)
        for alert in payload["alerts"]:
            self.assertNotIn("delta", alert)


if __name__ == "__main__":
    unittest.main()
