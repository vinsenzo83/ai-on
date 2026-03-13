"""
tests/modules/test_modules_analysis.py
────────────────────────────────────────
Tests for app/modules/modules/analysis.py

Coverage
--------
Happy path
  1. Full JSON output → all fields normalised correctly
  2. Sentiment task_type → analysis_type propagated in prompt
  3. analyse / analyze / sentiment aliases all handled

Validation failure
  4. None → fails
  5. Empty string → fails
  6. JSON with neither summary nor insights → fails
  7. confidence out of range → fails

Normalisation
  8. Plain string fallback → summary = text, insights=[text]
  9. topics / insights cast to list[str]
  10. confidence cast to float

Schema / interface
  11. All four aliases present in task_types
  12. preferred model list starts with gpt-4o (higher-capability model)
"""
from __future__ import annotations

import json

import pytest

from app.modules.modules.analysis import AnalysisModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return AnalysisModule()


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_analysis_happy_path_full_json(mod):
    raw = json.dumps({
        "analysis_type": "sentiment",
        "summary":       "Overall positive tone.",
        "sentiment":     {"label": "positive", "score": 0.85},
        "topics":        ["skincare", "moisturiser"],
        "insights":      ["Customers love the texture.", "Price is considered fair."],
        "dimensions":    {"urgency": "low"},
        "confidence":    0.9,
    })
    vr  = mod.validate_output(raw)
    assert vr.passed is True

    out = mod.normalize_output(raw)
    assert out["analysis_type"]          == "sentiment"
    assert out["summary"]                == "Overall positive tone."
    assert out["sentiment"]["label"]     == "positive"
    assert out["sentiment"]["score"]     == pytest.approx(0.85)
    assert "skincare"                    in out["topics"]
    assert len(out["insights"])          == 2
    assert out["dimensions"]["urgency"]  == "low"
    assert out["confidence"]             == pytest.approx(0.9)


def test_analysis_sentiment_task_type_in_prompt(mod):
    mi = ModuleInput(
        task_type = "sentiment",
        raw_input = {"text": "I love this product!", "analysis_type": "sentiment"},
    )
    prompt   = mod.build_prompt(mi)
    user_msg = prompt["messages"][1]["content"]
    assert "sentiment" in user_msg.lower()


def test_analysis_aliases_task_types(mod):
    for alias in ("analysis", "analyse", "analyze", "sentiment"):
        assert mod.can_handle(alias) is True


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    assert mod.validate_output(None).passed is False


def test_validate_empty_string_fails(mod):
    assert mod.validate_output("   ").passed is False


def test_validate_json_with_no_summary_or_insights_fails(mod):
    raw = json.dumps({"analysis_type": "general", "topics": ["a", "b"]})
    vr  = mod.validate_output(raw)
    assert vr.passed is False


def test_validate_confidence_out_of_range_fails(mod):
    raw = json.dumps({
        "summary": "ok",
        "confidence": 2.5,
    })
    vr = mod.validate_output(raw)
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_plain_string_fallback(mod):
    raw = "This text shows a neutral sentiment with mixed signals."
    out = mod.normalize_output(raw)
    assert out["summary"]  == raw
    assert raw             in out["insights"]


def test_normalize_topics_cast_to_list_of_str(mod):
    raw = json.dumps({
        "summary":  "ok",
        "topics":   [1, 2, 3],          # numbers should be cast to str
        "insights": ["insight"],
    })
    out = mod.normalize_output(raw)
    assert all(isinstance(t, str) for t in out["topics"])


def test_normalize_confidence_cast_to_float(mod):
    raw = json.dumps({"summary": "ok", "confidence": "0.75", "insights": ["x"]})
    out = mod.normalize_output(raw)
    assert isinstance(out["confidence"], float)
    assert out["confidence"] == pytest.approx(0.75)


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types_all_four_aliases(mod):
    types = mod.get_task_types()
    for expected in ("analysis", "analyse", "analyze", "sentiment"):
        assert expected in types


def test_preferred_models_starts_with_capable_model(mod):
    """Analysis requires a stronger model; first preferred should be gpt-4o."""
    preferred = mod.get_preferred_models()
    assert len(preferred) > 0
    assert preferred[0] == "gpt-4o"
