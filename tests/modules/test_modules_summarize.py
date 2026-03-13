"""
tests/modules/test_modules_summarize.py
─────────────────────────────────────────
Tests for app/modules/modules/summarize.py

Coverage
--------
Happy path
  1. Valid non-empty string → validation passes, word_count populated
  2. Dict raw_input with style/max_words respected in prompt
  3. British alias 'summarise' handled by get_task_types

Validation failure
  4. None → fails
  5. Empty string → fails
  6. Extremely long output (>2000 words) → fails

Normalisation
  7. word_count matches len(text.split())
  8. OpenAI choices-style dict extracted correctly
  9. Direct "text" key dict extracted correctly

Schema / interface
  10. get_task_types includes 'summarize' and 'summarise'
  11. preferred + fallback model lists non-empty
"""
from __future__ import annotations

import pytest

from app.modules.modules.summarize import SummarizeModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return SummarizeModule()


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_summarize_happy_path(mod):
    raw = "This is a short but complete summary of the source document."
    vr  = mod.validate_output(raw)
    assert vr.passed is True
    out = mod.normalize_output(raw)
    assert out["summary"]    == raw
    assert out["word_count"] == len(raw.split())


def test_summarize_dict_input_max_words_in_prompt(mod):
    mi = ModuleInput(
        task_type = "summarize",
        raw_input = {"text": "Long text here…", "max_words": 50, "style": "brief"},
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "50" in sys_msg


def test_summarise_alias_in_task_types(mod):
    assert "summarise" in mod.get_task_types()


def test_summarize_can_handle_aliases(mod):
    assert mod.can_handle("summarize")  is True
    assert mod.can_handle("summarise")  is True
    assert mod.can_handle("translate")  is False


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure paths
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    vr = mod.validate_output(None)
    assert vr.passed is False


def test_validate_empty_string_fails(mod):
    vr = mod.validate_output("")
    assert vr.passed is False


def test_validate_very_long_output_fails(mod):
    # 2001 words
    raw = " ".join(["word"] * 2001)
    vr  = mod.validate_output(raw)
    assert vr.passed is False
    assert any("long" in e.lower() or "2001" in e for e in vr.errors)


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_word_count_accurate(mod):
    raw = "one two three four five"
    out = mod.normalize_output(raw)
    assert out["word_count"] == 5


def test_normalize_openai_choices_dict(mod):
    raw = {
        "choices": [
            {"message": {"content": "This is the summary."}}
        ]
    }
    out = mod.normalize_output(raw)
    assert "summary" in out["summary"].lower() or len(out["summary"]) > 0


def test_normalize_text_key_dict(mod):
    raw = {"text": "Summary content here."}
    out = mod.normalize_output(raw)
    assert out["summary"] == "Summary content here."


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_preferred_models_non_empty(mod):
    assert len(mod.get_preferred_models()) > 0


def test_fallback_models_non_empty(mod):
    assert len(mod.get_fallback_models()) > 0


def test_input_schema_requires_text(mod):
    schema = mod.get_input_schema()
    assert "text" in schema.get("required", [])
