from __future__ import annotations

import unittest
import uuid

from sqlalchemy import delete

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.routes.auth import me_business_units_context
from app.services.security import hash_password


class AuthBusinessUnitContextTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created: dict[str, list[int]] = {k: [] for k in ["companies", "bus", "permissions", "roles", "role_permissions", "users", "scopes"]}

    def tearDown(self) -> None:
        with SessionLocal() as db:
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

    def _make_user(self, permissions: list[str], scope_bus: list[str]) -> CurrentUser:
        with SessionLocal() as db:
            company = Company(name=f"Empresa {uuid.uuid4().hex[:6]}", legal_name="Empresa LTDA", trade_name="Empresa", cnpj=None, allowed_domain="indorama.com", allowed_domains_json=["indorama.com"], corporate_email_required=False, is_active=True)
            db.add(company)
            db.flush()
            self.created["companies"].append(company.id)

            bus = []
            for idx, name in enumerate(["Additive", "Fertilizer", "Additive Intl"], start=1):
                bu = BusinessUnit(company_id=company.id, code=f"BU{idx:02d}", name=name, head_name="Head", head_email="head@indorama.com", is_active=True)
                db.add(bu)
                db.flush()
                self.created["bus"].append(bu.id)
                bus.append(bu)

            role = Role(company_id=company.id, code=f"R-{uuid.uuid4().hex[:8]}", name="Perfil", description="Perfil", is_active=True, is_system=False)
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

            user = User(company_id=company.id, role_id=role.id, user_code=f"USR-{uuid.uuid4().hex[:8]}", username="u", full_name="User", email=f"user.{uuid.uuid4().hex[:6]}@indorama.com", phone=None, password_hash=hash_password("Senha@123"), is_active=True, must_change_password=False)
            db.add(user)
            db.flush()
            self.created["users"].append(user.id)
            for bu in bus:
                if bu.name in scope_bus:
                    scope = UserBusinessUnitScope(user_id=user.id, business_unit_id=bu.id)
                    db.add(scope)
                    db.flush()
                    self.created["scopes"].append(scope.id)
            db.commit()
            db.refresh(user)
            db.expunge(user)
            return CurrentUser(user=user, permissions=set(permissions), bu_ids={scope.business_unit_id for scope in db.query(UserBusinessUnitScope).filter(UserBusinessUnitScope.user_id == user.id).all()})

    def test_multi_bu_user_receives_only_scoped_units(self) -> None:
        current = self._make_user(["credit_request_view_bu"], ["Additive", "Fertilizer"])
        with SessionLocal() as db:
            payload = me_business_units_context(current=current, db=db)
        self.assertEqual({item.name for item in payload.allowed_business_units}, {"Additive", "Fertilizer"})
        self.assertTrue(payload.can_view_consolidated)
        self.assertFalse(payload.is_global_scope)
        self.assertEqual(payload.consolidated_label, "Visao consolidada")

    def test_all_scope_user_receives_global_label(self) -> None:
        current = self._make_user(["credit_request_view_bu", "scope:all_bu"], ["Additive"])
        with SessionLocal() as db:
            payload = me_business_units_context(current=current, db=db)
        self.assertTrue(payload.is_global_scope)
        self.assertEqual(payload.consolidated_label, "Visao consolidada global")


if __name__ == "__main__":
    unittest.main()
