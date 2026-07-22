from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from app.services import effective_credit_policy
from app.services.credit_decision_policy_publication import (
    validate_no_published_policy_overlap,
)
from app.services.credit_decision_policy_service import ensure_active_credit_decision_policy_seed
from app.services.credit_decision_policy_governance_workflow import PolicyGovernanceWorkflowConflictError


class DummyScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class DummyDb:
    def __init__(self, values=None):
        self.values = values or []
        self.add = Mock()
        self.flush = Mock()
        self.execute = Mock()

    def scalars(self, _statement):
        return DummyScalarResult(self.values)

    def scalar(self, _statement):
        return self.values[0] if self.values else None

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))


def _policy(
    policy_id: int,
    *,
    version: int = 1,
    status: str = "active",
    publication_status: str = "PUBLISHED",
    effective_from: datetime | None = None,
    effective_to: datetime | None = None,
    code: str = "coface_first",
):
    now = datetime(2026, 7, 20, tzinfo=timezone.utc)
    return SimpleNamespace(
        id=policy_id,
        code=code,
        name=f"Policy {policy_id}",
        version=version,
        status=status,
        publication_status=publication_status,
        effective_from=effective_from or now,
        effective_to=effective_to,
        activated_at=now,
        published_at=now,
        published_by_user_id=1,
        governance_request_id=policy_id + 1000,
        created_at=now,
    )


def test_effective_policy_returns_single_published_policy_without_using_higher_unpublished_version():
    published = _policy(89, version=2, publication_status="PUBLISHED")
    unpublished_higher = _policy(111, version=99, publication_status="UNPUBLISHED")
    db = DummyDb([unpublished_higher, published])

    with (
        patch("app.services.credit_decision_policy_score_structure.validate_score_structure", return_value={"status": "valid", "errors": [], "effective_pillars_weight": "85"}),
        patch("app.services.effective_credit_policy.has_pending_publication_or_archive_request", return_value=False),
    ):
        result = effective_credit_policy.get_effective_credit_policy(db, analysis_date=datetime(2026, 7, 20, tzinfo=timezone.utc))

    assert result.policy_id == 89
    assert result.conflict is False
    assert result.published is True


def test_effective_policy_keeps_conflict_when_two_published_policies_are_effective():
    db = DummyDb([_policy(111, version=3), _policy(89, version=2)])

    result = effective_credit_policy.get_effective_credit_policy(db, analysis_date=datetime(2026, 7, 20, tzinfo=timezone.utc))

    assert result.conflict is True
    assert result.policy is None
    assert {item["policy_id"] for item in result.candidates} == {89, 111}


def test_seed_does_not_create_when_published_effective_policy_already_exists():
    existing = _policy(89, version=2)
    db = DummyDb()
    resolution = SimpleNamespace(conflict=False, policy=existing, published=True, candidates=[])

    with (
        patch("app.services.credit_decision_policy_service._archive_dev_versioning_policy_conflicts") as archive_dev,
        patch("app.services.credit_decision_policy_service.get_effective_credit_policy", return_value=resolution),
        patch("app.services.credit_decision_policy_service.ensure_default_score_structure") as ensure_structure,
        patch("app.services.credit_decision_policy_service._ensure_seed_policy_governed_publication") as ensure_publication,
    ):
        result = ensure_active_credit_decision_policy_seed(db)  # type: ignore[arg-type]

    assert result is existing
    archive_dev.assert_called_once_with(db)
    db.add.assert_not_called()
    ensure_structure.assert_not_called()
    ensure_publication.assert_not_called()


def test_publication_overlap_guard_blocks_same_code_open_window():
    target = _policy(111, version=3, effective_from=datetime(2026, 7, 20, tzinfo=timezone.utc))
    existing = _policy(89, version=2, effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc), effective_to=None)
    db = DummyDb([existing])

    with pytest.raises(PolicyGovernanceWorkflowConflictError):
        validate_no_published_policy_overlap(db, target, effective_at=datetime(2026, 7, 20, tzinfo=timezone.utc))  # type: ignore[arg-type]


def test_publication_overlap_guard_allows_previous_window_closed_before_new_start():
    target = _policy(111, version=3, effective_from=datetime(2026, 7, 20, tzinfo=timezone.utc))
    existing = _policy(
        89,
        version=2,
        effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
        effective_to=datetime(2026, 7, 20, tzinfo=timezone.utc),
    )
    db = DummyDb([existing])

    validate_no_published_policy_overlap(db, target, effective_at=datetime(2026, 7, 20, tzinfo=timezone.utc))  # type: ignore[arg-type]


def test_publication_overlap_guard_allows_different_policy_code():
    target = _policy(111, version=3, code="coface_first")
    existing = _policy(89, version=2, code="other_policy")
    db = DummyDb([existing])

    validate_no_published_policy_overlap(db, target, effective_at=datetime(2026, 7, 20, tzinfo=timezone.utc))  # type: ignore[arg-type]
