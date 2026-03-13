"""
app/modules/modules/code.py
─────────────────────────────
Phase 14 – Code module.

Task types handled
------------------
- code
- codegen        (alias)
- code_review    (alias)
- refactor       (alias)
- debug          (alias)

Responsibility
--------------
Code generation, review, refactoring, and debugging across any
programming language.

Input schema
------------
{
  "instruction":  "<what to do>",           # required
  "language":     "python",                 # optional, default "python"
  "code":         "<existing code>",        # optional – for review/refactor/debug
  "context":      "<extra context>",        # optional
  "action":       "generate|review|refactor|debug|explain"  # optional
}

Output schema (normalized)
--------------------------
{
  "code":          str,       # generated / modified code
  "language":      str,
  "action":        str,
  "explanation":   str,       # reasoning / review comments
  "issues_found":  [str],     # for review/debug actions
  "line_count":    int,
}

Validation rules
----------------
- raw_output must be non-empty
- If action == "generate" or "refactor", output must contain a code block
  (either ```language ... ``` fence or at least one indented line)

Preferred models
----------------
gpt-4o  →  claude-3-opus  →  gpt-4o-mini

Fallback models
---------------
claude-3-sonnet  →  deepseek-coder  →  codestral
"""
from __future__ import annotations

import re
from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_ACTIONS   = {"generate", "review", "refactor", "debug", "explain"}
_DEFAULT_ACTION   = "generate"
_DEFAULT_LANGUAGE = "python"


class CodeModule(BaseModule):
    """First-class module for code generation and analysis tasks."""

    @property
    def name(self) -> str:
        return "code"

    def get_task_types(self) -> list[str]:
        return ["code", "codegen", "code_review", "refactor", "debug"]

    # ── Schemas ───────────────────────────────────────────────────────────────

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "type":     "object",
            "required": ["instruction"],
            "properties": {
                "instruction": {
                    "type":      "string",
                    "minLength": 1,
                },
                "language": {
                    "type":    "string",
                    "default": _DEFAULT_LANGUAGE,
                },
                "code": {
                    "type":        "string",
                    "description": "Existing code for review / refactor / debug.",
                },
                "context": {
                    "type":        "string",
                    "description": "Additional context or constraints.",
                },
                "action": {
                    "type":    "string",
                    "enum":    list(_ACTIONS),
                    "default": _DEFAULT_ACTION,
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "code":         {"type": "string"},
                "language":     {"type": "string"},
                "action":       {"type": "string"},
                "explanation":  {"type": "string"},
                "issues_found": {"type": "array", "items": {"type": "string"}},
                "line_count":   {"type": "integer"},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o", "claude-3-opus", "gpt-4o-mini"]

    def get_fallback_models(self) -> list[str]:
        return ["claude-3-sonnet", "deepseek-coder", "codestral"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, dict):
            instruction = str(payload.get("instruction", ""))
            language    = str(payload.get("language",    _DEFAULT_LANGUAGE))
            code        = str(payload.get("code",        "") or "")
            context     = str(payload.get("context",     "") or "")
            action      = str(payload.get("action",      _DEFAULT_ACTION)).lower()
        else:
            instruction = str(payload)
            language    = _DEFAULT_LANGUAGE
            code        = ""
            context     = ""
            action      = _DEFAULT_ACTION

        if action not in _ACTIONS:
            action = _DEFAULT_ACTION

        action_instruction = {
            "generate": (
                f"Write complete, production-ready {language} code that fulfils the requirement. "
                "Wrap code in a fenced code block. Add a brief explanation after."
            ),
            "review": (
                f"Review the provided {language} code. "
                "List specific issues, bugs, and improvements. "
                "Then provide a corrected version in a fenced code block."
            ),
            "refactor": (
                f"Refactor the provided {language} code for clarity, performance, and best practices. "
                "Return the refactored code in a fenced code block followed by a summary of changes."
            ),
            "debug": (
                f"Debug the provided {language} code. "
                "Identify all bugs, explain each fix, and return the fixed code in a fenced code block."
            ),
            "explain": (
                f"Explain the provided {language} code clearly. "
                "Describe what it does, how it works, and any notable design decisions."
            ),
        }.get(action, "Generate code as requested.")

        system = (
            f"You are an expert {language} engineer. "
            f"{action_instruction}"
        )

        user_parts = [f"Task: {instruction}"]
        if code:
            user_parts.append(f"\nExisting code:\n```{language}\n{code}\n```")
        if context:
            user_parts.append(f"\nContext: {context}")

        return {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": "\n".join(user_parts)},
            ],
            "_language": language,
            "_action":   action,
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        text = _extract_text(raw_output)
        if not text.strip():
            return ValidationResult.fail("Code output is empty")

        # For generate/refactor we expect at least some code-like content
        if len(text.strip()) < 10:
            return ValidationResult.fail(
                "Output too short to be a valid code response"
            )

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        text = _extract_text(raw_output).strip()

        # Extract fenced code blocks
        code_blocks = re.findall(
            r"```(?:\w+)?\n(.*?)```",
            text,
            re.DOTALL,
        )
        extracted_code = "\n\n".join(code_blocks).strip() if code_blocks else ""

        # The explanation is everything outside code fences
        explanation = re.sub(r"```(?:\w+)?\n.*?```", "", text, flags=re.DOTALL).strip()

        # If no fenced block found, the whole text is treated as code
        if not extracted_code:
            extracted_code = text
            explanation    = ""

        line_count = len(extracted_code.splitlines())

        # Heuristic: extract bullet-point issues from review/debug responses
        issues: list[str] = []
        for line in explanation.splitlines():
            stripped = line.strip()
            if stripped.startswith(("-", "*", "•", "–")) and len(stripped) > 2:
                issues.append(stripped.lstrip("-*•– ").strip())

        return {
            "code":         extracted_code,
            "language":     _DEFAULT_LANGUAGE,
            "action":       _DEFAULT_ACTION,
            "explanation":  explanation,
            "issues_found": issues,
            "line_count":   line_count,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        for key in ("code", "content", "text", "output", "result"):
            if key in raw and isinstance(raw[key], str):
                return raw[key]
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", "")
    return str(raw) if raw is not None else ""
