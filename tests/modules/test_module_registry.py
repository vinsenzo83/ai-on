"""
tests/modules/test_module_registry.py
───────────────────────────────────────
Unit tests for app/modules/registry.py

Coverage
--------
1. test_get_registry_returns_singleton      – lru_cache guarantees one instance
2. test_all_7_modules_registered            – all first-class modules present
3. test_resolve_by_task_type               – known task types resolve correctly
4. test_resolve_unknown_task_type_raises   – KeyError on unknown type
5. test_resolve_or_none_returns_none       – no raise on missing type
6. test_has_task_type                      – boolean check works
7. test_known_task_types_sorted            – returns sorted list
8. test_resolve_by_name                    – module name lookup
9. test_resolve_by_name_unknown_raises     – KeyError on unknown name
10. test_custom_registry_isolated          – custom instance doesn't pollute global
"""
from __future__ import annotations

import pytest

from app.modules.registry import ModuleRegistry, get_registry
from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# Minimal stub module for isolation tests
# ─────────────────────────────────────────────────────────────────────────────

class _StubModule(BaseModule):
    def __init__(self, name: str, task_types: list[str]):
        self._name       = name
        self._task_types = task_types

    @property
    def name(self) -> str:
        return self._name

    def get_task_types(self):             return self._task_types
    def get_input_schema(self):           return {}
    def get_output_schema(self):          return {}
    def get_preferred_models(self):       return ["stub-model"]
    def get_fallback_models(self):        return []
    def build_prompt(self, mi):           return "stub prompt"
    def validate_output(self, raw):       return ValidationResult.ok()
    def normalize_output(self, raw):      return raw


# ─────────────────────────────────────────────────────────────────────────────
# Tests – global registry singleton
# ─────────────────────────────────────────────────────────────────────────────

def test_get_registry_returns_singleton():
    r1 = get_registry()
    r2 = get_registry()
    assert r1 is r2


def test_all_7_modules_registered():
    registry      = get_registry()
    expected_names = {"classify", "summarize", "translate", "extract",
                      "analysis", "document", "code"}
    actual_names  = {m.name for m in registry.all_modules()}
    assert expected_names == actual_names


@pytest.mark.parametrize("task_type,expected_module", [
    ("classify",    "classify"),
    ("categorise",  "classify"),   # alias
    ("summarize",   "summarize"),
    ("summarise",   "summarize"),  # British alias
    ("translate",   "translate"),
    ("translation", "translate"),
    ("extract",     "extract"),
    ("extraction",  "extract"),
    ("ner",         "extract"),
    ("analysis",    "analysis"),
    ("analyse",     "analysis"),
    ("analyze",     "analysis"),
    ("sentiment",   "analysis"),
    ("document",    "document"),
    ("docs",        "document"),
    ("docgen",      "document"),
    ("readme",      "document"),
    ("report",      "document"),
    ("code",        "code"),
    ("codegen",     "code"),
    ("code_review", "code"),
    ("refactor",    "code"),
    ("debug",       "code"),
])
def test_resolve_by_task_type(task_type, expected_module):
    registry = get_registry()
    module   = registry.resolve(task_type)
    assert module.name == expected_module


def test_resolve_unknown_task_type_raises():
    registry = get_registry()
    with pytest.raises(KeyError, match="No module registered"):
        registry.resolve("nonexistent_task_xyz")


def test_resolve_or_none_returns_none():
    registry = get_registry()
    result   = registry.resolve_or_none("totally_unknown_task")
    assert result is None


def test_has_task_type_true():
    registry = get_registry()
    assert registry.has_task_type("classify") is True


def test_has_task_type_false():
    registry = get_registry()
    assert registry.has_task_type("DOES_NOT_EXIST") is False


def test_has_task_type_case_insensitive():
    registry = get_registry()
    assert registry.has_task_type("CLASSIFY") is True
    assert registry.has_task_type("Summarize") is True


def test_known_task_types_sorted():
    registry = get_registry()
    types    = registry.known_task_types()
    assert types == sorted(types)


def test_resolve_by_name():
    registry = get_registry()
    module   = registry.resolve_by_name("classify")
    assert module.name == "classify"


def test_resolve_by_name_unknown_raises():
    registry = get_registry()
    with pytest.raises(KeyError, match="No module named"):
        registry.resolve_by_name("ghost_module")


# ─────────────────────────────────────────────────────────────────────────────
# Tests – custom registry isolation
# ─────────────────────────────────────────────────────────────────────────────

def test_custom_registry_has_only_stub_modules():
    stub_a = _StubModule("alpha", ["alpha_task"])
    stub_b = _StubModule("beta",  ["beta_task", "beta_alias"])
    registry = ModuleRegistry([stub_a, stub_b])

    assert registry.has_task_type("alpha_task")  is True
    assert registry.has_task_type("beta_alias")  is True
    assert registry.has_task_type("classify")    is False


def test_custom_registry_resolve():
    stub = _StubModule("zeta", ["zeta_task"])
    registry = ModuleRegistry([stub])
    assert registry.resolve("zeta_task").name == "zeta"


def test_custom_registry_does_not_pollute_global():
    """Global registry must not be affected by a locally-created one."""
    local = ModuleRegistry([_StubModule("temp", ["temp_task"])])
    global_registry = get_registry()
    assert not global_registry.has_task_type("temp_task")


def test_all_modules_deduplicates():
    stub = _StubModule("dup", ["dup_task"])
    # Register same module twice (will warn but not duplicate in all_modules)
    registry = ModuleRegistry([stub, stub])
    names = [m.name for m in registry.all_modules()]
    assert names.count("dup") == 1
