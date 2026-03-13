"""tests/tools/test_tool_validators.py – Phase 15 shared validators tests."""
from __future__ import annotations

import pytest

from app.tools.types      import ToolValidationResult
from app.tools.validators import (
    combine,
    require_bytes,
    require_dict,
    require_int_in_range,
    require_keys,
    require_list,
    require_non_empty_string,
    require_param,
    require_url,
)


class TestCombine:
    def test_all_pass(self):
        r = combine(ToolValidationResult.ok(), ToolValidationResult.ok())
        assert r.passed

    def test_one_fail(self):
        r = combine(ToolValidationResult.ok(), ToolValidationResult.fail("bad"))
        assert not r.passed
        assert "bad" in r.errors

    def test_all_fail_collects_all_errors(self):
        r = combine(
            ToolValidationResult.fail("e1"),
            ToolValidationResult.fail("e2"),
        )
        assert not r.passed
        assert len(r.errors) == 2


class TestRequireNonEmptyString:
    def test_valid(self):
        assert require_non_empty_string("hello").passed

    def test_empty_fails(self):
        r = require_non_empty_string("", "query")
        assert not r.passed
        assert "query" in r.errors[0]

    def test_whitespace_only_fails(self):
        assert not require_non_empty_string("   ").passed

    def test_not_a_string_fails(self):
        assert not require_non_empty_string(123, "field").passed

    def test_min_length_enforced(self):
        r = require_non_empty_string("ab", "field", min_length=5)
        assert not r.passed


class TestRequireUrl:
    def test_valid_https(self):
        assert require_url("https://example.com").passed

    def test_valid_http(self):
        assert require_url("http://example.com").passed

    def test_missing_scheme_fails(self):
        r = require_url("example.com", "url")
        assert not r.passed
        assert "url" in r.errors[0]

    def test_empty_fails(self):
        assert not require_url("").passed

    def test_non_string_fails(self):
        assert not require_url(None).passed


class TestRequireDict:
    def test_valid(self):
        assert require_dict({"a": 1}).passed

    def test_list_fails(self):
        assert not require_dict([1, 2]).passed

    def test_none_fails(self):
        assert not require_dict(None).passed


class TestRequireList:
    def test_valid(self):
        assert require_list([1, 2, 3]).passed

    def test_empty_list_passes_with_default(self):
        assert require_list([]).passed

    def test_min_items_fails(self):
        r = require_list([1], min_items=3)
        assert not r.passed

    def test_non_list_fails(self):
        assert not require_list("not a list").passed


class TestRequireKeys:
    def test_all_present(self):
        assert require_keys({"a": 1, "b": 2}, ["a", "b"]).passed

    def test_missing_key(self):
        r = require_keys({"a": 1}, ["a", "b"])
        assert not r.passed
        assert "b" in r.errors[0]

    def test_extra_keys_ok(self):
        assert require_keys({"a": 1, "b": 2, "c": 3}, ["a"]).passed


class TestRequireIntInRange:
    def test_valid(self):
        assert require_int_in_range(5, 1, 10).passed

    def test_at_boundary(self):
        assert require_int_in_range(1, 1, 10).passed
        assert require_int_in_range(10, 1, 10).passed

    def test_out_of_range(self):
        assert not require_int_in_range(0, 1, 10).passed
        assert not require_int_in_range(11, 1, 10).passed

    def test_non_int_fails(self):
        assert not require_int_in_range("5", 1, 10).passed


class TestRequireBytes:
    def test_valid(self):
        assert require_bytes(b"hello").passed

    def test_empty_fails(self):
        assert not require_bytes(b"").passed

    def test_bytearray_passes(self):
        assert require_bytes(bytearray(b"data")).passed

    def test_non_bytes_fails(self):
        assert not require_bytes("string", "content").passed

    def test_min_size(self):
        r = require_bytes(b"ab", min_size=5)
        assert not r.passed


class TestRequireParam:
    def test_present(self):
        assert require_param({"key": "value"}, "key").passed

    def test_missing(self):
        r = require_param({}, "key")
        assert not r.passed
        assert "key" in r.errors[0]

    def test_wrong_type(self):
        r = require_param({"key": 123}, "key", param_type=str)
        assert not r.passed

    def test_correct_type(self):
        assert require_param({"key": "val"}, "key", param_type=str).passed
