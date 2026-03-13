"""
tests/modules/test_modules_document.py
────────────────────────────────────────
Tests for app/modules/modules/document.py

Coverage
--------
Happy path
  1. Multi-word string output → validation passes, word_count populated
  2. Draft rewrite mode builds prompt with 'rewrite' instruction
  3. Sections hint included in prompt when provided

Validation failure
  4. None → fails
  5. Empty string → fails
  6. Less than 20 words → fails (min length check)

Normalisation
  7. section_count = number of markdown headings
  8. OpenAI choices dict extracted
  9. word_count accurate

Schema / interface
  10. All aliases in task_types: document, docs, docgen, readme, report
"""
from __future__ import annotations

import pytest

from app.modules.modules.document import DocumentModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return DocumentModule()

_LONG_ENOUGH = (
    "# Introduction\n\n"
    "This is a sample document that has more than twenty words "
    "in total so that the validation check will pass without any issues."
)


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_document_happy_path(mod):
    vr = mod.validate_output(_LONG_ENOUGH)
    assert vr.passed is True
    out = mod.normalize_output(_LONG_ENOUGH)
    assert out["word_count"] > 20
    assert out["section_count"] >= 1


def test_document_draft_mode_prompt(mod):
    mi = ModuleInput(
        task_type = "document",
        raw_input = {
            "topic": "FastAPI tutorial",
            "draft": "FastAPI is a framework.",
            "doc_type": "readme",
        },
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "rewrite" in sys_msg.lower() or "improve" in sys_msg.lower()


def test_document_sections_in_prompt(mod):
    mi = ModuleInput(
        task_type = "document",
        raw_input = {
            "topic":    "Module system design",
            "sections": ["Overview", "API Reference", "Examples"],
        },
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "Overview"     in sys_msg
    assert "API Reference" in sys_msg


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    assert mod.validate_output(None).passed is False


def test_validate_empty_string_fails(mod):
    assert mod.validate_output("").passed is False


def test_validate_too_short_fails(mod):
    # 5 words – below 20-word minimum
    raw = "This is too short."
    vr  = mod.validate_output(raw)
    assert vr.passed is False
    assert any("short" in e.lower() or "20" in e for e in vr.errors)


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_section_count(mod):
    doc = (
        "# Section One\n\nContent here.\n\n"
        "## Section Two\n\nMore content.\n\n"
        "### Section Three\n\nEven more content here now."
    )
    out = mod.normalize_output(doc)
    assert out["section_count"] == 3


def test_normalize_openai_choices_dict(mod):
    raw = {
        "choices": [
            {"message": {"content": _LONG_ENOUGH}}
        ]
    }
    out = mod.normalize_output(raw)
    assert out["word_count"] > 0


def test_normalize_word_count_accurate(mod):
    words = " ".join(["word"] * 30)
    out   = mod.normalize_output(words)
    assert out["word_count"] == 30


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types_all_aliases(mod):
    types = mod.get_task_types()
    for alias in ("document", "docs", "docgen", "readme", "report"):
        assert alias in types


def test_preferred_models_non_empty(mod):
    assert len(mod.get_preferred_models()) > 0
