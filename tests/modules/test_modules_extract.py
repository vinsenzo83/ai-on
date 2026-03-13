"""
tests/modules/test_modules_extract.py
───────────────────────────────────────
Tests for app/modules/modules/extract.py

Coverage
--------
Happy path
  1. Valid JSON with entities + key_value_pairs → validation passes
  2. Plain string → validation passes (accepted)
  3. Dict input with fields builds prompt with field names

Validation failure
  4. None → fails
  5. JSON with empty entities AND empty kv_pairs → fails
  6. Empty string → fails

Normalisation
  7. entities normalised to list of dicts with type/value/span
  8. key_value_pairs cast to string values
  9. Plain string → raw_extractions = raw string, entities = []
  10. Markdown-fenced JSON stripped correctly

Schema / interface
  11. 'extract', 'extraction', 'ner' in task_types
  12. input_schema requires 'text'
"""
from __future__ import annotations

import json

import pytest

from app.modules.modules.extract import ExtractModule
from app.modules.types import ModuleInput


@pytest.fixture
def mod():
    return ExtractModule()


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_happy_path_json(mod):
    raw = json.dumps({
        "entities":       [{"type": "BRAND", "value": "LaneigE", "span": "LaneigE"}],
        "key_value_pairs": {"price": "$25.00", "sku": "LNE-001"},
    })
    vr = mod.validate_output(raw)
    assert vr.passed is True

    out = mod.normalize_output(raw)
    assert len(out["entities"])            == 1
    assert out["entities"][0]["type"]      == "BRAND"
    assert out["key_value_pairs"]["price"] == "$25.00"


def test_extract_plain_string_passes_validation(mod):
    """Modules may return plain text; this should still pass validation."""
    vr = mod.validate_output("BRAND: Laneige; PRICE: $25")
    assert vr.passed is True


def test_extract_dict_input_fields_in_prompt(mod):
    mi = ModuleInput(
        task_type = "extract",
        raw_input = {
            "text":   "Laneige Water Sleeping Mask 70ml for $25",
            "fields": ["brand", "price", "size"],
        },
    )
    prompt   = mod.build_prompt(mi)
    user_msg = prompt["messages"][1]["content"]
    assert "brand" in user_msg
    assert "price" in user_msg
    assert "size"  in user_msg


# ─────────────────────────────────────────────────────────────────────────────
# Validation failure
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_none_fails(mod):
    assert mod.validate_output(None).passed is False


def test_validate_empty_json_extractions_fails(mod):
    raw = json.dumps({"entities": [], "key_value_pairs": {}})
    vr  = mod.validate_output(raw)
    assert vr.passed is False
    assert vr.errors


def test_validate_empty_string_fails(mod):
    vr = mod.validate_output("   ")
    assert vr.passed is False


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_entity_fields(mod):
    raw = json.dumps({
        "entities": [{"type": "PRODUCT", "value": "Mask", "span": "sleeping mask"}],
        "key_value_pairs": {},
    })
    out = mod.normalize_output(raw)
    entity = out["entities"][0]
    assert "type"  in entity
    assert "value" in entity
    assert "span"  in entity


def test_normalize_kv_values_cast_to_str(mod):
    raw = json.dumps({
        "entities": [],
        "key_value_pairs": {"quantity": 3, "price": 25.0},
    })
    out = mod.normalize_output(raw)
    assert out["key_value_pairs"]["quantity"] == "3"
    assert out["key_value_pairs"]["price"]    == "25.0"


def test_normalize_plain_string_fallback(mod):
    raw = "name: Product X, price: $10"
    out = mod.normalize_output(raw)
    assert out["entities"]        == []
    assert out["key_value_pairs"] == {}
    assert out["raw_extractions"] == raw


def test_normalize_strips_markdown_fences(mod):
    payload = {"entities": [{"type": "T", "value": "V", "span": "V"}], "key_value_pairs": {"k": "v"}}
    raw     = "```json\n" + json.dumps(payload) + "\n```"
    vr      = mod.validate_output(raw)
    assert vr.passed is True
    out = mod.normalize_output(raw)
    assert len(out["entities"]) == 1


# ─────────────────────────────────────────────────────────────────────────────
# Schema / interface
# ─────────────────────────────────────────────────────────────────────────────

def test_task_types(mod):
    assert "extract"    in mod.get_task_types()
    assert "extraction" in mod.get_task_types()
    assert "ner"        in mod.get_task_types()


def test_input_schema_requires_text(mod):
    schema = mod.get_input_schema()
    assert "text" in schema.get("required", [])
