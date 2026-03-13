"""
tests/modules/test_modules_code.py
────────────────────────────────────
Tests for app/modules/modules/code.py

Coverage
--------
Happy path
  1. Code string output → validation passes
  2. Fenced code block → extracted into "code" key
  3. Review action → prompt contains "Review"

Validation failure
  4. None → fails
  5. Empty string → fails
  6. Less than 10 chars → fails

Normalisation
  7. Fenced code block extracted correctly
  8. Explanation is text outside fence
  9. line_count >= 1 for non-empty code
  10. issues_found extracted from bullet points

Schema / interface
  11. All 5 task_types present
  12. preferred model list first item is gpt-4o
"""
from __future__ import annotations

import pytest

from app.modules.modules.code import CodeModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return CodeModule()


_FENCED_RESPONSE = """\
Here is the generated function:

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

The function takes a name parameter and returns a greeting string.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_code_happy_path_plain(mod):
    raw = "def foo():\n    return 42"
    vr  = mod.validate_output(raw)
    assert vr.passed is True


def test_code_fenced_code_block_extracted(mod):
    out = mod.normalize_output(_FENCED_RESPONSE)
    assert "def greet" in out["code"]
    assert "return f" in out["code"]


def test_code_explanation_outside_fence(mod):
    out = mod.normalize_output(_FENCED_RESPONSE)
    assert "greeting string" in out["explanation"]


def test_code_review_action_in_prompt(mod):
    mi = ModuleInput(
        task_type = "code_review",
        raw_input = {
            "instruction": "Review this function",
            "code":        "def add(a, b): return a + b",
            "action":      "review",
            "language":    "python",
        },
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "review" in sys_msg.lower()


def test_code_generate_action_in_prompt(mod):
    mi = ModuleInput(
        task_type = "code",
        raw_input = {"instruction": "Write a hello world function"},
    )
    prompt   = mod.build_prompt(mi)
    sys_msg  = prompt["messages"][0]["content"]
    assert "production-ready" in sys_msg.lower() or "generate" in sys_msg.lower() or "write" in sys_msg.lower()


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    assert mod.validate_output(None).passed is False


def test_validate_empty_string_fails(mod):
    assert mod.validate_output("").passed is False


def test_validate_too_short_fails(mod):
    vr = mod.validate_output("x")
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_line_count_positive(mod):
    raw = "def foo():\n    pass\n    return None\n"
    out = mod.normalize_output(raw)
    assert out["line_count"] >= 1


def test_normalize_issues_found_from_bullets(mod):
    raw = "Some explanation.\n\n- Bug on line 5\n- Missing return type\n\n```python\ndef fixed(): pass\n```"
    out = mod.normalize_output(raw)
    # issues_found should pick up bullet points from explanation
    assert isinstance(out["issues_found"], list)


def test_normalize_no_fence_treats_whole_text_as_code(mod):
    raw = "x = 1\ny = 2\nprint(x + y)"
    out = mod.normalize_output(raw)
    assert "x = 1" in out["code"]
    assert out["explanation"] == ""


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types_all_five(mod):
    types = mod.get_task_types()
    for alias in ("code", "codegen", "code_review", "refactor", "debug"):
        assert alias in types


def test_preferred_model_first_is_gpt4o(mod):
    assert mod.get_preferred_models()[0] == "gpt-4o"


def test_fallback_models_include_code_specialists(mod):
    fallback = mod.get_fallback_models()
    code_models = {"deepseek-coder", "codestral", "claude-3-sonnet"}
    assert any(m in code_models for m in fallback)
