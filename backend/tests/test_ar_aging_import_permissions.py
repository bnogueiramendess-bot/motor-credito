from __future__ import annotations

from datetime import date, datetime, timezone
import base64
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.core.security import CurrentUser, require_permissions
from app.db.session import SessionLocal
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.user import User
from app.routes.ar_aging_imports import create_import
from app.schemas.ar_aging_import import ArAgingImportCreate


class ArAgingImportPermissionsTestCase(unittest.TestCase):
    def _build_current_user(self, permissions: set[str]) -> CurrentUser:
        user = User(
            id=999,
            company_id=1,
            role_id=1,
            user_code="USR-0999",
            username="perm.tester",
            full_name="Perm Tester",
            email="perm.tester@indorama.com",
            phone=None,
            password_hash="x",
            is_active=True,
            must_change_password=False,
        )
        return CurrentUser(user=user, permissions=permissions, bu_ids=set())

    def test_create_import_requires_clients_aging_import_permission(self) -> None:
        current = self._build_current_user({"clients.dashboard.view"})
        with self.assertRaises(HTTPException) as ctx:
            require_permissions(["clients.aging.import"])(current=current)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_create_import_succeeds_with_clients_aging_import_permission(self) -> None:
        current = self._build_current_user({"clients.aging.import"})
        payload = ArAgingImportCreate(
            original_filename="27042025-AR.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=3,
            file_content_base64=base64.b64encode(b"abc").decode("ascii"),
        )
        fake_entry = ArAgingImportRun(
            id=1,
            base_date=date(2025, 4, 27),
            status="valid",
            original_filename="27042025-AR.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=3,
            warnings_json=[],
            totals_json={"_imported_by": "Perm Tester"},
            created_at=datetime.now(timezone.utc),
            snapshot_type="daily",
            is_month_end_closing=False,
            closing_month=None,
            closing_year=None,
            closing_label=None,
            closing_status=None,
            closing_created_at=None,
            closing_created_by=None,
        )
        require_permissions(["clients.aging.import"])(current=current)
        with patch("app.routes.ar_aging_imports.create_ar_aging_import_run", return_value=fake_entry):
            with SessionLocal() as db:
                response = create_import(payload=payload, db=db, _=current)
        self.assertEqual(response.status, "valid")
        self.assertEqual(response.imported_by, "Perm Tester")


if __name__ == "__main__":
    unittest.main()
