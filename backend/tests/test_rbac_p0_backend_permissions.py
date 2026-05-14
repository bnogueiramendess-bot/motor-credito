from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.core.security import CurrentUser, require_permissions
from app.services.bootstrap_admin import ROLE_MATRIX
from app.services.permission_catalog import PROFILE_PERMISSION_CATALOG
from app.models.user import User


class P0BackendRbacEnforcementTestCase(unittest.TestCase):
    def _build_current_user(self, permissions: set[str]) -> CurrentUser:
        user = User(
            id=991,
            company_id=1,
            role_id=1,
            user_code="USR-0991",
            username="rbac.p0",
            full_name="RBAC P0",
            email="rbac.p0@indorama.com",
            phone=None,
            password_hash="x",
            is_active=True,
            must_change_password=False,
        )
        return CurrentUser(user=user, permissions=permissions, bu_ids=set())

    def test_credit_policy_requires_view_and_manage(self) -> None:
        current_without_view = self._build_current_user({"credit.request.create"})
        with self.assertRaises(HTTPException) as blocked_view:
            require_permissions(["credit.policy.view"])(current=current_without_view)
        self.assertEqual(blocked_view.exception.status_code, 403)

        current_view_only = self._build_current_user({"credit.policy.view"})
        require_permissions(["credit.policy.view"])(current=current_view_only)
        with self.assertRaises(HTTPException) as blocked_manage:
            require_permissions(["credit.policy.manage"])(current=current_view_only)
        self.assertEqual(blocked_manage.exception.status_code, 403)

        current_manage = self._build_current_user({"credit.policy.manage"})
        require_permissions(["credit.policy.manage"])(current=current_manage)

    def test_credit_report_reads_requires_credit_dossier_edit(self) -> None:
        current_without_permission = self._build_current_user({"credit.requests.view"})
        with self.assertRaises(HTTPException) as blocked:
            require_permissions(["credit.dossier.edit"])(current=current_without_permission)
        self.assertEqual(blocked.exception.status_code, 403)

        current_with_permission = self._build_current_user({"credit.dossier.edit"})
        require_permissions(["credit.dossier.edit"])(current=current_with_permission)

    def test_portfolio_requires_view_and_evolution_permission(self) -> None:
        current_without_permissions = self._build_current_user({"clients.dashboard.view"})
        with self.assertRaises(HTTPException) as blocked_portfolio:
            require_permissions(["clients.portfolio.view"])(current=current_without_permissions)
        self.assertEqual(blocked_portfolio.exception.status_code, 403)

        current_with_portfolio = self._build_current_user({"clients.portfolio.view"})
        require_permissions(["clients.portfolio.view"])(current=current_with_portfolio)
        with self.assertRaises(HTTPException) as blocked_evolution:
            require_permissions(["clients.portfolio.evolution.view"])(current=current_with_portfolio)
        self.assertEqual(blocked_evolution.exception.status_code, 403)

        current_with_evolution = self._build_current_user({"clients.portfolio.evolution.view"})
        require_permissions(["clients.portfolio.evolution.view"])(current=current_with_evolution)

    def test_customers_requires_create_list_and_detail_permissions(self) -> None:
        current_without_create = self._build_current_user({"clients.portfolio.view"})
        with self.assertRaises(HTTPException) as blocked_create:
            require_permissions(["credit.request.create"])(current=current_without_create)
        self.assertEqual(blocked_create.exception.status_code, 403)

        current_create = self._build_current_user({"credit.request.create"})
        require_permissions(["credit.request.create"])(current=current_create)

        current_without_detail = self._build_current_user({"clients.portfolio.view"})
        with self.assertRaises(HTTPException) as blocked_detail:
            require_permissions(["clients.dossier.view"])(current=current_without_detail)
        self.assertEqual(blocked_detail.exception.status_code, 403)

        current_detail = self._build_current_user({"clients.dossier.view"})
        require_permissions(["clients.dossier.view"])(current=current_detail)

    def test_master_admin_permission_set_continues_with_access(self) -> None:
        master_like_permissions = {
            "credit.policy.view",
            "credit.policy.manage",
            "credit.dossier.edit",
            "clients.portfolio.view",
            "clients.portfolio.evolution.view",
            "credit.request.create",
            "clients.dossier.view",
        }
        current = self._build_current_user(master_like_permissions)
        require_permissions(["credit.policy.view"])(current=current)
        require_permissions(["credit.policy.manage"])(current=current)
        require_permissions(["credit.dossier.edit"])(current=current)
        require_permissions(["clients.portfolio.view"])(current=current)
        require_permissions(["clients.portfolio.evolution.view"])(current=current)
        require_permissions(["credit.request.create"])(current=current)
        require_permissions(["clients.dossier.view"])(current=current)

    def test_import_history_requires_specific_view_permission(self) -> None:
        current_without_history = self._build_current_user({"clients.dashboard.view"})
        with self.assertRaises(HTTPException) as blocked_history:
            require_permissions(["clients.imports.history.view"])(current=current_without_history)
        self.assertEqual(blocked_history.exception.status_code, 403)

        current_with_history = self._build_current_user({"clients.imports.history.view"})
        require_permissions(["clients.imports.history.view"])(current=current_with_history)

    def test_admin_users_list_requires_users_view(self) -> None:
        current_without_users_view = self._build_current_user({"users:manage"})
        with self.assertRaises(HTTPException) as blocked_users:
            require_permissions(["users:view"])(current=current_without_users_view)
        self.assertEqual(blocked_users.exception.status_code, 403)

        current_with_users_view = self._build_current_user({"users:view"})
        require_permissions(["users:view"])(current=current_with_users_view)

    def test_master_seed_role_matrix_matches_catalog(self) -> None:
        master_permissions = set(ROLE_MATRIX["administrador_master"])
        catalog_permissions = set(PROFILE_PERMISSION_CATALOG.keys())
        self.assertSetEqual(master_permissions, catalog_permissions)


if __name__ == "__main__":
    unittest.main()
