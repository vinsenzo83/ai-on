"""
tests/modules/test_module_validators.py
─────────────────────────────────────────
Unit tests for app/modules/validators.py

Coverage
--------
parse_json_output
  1. dict passthrough
  2. valid JSON string parsed
  3. markdown-fenced JSON stripped and parsed
  4. invalid JSON returns None
  5. list JSON returns list

require_json_dict
  6. passes when required keys present
  7. fails when required keys missing
  8. fails on non-dict JSON

require_non_empty_string
  9. passes for non-empty string
  10. fails for None
  11. fails for empty string

require_min_word_count
  12. passes when above threshold
  13. fails when below threshold

require_max_word_count
  14. passes when below cap
  15. fails when above cap

require_float_in_range
  16. passes within range
  17. fails below lower bound
  18. fails above upper bound
  19. fails for non-numeric string

combine
  20. all pass → combined passes
  21. one fails → combined fails with merged errors
  22. multiple fail → all errors aggregated
"""
from __future__ import annotations

import json

import pytest

from app.modules.types import ValidationResult
from app.modules.validators import (
    combine,
    parse_json_output,
    require_float_in_range,
    require_json_dict,
    require_max_word_count,
    require_min_word_count,
    require_non_empty_string,
)


# ─────────────────────────────────────────────────────────────────────────────
# parse_json_output
# ─────────────────────────────────────────────────────────────────────────────

def test_parse_json_dict_passthrough():
    d = {"key": "value"}
    assert parse_json_output(d) == d


def test_parse_json_valid_string():
    s = json.dumps({"a": 1})
    assert parse_json_output(s) == {"a": 1}


def test_parse_json_fenced_string():
    s = "```json\n" + json.dumps({"b": 2}) + "\n```"
    assert parse_json_output(s) == {"b": 2}


def test_parse_json_invalid_returns_none():
    assert parse_json_output("not json at all") is None


def test_parse_json_list_returned_as_list():
    s = json.dumps([1, 2, 3])
    result = parse_json_output(s)
    assert result == [1, 2, 3]


def test_parse_json_none_returns_none():
    assert parse_json_output(None) is None


# ─────────────────────────────────────────────────────────────────────────────
# require_json_dict
# ─────────────────────────────────────────────────────────────────────────────

def test_require_json_dict_passes():
    raw = json.dumps({"label": "x", "score": 0.5})
    vr  = require_json_dict(raw, ["label", "score"])
    assert vr.passed is True


def test_require_json_dict_fails_missing_key():
    raw = json.dumps({"label": "x"})
    vr  = require_json_dict(raw, ["label", "score"])
    assert vr.passed is False
    assert any("score" in e for e in vr.errors)


def test_require_json_dict_fails_non_dict():
    vr = require_json_dict("[1,2,3]", ["key"])
    assert vr.passed is False


def test_require_json_dict_fails_none():
    vr = require_json_dict(None, ["key"])
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# require_non_empty_string
# ─────────────────────────────────────────────────────────────────────────────

def test_require_non_empty_string_passes():
    vr = require_non_empty_string("hello world", "output")
    assert vr.passed is True


def test_require_non_empty_string_fails_none():
    vr = require_non_empty_string(None, "output")
    assert vr.passed is False


def test_require_non_empty_string_fails_empty():
    vr = require_non_empty_string("   ", "output")
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# require_min_word_count
# ─────────────────────────────────────────────────────────────────────────────

def test_require_min_word_count_passes():
    vr = require_min_word_count("one two three four five", 5)
    assert vr.passed is True


def test_require_min_word_count_fails():
    vr = require_min_word_count("only three words", 10)
    assert vr.passed is False
    assert any("3" in e or "minimum" in e.lower() for e in vr.errors)


# ─────────────────────────────────────────────────────────────────────────────
# require_max_word_count
# ─────────────────────────────────────────────────────────────────────────────

def test_require_max_word_count_passes():
    vr = require_max_word_count("short text", 100)
    assert vr.passed is True


def test_require_max_word_count_fails():
    long_text = " ".join(["word"] * 101)
    vr = require_max_word_count(long_text, 100)
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# require_float_in_range
# ─────────────────────────────────────────────────────────────────────────────

def test_require_float_in_range_passes():
    vr = require_float_in_range(0.5, 0.0, 1.0, "score")
    assert vr.passed is True


def test_require_float_in_range_boundary_passes():
    assert require_float_in_range(0.0, 0.0, 1.0).passed is True
    assert require_float_in_range(1.0, 0.0, 1.0).passed is True


def test_require_float_in_range_fails_below():
    vr = require_float_in_range(-0.1, 0.0, 1.0, "score")
    assert vr.passed is False


def test_require_float_in_range_fails_above():
    vr = require_float_in_range(1.1, 0.0, 1.0, "score")
    assert vr.passed is False


def test_require_float_in_range_fails_non_numeric():
    vr = require_float_in_range("not-a-number", 0.0, 1.0, "score")
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# combine
# ─────────────────────────────────────────────────────────────────────────────

def test_combine_all_pass():
    combined = combine(ValidationResult.ok(), ValidationResult.ok())
    assert combined.passed is True
    assert combined.errors == []


def test_combine_one_fail():
    combined = combine(ValidationResult.ok(), ValidationResult.fail("error A"))
    assert combined.passed is False
    assert "error A" in combined.errors


def test_combine_multiple_fail_aggregates_errors():
    combined = combine(
        ValidationResult.fail("error 1"),
        ValidationResult.fail("error 2", "error 3"),
    )
    assert combined.passed is False
    assert len(combined.errors) == 3
    assert "error 1" in combined.errors
    assert "error 2" in combined.errors
    assert "error 3" in combined.errors
