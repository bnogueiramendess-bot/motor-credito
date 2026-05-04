from __future__ import annotations

import base64
from datetime import date
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_bod_customer_row import ArAgingBodCustomerRow
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.ar_aging_remark_row import ArAgingRemarkRow
from app.schemas.ar_aging_import import ArAgingImportCreate
from app.services.ar_aging_import.parser import ParsedAgingWorkbook
from app.services.ar_aging_import.upload import create_ar_aging_import_run


class ArAgingImportOperationalControlsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            snapshot_ids = db.query(ArAgingBodSnapshot.id).filter(ArAgingBodSnapshot.import_run_id.in_(self.created_import_run_ids)).all()
            flat_snapshot_ids = [item[0] for item in snapshot_ids]
            if flat_snapshot_ids:
                db.execute(delete(ArAgingBodCustomerRow).where(ArAgingBodCustomerRow.bod_snapshot_id.in_(flat_snapshot_ids)))
            db.execute(delete(ArAgingRemarkRow).where(ArAgingRemarkRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def _seed_import_run(self, *, base_date_value: date, status: str, original_filename: str) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status=status,
                original_filename=original_filename,
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=100,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            self.created_import_run_ids.append(run.id)
            return run.id

    def test_should_block_duplicate_import_when_overwrite_is_false(self) -> None:
        self._seed_import_run(base_date_value=date(2025, 4, 27), status="valid", original_filename="27042025-AR.xlsx")
        payload = ArAgingImportCreate(
            original_filename="27042025-AR.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=3,
            file_content_base64=base64.b64encode(b"abc").decode("ascii"),
            overwrite=False,
        )

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as context:
                create_ar_aging_import_run(db, payload)

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("Ja existe uma base importada para esta data", str(context.exception.detail))

    def test_should_add_warning_when_importing_older_base_date(self) -> None:
        self._seed_import_run(base_date_value=date(2025, 4, 28), status="valid", original_filename="28042025-AR.xlsx")
        payload = ArAgingImportCreate(
            original_filename="27042025-AR.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=3,
            file_content_base64=base64.b64encode(b"abc").decode("ascii"),
            overwrite=True,
            imported_by="qa_teste",
        )

        parsed = ParsedAgingWorkbook(
            base_date=date(2025, 4, 27),
            data_total_rows=[],
            consolidated_rows=[],
            remark_rows=[],
            bod_snapshot={"risk": {}, "aging_buckets": {"not_due": [], "overdue": []}, "totals": {}, "warnings": [], "raw_bod_json": {}},
            bod_customer_rows=[],
            warnings=[],
        )

        with patch("app.services.ar_aging_import.upload.parse_aging_workbook", return_value=parsed):
            with SessionLocal() as db:
                created = create_ar_aging_import_run(db, payload)
                self.created_import_run_ids.append(created.id)

        self.assertIn("Você está importando uma base mais antiga que a atual.", created.warnings_json)
        self.assertEqual(created.status, "valid_with_warnings")
        self.assertEqual(created.totals_json.get("_imported_by"), "qa_teste")


if __name__ == "__main__":
    unittest.main()
