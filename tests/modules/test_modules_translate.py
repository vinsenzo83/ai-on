"""
tests/modules/test_modules_translate.py
─────────────────────────────────────────
Tests for app/modules/modules/translate.py

Coverage
--------
Happy path
  1. Valid translated text string → validation passes
  2. Dict input with target_lang builds prompt correctly
  3. source_lang included in system message when provided

Validation failure
  4. None → fails
  5. Empty string → fails

Normalisation
  6. char_count equals len(translated_text)
  7. Dict with "translated_text" key extracted
  8. Plain string normalised to translated_text

Schema / interface
  9. 'translate' and 'translation' in task_types
  10. target_lang required in input_schema
"""
from __future__ import annotations

import pytest

from app.modules.modules.translate import TranslateModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return TranslateModule()


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_translate_happy_path_string(mod):
    raw = "안녕하세요, 이것은 번역된 텍스트입니다."
    vr  = mod.validate_output(raw)
    assert vr.passed is True
    out = mod.normalize_output(raw)
    assert out["translated_text"] == raw
    assert out["char_count"]      == len(raw)


def test_translate_dict_input_builds_prompt(mod):
    mi = ModuleInput(
        task_type = "translate",
        raw_input = {
            "text":        "Hello world",
            "target_lang": "ko",
            "source_lang": "en",
            "formality":   "formal",
        },
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "ko"   in sys_msg
    assert "en"   in sys_msg


def test_translate_source_lang_in_prompt_when_provided(mod):
    mi = ModuleInput(
        task_type = "translate",
        raw_input = {"text": "Bonjour", "target_lang": "en", "source_lang": "fr"},
    )
    prompt  = mod.build_prompt(mi)
    sys_msg = prompt["messages"][0]["content"]
    assert "fr" in sys_msg


def test_translate_auto_detect_when_no_source_lang(mod):
    mi = ModuleInput(
        task_type = "translate",
        raw_input = {"text": "Hola", "target_lang": "en"},
    )
    prompt  = mod.build_prompt(mi)
    sys_msg = prompt["messages"][0]["content"]
    # Should mention detecting the language
    assert "detect" in sys_msg.lower() or "auto" in sys_msg.lower() or "translating" in sys_msg.lower()


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    assert mod.validate_output(None).passed is False


def test_validate_empty_string_fails(mod):
    assert mod.validate_output("").passed is False


def test_validate_whitespace_only_fails(mod):
    assert mod.validate_output("   \n  ").passed is False


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_char_count(mod):
    text = "Some translated text."
    out  = mod.normalize_output(text)
    assert out["char_count"] == len(text)


def test_normalize_dict_with_translated_text_key(mod):
    raw = {"translated_text": "Bonjour le monde"}
    out = mod.normalize_output(raw)
    assert out["translated_text"] == "Bonjour le monde"


def test_normalize_plain_string(mod):
    raw = "こんにちは世界"
    out = mod.normalize_output(raw)
    assert out["translated_text"] == raw


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types(mod):
    assert "translate"   in mod.get_task_types()
    assert "translation" in mod.get_task_types()


def test_input_schema_requires_target_lang(mod):
    schema   = mod.get_input_schema()
    required = schema.get("required", [])
    assert "target_lang" in required


def test_preferred_fallback_non_empty(mod):
    assert len(mod.get_preferred_models()) > 0
    assert len(mod.get_fallback_models())  > 0
