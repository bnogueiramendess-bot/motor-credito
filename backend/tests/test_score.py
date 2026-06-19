from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import score


def test_feature_flag_disabled_uses_legacy_score_engine():
    legacy_result = (object(), object(), False)
    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", False),
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result) as legacy,
        patch("app.services.score._calculate_and_upsert_configurable_score") as configurable,
    ):
        assert score.calculate_and_upsert_score(MagicMock(), 123) == legacy_result

    legacy.assert_called_once()
    configurable.assert_not_called()


def test_feature_flag_enabled_uses_configurable_score_engine():
    configurable_result = (object(), object(), False)
    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", True),
        patch("app.services.score._calculate_and_upsert_configurable_score", return_value=configurable_result) as configurable,
        patch("app.services.score._calculate_and_upsert_legacy_score") as legacy,
    ):
        assert score.calculate_and_upsert_score(MagicMock(), 123) == configurable_result

    configurable.assert_called_once()
    legacy.assert_not_called()


def test_configurable_policy_failure_falls_back_to_legacy_and_records_reason():
    score_result = SimpleNamespace(calculation_memory_json={"final_score": 820})
    legacy_result = (score_result, object(), True)

    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", True),
        patch(
            "app.services.score._calculate_and_upsert_configurable_score",
            side_effect=score.ConfigurableScorePolicyUnavailable("policy_not_published"),
        ),
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result),
    ):
        returned_score, _, _ = score.calculate_and_upsert_score(MagicMock(), 123)

    assert returned_score.calculation_memory_json["score_source"] == "legacy_policy"
    assert returned_score.calculation_memory_json["fallback_used"] is True
    assert returned_score.calculation_memory_json["fallback_reason"] == "policy_not_published"
    assert returned_score.calculation_memory_json["engine_trace"] == {
        "engine": "legacy_policy",
        "policy_id": None,
        "policy_name": None,
        "policy_version": None,
        "source": "configurable_policy_fallback",
        "fallback_used": True,
        "fallback_reason": "policy_not_published",
    }


def test_legacy_policy_snapshot_forces_legacy_even_with_feature_flag_enabled():
    legacy_result = (object(), object(), False)
    analysis = SimpleNamespace(decision_memory_json={"policy_snapshot": {"engine": "legacy_policy"}})
    db = MagicMock()
    db.get.return_value = analysis

    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", True),
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result) as legacy,
        patch("app.services.score._calculate_and_upsert_configurable_score") as configurable,
    ):
        assert score.calculate_and_upsert_score(db, 123) == legacy_result

    legacy.assert_called_once()
    configurable.assert_not_called()


def test_configurable_policy_snapshot_forces_configurable_even_with_feature_flag_disabled():
    configurable_result = (object(), object(), False)
    analysis = SimpleNamespace(
        decision_memory_json={
            "policy_snapshot": {
                "engine": "configurable_policy",
                "policy_id": 759,
                "policy_version": 17,
            }
        }
    )
    db = MagicMock()
    db.get.return_value = analysis

    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", False),
        patch("app.services.score._calculate_and_upsert_configurable_score", return_value=configurable_result) as configurable,
        patch("app.services.score._calculate_and_upsert_legacy_score") as legacy,
    ):
        assert score.calculate_and_upsert_score(db, 123) == configurable_result

    configurable.assert_called_once()
    legacy.assert_not_called()


def test_capture_analysis_policy_snapshot_persists_configurable_policy():
    policy = SimpleNamespace(
        id=759,
        code="coface_first",
        name="Coface First",
        version=17,
        activated_at=None,
    )
    analysis = SimpleNamespace(decision_memory_json={})

    with (
        patch("app.services.score.settings.configurable_score_policy_enabled", True),
        patch("app.services.score._load_active_configurable_policy", return_value=policy),
        patch("app.services.score._validate_configurable_policy_ready", return_value={}),
    ):
        snapshot = score.capture_analysis_policy_snapshot(MagicMock(), analysis)

    assert snapshot["engine"] == "configurable_policy"
    assert snapshot["policy_id"] == 759
    assert snapshot["policy_code"] == "coface_first"
    assert snapshot["policy_version"] == 17
    assert snapshot["effective_weight"] == 85
    assert analysis.decision_memory_json["policy_snapshot"] == snapshot


def test_configurable_policy_validation_requires_pillar_three_planned_and_no_effect():
    policy = SimpleNamespace(id=759, status="active", activated_at=object())
    db = MagicMock()

    structure = {
        "pillar_roadmap": [
            {
                "code": "market_conditions",
                "status": "planned",
                "is_effective": False,
                "affects_score": False,
            }
        ]
    }

    with (
        patch("app.services.score._has_governed_publication", return_value=True),
        patch("app.services.score._has_pending_publication_or_archive_request", return_value=False),
        patch(
            "app.services.score.validate_score_structure",
            return_value={"operational_status": "configured", "effective_pillars_weight": Decimal("85")},
        ),
        patch("app.services.score.get_score_structure", return_value=structure),
    ):
        assert score._validate_configurable_policy_ready(db, policy) == structure

    structure["pillar_roadmap"][0]["affects_score"] = True
    with (
        patch("app.services.score._has_governed_publication", return_value=True),
        patch("app.services.score._has_pending_publication_or_archive_request", return_value=False),
        patch(
            "app.services.score.validate_score_structure",
            return_value={"operational_status": "configured", "effective_pillars_weight": Decimal("85")},
        ),
        patch("app.services.score.get_score_structure", return_value=structure),
        pytest.raises(score.ConfigurableScorePolicyUnavailable) as exc_info,
    ):
        score._validate_configurable_policy_ready(db, policy)

    assert exc_info.value.reason == "pillar_three_must_remain_planned"


def test_configurable_policy_validation_requires_effective_weight_85():
    policy = SimpleNamespace(id=759, status="active", activated_at=object())

    with (
        patch("app.services.score._has_governed_publication", return_value=True),
        patch("app.services.score._has_pending_publication_or_archive_request", return_value=False),
        patch(
            "app.services.score.validate_score_structure",
            return_value={"operational_status": "configured", "effective_pillars_weight": Decimal("100")},
        ),
        pytest.raises(score.ConfigurableScorePolicyUnavailable) as exc_info,
    ):
        score._validate_configurable_policy_ready(MagicMock(), policy)

    assert exc_info.value.reason == "invalid_effective_weight"
