from app.services.decision import _apply_score_engine_trace


def test_decision_memory_registers_configurable_engine_trace():
    memory = {"score_final": 910}
    trace = {
        "engine": "configurable_policy",
        "policy_id": 759,
        "policy_code": "coface_first",
        "policy_version": 17,
        "effective_weight": 85,
        "fallback_used": False,
    }

    _apply_score_engine_trace(memory, trace)

    assert memory["score_source"] == "configurable_policy"
    assert memory["policy_id"] == 759
    assert memory["policy_code"] == "coface_first"
    assert memory["policy_version"] == 17
    assert memory["effective_weight"] == 85
    assert memory["fallback_used"] is False
    assert memory["engine_trace"] == trace


def test_decision_memory_registers_fallback_engine_trace():
    memory = {"score_final": 710}
    trace = {
        "engine": "legacy_policy",
        "fallback_used": True,
        "fallback_reason": "policy_not_published",
    }

    _apply_score_engine_trace(memory, trace)

    assert memory["score_source"] == "legacy_policy"
    assert memory["fallback_used"] is True
    assert memory["fallback_reason"] == "policy_not_published"
    assert memory["engine_trace"] == trace


def test_decision_memory_is_unchanged_without_engine_trace():
    memory = {"score_final": 710}

    _apply_score_engine_trace(memory, None)

    assert memory == {"score_final": 710}
