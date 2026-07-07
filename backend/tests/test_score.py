from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import score


def test_existing_legacy_score_without_snapshot_preserves_legacy_engine():
    legacy_result = (object(), object(), False)
    analysis = SimpleNamespace(decision_memory_json={})
    existing_score = SimpleNamespace(calculation_memory_json={"score_source": "legacy_policy"})
    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.return_value = existing_score

    with (
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result) as legacy,
        patch("app.services.score._calculate_and_upsert_configurable_score") as configurable,
    ):
        assert score.calculate_and_upsert_score(db, 123) == legacy_result

    legacy.assert_called_once()
    configurable.assert_not_called()


def test_missing_snapshot_without_existing_legacy_score_uses_configurable_score_engine():
    configurable_result = (object(), object(), False)
    analysis = SimpleNamespace(decision_memory_json={})
    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.return_value = None

    with (
        patch("app.services.score._calculate_and_upsert_configurable_score", return_value=configurable_result) as configurable,
        patch("app.services.score._calculate_and_upsert_legacy_score") as legacy,
    ):
        assert score.calculate_and_upsert_score(db, 123) == configurable_result

    configurable.assert_called_once()
    legacy.assert_not_called()


def test_configurable_policy_failure_falls_back_to_legacy_and_records_reason():
    score_result = SimpleNamespace(calculation_memory_json={"final_score": 820})
    legacy_result = (score_result, object(), True)

    db = MagicMock()
    db.scalar.return_value = None

    with (
        patch(
            "app.services.score._calculate_and_upsert_configurable_score",
            side_effect=score.ConfigurableScorePolicyUnavailable("policy_not_published"),
        ),
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result),
    ):
        returned_score, _, _ = score.calculate_and_upsert_score(db, 123)

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


def test_legacy_policy_snapshot_forces_legacy():
    legacy_result = (object(), object(), False)
    analysis = SimpleNamespace(decision_memory_json={"policy_snapshot": {"engine": "legacy_policy"}})
    db = MagicMock()
    db.get.return_value = analysis

    with (
        patch("app.services.score._calculate_and_upsert_legacy_score", return_value=legacy_result) as legacy,
        patch("app.services.score._calculate_and_upsert_configurable_score") as configurable,
    ):
        assert score.calculate_and_upsert_score(db, 123) == legacy_result

    legacy.assert_called_once()
    configurable.assert_not_called()


def test_configurable_policy_snapshot_forces_configurable():
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

    db.scalar.return_value = None

    with (
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


def test_configurable_policy_validation_allows_published_policy_effective_weight_to_vary():
    policy = SimpleNamespace(id=759, status="active", activated_at=object())
    structure = {"pillar_roadmap": [{"code": "market_conditions", "status": "configured", "is_effective": True, "affects_score": True}]}

    with (
        patch("app.services.score.is_policy_published", return_value=True),
        patch("app.services.score.has_pending_publication_or_archive_request", return_value=False),
        patch("app.services.score.validate_score_structure", return_value={"status": "valid", "errors": [], "effective_pillars_weight": Decimal("100")}),
        patch("app.services.score.get_score_structure", return_value=structure),
    ):
        assert score._validate_configurable_policy_ready(MagicMock(), policy) == structure


def test_configurable_policy_validation_rejects_zero_effective_weight():
    policy = SimpleNamespace(id=759, status="active", activated_at=object())

    with (
        patch("app.services.score.is_policy_published", return_value=True),
        patch("app.services.score.has_pending_publication_or_archive_request", return_value=False),
        patch("app.services.score.validate_score_structure", return_value={"status": "valid", "errors": [], "effective_pillars_weight": Decimal("0")}),
        pytest.raises(score.ConfigurableScorePolicyUnavailable) as exc_info,
    ):
        score._validate_configurable_policy_ready(MagicMock(), policy)

    assert exc_info.value.reason == "invalid_effective_weight"

def test_calculate_score_passes_company_id_to_configurable_engine():
    configurable_result = (object(), object(), False)
    analysis = SimpleNamespace(decision_memory_json={})
    db = MagicMock()
    db.get.return_value = analysis
    db.scalar.return_value = None

    with patch(
        "app.services.score._calculate_and_upsert_configurable_score",
        return_value=configurable_result,
    ) as configurable:
        assert score.calculate_and_upsert_score(db, 123, company_id=77) == configurable_result

    configurable.assert_called_once_with(db, 123, company_id=77)


def test_missing_governed_publication_message_includes_lookup_context():
    message = score._policy_unavailable_message(
        "active_policy_without_governed_publication",
        {
            "policy_id": 84,
            "status": "active",
            "publication_status": "UNPUBLISHED",
        },
    )

    assert "id=84" in message
    assert "status=active" in message
    assert "publication_status=UNPUBLISHED" in message


def test_build_score_pillars_contract_remains_available_when_pillar_one_is_zeroed_for_missing_financial_data():
    score_result = SimpleNamespace(
        calculation_memory_json={
            "score_source": "configurable_policy",
            "policy_id": 12,
            "policy_code": "coface_first",
            "policy_version": 3,
            "explainability": {
                "policy": {
                    "policy_id": 12,
                    "policy_code": "coface_first",
                    "policy_version": 3,
                },
                "pillars_evaluated": [
                    {
                        "pillar_code": "financial_stability_liquidity",
                        "pillar_name": "Pilar 1",
                        "score": Decimal("0.00"),
                        "weighted_score": Decimal("0.0000"),
                        "weight_percent": 55,
                        "status": "not_available",
                        "source": "not_available",
                        "reason": "Pilar 1 zerado por ausencia de dados financeiros suficientes.",
                        "warnings": [{"reason": "financial_data_not_available"}],
                        "calculation_trace": [
                            {
                                "step": "missing_agrisk_financial_analysis",
                                "reason_code": "financial_data_not_available",
                            }
                        ],
                    }
                ],
            },
            "engine_trace": {"engine": "configurable_policy"},
        }
    )

    contract = score.build_score_pillars_contract(score_result)

    assert contract["available"] is True
    assert contract["items"][0]["status"] == "not_available"
    assert contract["items"][0]["source"] == "not_available"
    assert contract["items"][0]["calculation_trace"][0]["reason_code"] == "financial_data_not_available"


def test_configurable_score_scale_reaches_1000_with_full_effective_policy():
    values = score._calculate_configurable_score_values([
        {"pillar_code": "financial_stability_liquidity", "score": Decimal("10"), "weighted_score": Decimal("5.5"), "weight_percent": Decimal("55")},
        {"pillar_code": "guarantees_credit_insurance", "score": Decimal("10"), "weighted_score": Decimal("2.0"), "weight_percent": Decimal("20")},
        {"pillar_code": "payment_history", "score": Decimal("10"), "weighted_score": Decimal("0.5"), "weight_percent": Decimal("5")},
        {"pillar_code": "relationship_history", "score": Decimal("10"), "weighted_score": Decimal("0.5"), "weight_percent": Decimal("5")},
    ])

    assert values["weighted_score"] == Decimal("8.5")
    assert values["effective_weight"] == Decimal("85")
    assert values["normalized_score"] == Decimal("10.0000")
    assert values["final_score"] == 1000


def test_changing_pillar_weight_changes_final_score_when_policy_result_weight_changes():
    base = score._calculate_configurable_score_values([
        {"pillar_code": "financial_stability_liquidity", "score": Decimal("5"), "weighted_score": Decimal("2.75"), "weight_percent": Decimal("55")},
        {"pillar_code": "guarantees_credit_insurance", "score": Decimal("10"), "weighted_score": Decimal("2.0"), "weight_percent": Decimal("20")},
    ])
    changed = score._calculate_configurable_score_values([
        {"pillar_code": "financial_stability_liquidity", "score": Decimal("5"), "weighted_score": Decimal("3.50"), "weight_percent": Decimal("70")},
        {"pillar_code": "guarantees_credit_insurance", "score": Decimal("10"), "weighted_score": Decimal("2.0"), "weight_percent": Decimal("20")},
    ])

    assert changed["final_score"] != base["final_score"]
    assert changed["effective_weight"] == Decimal("90")


def test_disabled_pillar_is_removed_from_normalization_denominator():
    values = score._calculate_configurable_score_values([
        {"pillar_code": "financial_stability_liquidity", "score": Decimal("10"), "weighted_score": Decimal("5.5"), "weight_percent": Decimal("55")},
        {"pillar_code": "guarantees_credit_insurance", "score": Decimal("0"), "weighted_score": Decimal("0"), "weight_percent": Decimal("20"), "effective": False},
    ])

    assert values["effective_weight"] == Decimal("55")
    assert values["final_score"] == 1000


def test_future_pillar_activation_increases_normalization_denominator():
    values = score._calculate_configurable_score_values([
        {"pillar_code": "financial_stability_liquidity", "score": Decimal("10"), "weighted_score": Decimal("5.5"), "weight_percent": Decimal("55")},
        {"pillar_code": "market_conditions", "score": Decimal("10"), "weighted_score": Decimal("1.5"), "weight_percent": Decimal("15")},
    ])

    assert values["effective_weight"] == Decimal("70")
    assert values["final_score"] == 1000


def test_official_pillar_flow_passes_coface_to_pillars():
    db = MagicMock()
    policy = SimpleNamespace(id=10)
    analysis = SimpleNamespace(id=20, requested_limit=Decimal("100"), customer=SimpleNamespace(document_number="123"), decision_memory_json={})
    structure = {"pillars": [{"code": "financial_stability_liquidity", "is_enabled": True}, {"code": "guarantees_credit_insurance", "is_enabled": True}]}
    coface = {"read_id": 7, "coverage_amount": Decimal("80"), "status": "accepted", "valid": True, "source": "coface"}

    with (
        patch("app.services.score._resolve_coface_evidence", return_value=coface),
        patch("app.services.score.simulate_pillar_one_score", return_value={"pillar_code": "financial_stability_liquidity", "weighted_score": Decimal("5.5"), "weight_percent": Decimal("55")}) as pillar_one,
        patch("app.services.score.simulate_pillar_two_score", return_value={"pillar_code": "guarantees_credit_insurance", "weighted_score": Decimal("1.6"), "weight_percent": Decimal("20")}) as pillar_two,
    ):
        results = score._calculate_configurable_pillar_results(db, policy=policy, analysis=analysis, structure=structure)

    pillar_one.assert_called_once_with(db, policy_id=10, analysis_id=20, coface_valid=True)
    pillar_two.assert_called_once_with(
        db,
        policy_id=10,
        requested_limit_amount=Decimal("100"),
        coface_coverage_amount=Decimal("80"),
        coface_valid=True,
        coface_status="accepted",
        analysis_id=20,
    )
    assert results[0]["coface_evidence"] == coface


def test_build_score_pillars_contract_preserves_warnings_and_indicator_policy_trace():
    score_result = SimpleNamespace(
        calculation_memory_json={
            "score_source": "configurable_policy",
            "policy_id": 12,
            "policy_code": "coface_first",
            "policy_version": 3,
            "explainability": {
                "policy": {"policy_id": 12, "policy_code": "coface_first", "policy_version": 3},
                "pillars_evaluated": [
                    {
                        "pillar_code": "financial_stability_liquidity",
                        "pillar_name": "Pilar 1",
                        "score": Decimal("4.00"),
                        "weighted_score": Decimal("2.2000"),
                        "weight_percent": Decimal("55"),
                        "effective": True,
                        "policy_source": "published_policy",
                        "status": "calculated",
                        "source": "agrisk_financial_analysis",
                        "warnings": [{"reason": "field_not_found"}],
                        "indicators": [{"code": "current_liquidity", "range_used": {"operator": ">=", "threshold_value": Decimal("2"), "score": Decimal("10"), "source": "published_policy"}}],
                    }
                ],
            },
            "engine_trace": {"engine": "configurable_policy"},
        }
    )

    contract = score.build_score_pillars_contract(score_result)

    assert contract["items"][0]["warnings"] == [{"reason": "field_not_found"}]
    assert contract["items"][0]["policy_source"] == "published_policy"
    assert contract["items"][0]["indicators"][0]["range_used"]["source"] == "published_policy"


def test_official_flow_executes_future_active_pillar_from_published_structure():
    db = MagicMock()
    policy = SimpleNamespace(id=10)
    analysis = SimpleNamespace(
        id=20,
        requested_limit=Decimal("100"),
        customer=SimpleNamespace(document_number="123"),
        decision_memory_json={"market_inputs": {"sector_risk": "7"}},
    )
    structure = {
        "pillars": [
            {
                "policy_id": 10,
                "code": "market_conditions",
                "name": "Condicoes de Mercado",
                "weight_percent": Decimal("15"),
                "is_enabled": True,
                "subgroups": [
                    {
                        "code": "sector_context",
                        "name": "Contexto Setorial",
                        "weight_percent": Decimal("100"),
                        "is_enabled": True,
                        "indicators": [
                            {
                                "code": "sector_risk",
                                "name": "Risco Setorial",
                                "source_key": "market_inputs.sector_risk",
                                "weight_percent": Decimal("100"),
                                "is_enabled": True,
                                "score_ranges": [
                                    {"operator": ">=", "threshold_value": Decimal("5"), "threshold_value_to": None, "score": Decimal("8"), "label": "custom", "is_enabled": True}
                                ],
                            }
                        ],
                    }
                ],
            }
        ]
    }

    with patch("app.services.score._resolve_coface_evidence", return_value={"read_id": None, "coverage_amount": None, "status": None, "valid": False, "source": "not_available"}):
        results = score._calculate_configurable_pillar_results(db, policy=policy, analysis=analysis, structure=structure)

    values = score._calculate_configurable_score_values(results)
    assert results[0]["pillar_code"] == "market_conditions"
    assert results[0]["score"] == Decimal("8.00")
    assert results[0]["weight_percent"] == Decimal("15")
    assert results[0]["indicators"][0]["range_used"]["source"] == "published_policy"
    assert values["effective_weight"] == Decimal("15")
    assert values["final_score"] == 800
