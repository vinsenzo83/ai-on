"""
tests/modules/test_modules_classify.py
────────────────────────────────────────
Tests for app/modules/modules/classify.py

Coverage (per spec)
-------------------
Happy path
  1. classify with valid JSON output → success, correct label/confidence
  2. classify with dict raw_input → prompt contains text
  3. classify with candidate_labels → label list in prompt

Validation failure path
  4. None output → validation fails
  5. Empty string output → validation fails
  6. JSON missing 'label' key → validation fails
  7. confidence out of range → validation fails
  8. Non-parseable string → validation fails

Normalisation
  9. all_labels populated when absent in raw output
  10. markdown-fenced JSON correctly stripped and parsed
  11. confidence clamped to float

Schema / interface
  12. get_task_types includes 'classify' and 'categorise'
  13. get_preferred_models returns non-empty list
  14. get_fallback_models returns non-empty list
  15. can_handle returns True for 'classify' / False for 'code'
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from app.modules.modules.classify import ClassifyModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return ClassifyModule()


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_classify_happy_path_plain_json(mod):
    raw = json.dumps({
        "label":      "electronics",
        "confidence": 0.92,
        "all_labels": [
            {"label": "electronics", "score": 0.92},
            {"label": "fashion",     "score": 0.08},
        ],
    })
    vr = mod.validate_output(raw)
    assert vr.passed is True

    out = mod.normalize_output(raw)
    assert out["label"]      == "electronics"
    assert out["confidence"] == pytest.approx(0.92)
    assert len(out["all_labels"]) == 2


def test_classify_happy_path_dict_input(mod):
    raw = {"label": "beauty", "confidence": 0.85}
    vr  = mod.validate_output(raw)
    assert vr.passed is True

    out = mod.normalize_output(raw)
    assert out["label"] == "beauty"


def test_classify_build_prompt_includes_text(mod):
    mi = ModuleInput(task_type="classify", raw_input={"text": "I love this product"})
    prompt = mod.build_prompt(mi)
    user_msg = prompt["messages"][1]["content"]
    assert "I love this product" in user_msg


def test_classify_candidate_labels_in_prompt(mod):
    mi = ModuleInput(
        task_type = "classify",
        raw_input = {"text": "Some text", "candidate_labels": ["A", "B", "C"]},
    )
    prompt   = mod.build_prompt(mi)
    user_msg = prompt["messages"][1]["content"]
    assert '"A"' in user_msg
    assert '"B"' in user_msg


def test_classify_string_raw_input_builds_prompt(mod):
    mi = ModuleInput(task_type="classify", raw_input="just a string")
    prompt   = mod.build_prompt(mi)
    user_msg = prompt["messages"][1]["content"]
    assert "just a string" in user_msg


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure paths
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    vr = mod.validate_output(None)
    assert vr.passed is False
    assert vr.errors


def test_validate_empty_string_fails(mod):
    vr = mod.validate_output("   ")
    assert vr.passed is False


def test_validate_missing_label_key_fails(mod):
    raw = json.dumps({"confidence": 0.5, "all_labels": []})
    vr  = mod.validate_output(raw)
    assert vr.passed is False
    assert any("label" in e for e in vr.errors)


def test_validate_confidence_out_of_range_fails(mod):
    raw = json.dumps({"label": "x", "confidence": 1.5})
    vr  = mod.validate_output(raw)
    assert vr.passed is False


def test_validate_unparseable_string_fails(mod):
    vr = mod.validate_output("this is not json at all !!!")
    assert vr.passed is False


def test_validate_empty_label_string_fails(mod):
    raw = json.dumps({"label": "   ", "confidence": 0.7})
    vr  = mod.validate_output(raw)
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_all_labels_generated_when_missing(mod):
    raw = json.dumps({"label": "skincare", "confidence": 0.77})
    out = mod.normalize_output(raw)
    assert len(out["all_labels"]) >= 1
    assert out["all_labels"][0]["label"] == "skincare"


def test_normalize_strips_markdown_fences(mod):
    raw = "```json\n" + json.dumps({"label": "beauty", "confidence": 0.9}) + "\n```"
    vr  = mod.validate_output(raw)
    assert vr.passed is True
    out = mod.normalize_output(raw)
    assert out["label"] == "beauty"


def test_normalize_confidence_is_float(mod):
    raw = json.dumps({"label": "tech", "confidence": "0.88"})  # string confidence
    out = mod.normalize_output(raw)
    assert isinstance(out["confidence"], float)


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types_include_aliases(mod):
    types = mod.get_task_types()
    assert "classify"   in types
    assert "categorise" in types


def test_preferred_models_non_empty(mod):
    assert len(mod.get_preferred_models()) > 0


def test_fallback_models_non_empty(mod):
    assert len(mod.get_fallback_models()) > 0


def test_can_handle_classify(mod):
    assert mod.can_handle("classify")   is True
    assert mod.can_handle("categorise") is True
    assert mod.can_handle("code")       is False


def test_repr(mod):
    r = repr(mod)
    assert "classify" in r
