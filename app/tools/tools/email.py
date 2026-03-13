"""
app/tools/tools/email.py
────────────────────────
Phase 15 — Tool integration layer.

EmailTool: send, parse, and validate email messages.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  send          – send an email via SMTP
  parse         – parse a raw email (RFC 2822) and return structured fields
  validate_addr – validate an email address format

Input params
────────────
  send:
    to       : str | list[str]  – recipient(s) (required)
    subject  : str              – subject line (required)
    body     : str              – message body (required)
    from_addr: str              – sender address (optional, falls back to config)
    html     : bool             – body is HTML (default False)

  parse:
    raw      : str              – raw RFC 2822 email string (required)

  validate_addr:
    address  : str              – email address to validate (required)

Normalized output shape
───────────────────────
  send:
    { "sent": bool, "to": list[str], "subject": str, "message_id": str }

  parse:
    { "from": str, "to": list[str], "subject": str, "date": str,
      "body_text": str, "body_html": str, "headers": dict }

  validate_addr:
    { "address": str, "valid": bool, "reason": str }

Design notes
────────────
  • SMTP sender is injected via ``smtp_sender`` factory for testability.
  • When smtp_sender is None the tool uses Python stdlib smtplib.
  • Config (host, port, user, password) is read from env vars at send-time.
  • Production: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD.
"""
from __future__ import annotations

import email as stdlib_email
import os
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from typing import Any, Callable

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_non_empty_string, require_param

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS   = ["send", "parse", "validate_addr"]
_EMAIL_RE            = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class EmailTool(BaseTool):
    """Email send / parse / validate tool."""

    def __init__(self, smtp_sender: Callable | None = None) -> None:
        """
        Parameters
        ----------
        smtp_sender : optional async/sync callable(msg_dict) → message_id str.
                      When None, stdlib smtplib is used.
        """
        self._smtp_sender = smtp_sender

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "email"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "send": {
                "to":       {"type": "string|list", "required": True},
                "subject":  {"type": "string",      "required": True},
                "body":     {"type": "string",       "required": True},
                "from_addr":{"type": "string",       "required": False},
                "html":     {"type": "boolean",      "required": False, "default": False},
            },
            "parse":        {"raw":     {"type": "string", "required": True}},
            "validate_addr":{"address": {"type": "string", "required": True}},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "send":         {"sent": "bool", "to": "list[str]", "subject": "str", "message_id": "str"},
            "parse":        {"from": "str", "to": "list[str]", "subject": "str", "date": "str",
                             "body_text": "str", "body_html": "str", "headers": "dict"},
            "validate_addr":{"address": "str", "valid": "bool", "reason": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        if action == "send":
            to = p.get("to", "")
            to_check = (
                require_param(p, "to")
                if "to" in p
                else ToolValidationResult.fail("Missing required param: 'to'")
            )
            return combine(
                to_check,
                require_param(p, "subject", param_type=str),
                require_param(p, "body",    param_type=str),
                require_non_empty_string(p.get("subject", ""), "subject"),
                require_non_empty_string(p.get("body",    ""), "body"),
            )

        elif action == "parse":
            return combine(
                require_param(p, "raw", param_type=str),
                require_non_empty_string(p.get("raw", ""), "raw"),
            )

        elif action == "validate_addr":
            return combine(
                require_param(p, "address", param_type=str),
                require_non_empty_string(p.get("address", ""), "address"),
            )

        return ToolValidationResult.fail(f"Unknown action: {action}")

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "action" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'action' key")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        action = tool_input.action
        p      = tool_input.params

        logger.info("email_tool.execute", action=action)

        if action == "send":
            return await self._send(p)
        elif action == "parse":
            return self._parse(p["raw"], action)
        elif action == "validate_addr":
            return self._validate_addr(p["address"], action)
        else:
            raise ToolActionError(
                f"Unsupported action: {action}",
                error_code=ToolErrorCode.UNSUPPORTED_ACTION,
            )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        action = raw_output.get("action", "")

        if action == "send":
            to = raw_output.get("to", [])
            if isinstance(to, str):
                to = [to]
            return {
                "sent":       raw_output.get("sent", False),
                "to":         to,
                "subject":    raw_output.get("subject", ""),
                "message_id": raw_output.get("message_id", ""),
            }

        elif action == "parse":
            msg = raw_output.get("parsed", {})
            return {
                "from":      msg.get("from",      ""),
                "to":        msg.get("to",        []),
                "subject":   msg.get("subject",   ""),
                "date":      msg.get("date",      ""),
                "body_text": msg.get("body_text", ""),
                "body_html": msg.get("body_html", ""),
                "headers":   msg.get("headers",   {}),
            }

        elif action == "validate_addr":
            return {
                "address": raw_output.get("address", ""),
                "valid":   raw_output.get("valid",   False),
                "reason":  raw_output.get("reason",  ""),
            }

        return raw_output

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _send(self, params: dict[str, Any]) -> dict[str, Any]:
        to = params["to"]
        if isinstance(to, str):
            to = [to]

        subject   = params["subject"]
        body      = params["body"]
        from_addr = params.get("from_addr") or os.getenv("SMTP_FROM", "noreply@kbeauty.local")
        is_html   = bool(params.get("html", False))

        if self._smtp_sender is not None:
            # Injected sender (tests / alternative backends)
            message_id = await self._call_smtp_sender(
                {"to": to, "from": from_addr, "subject": subject,
                 "body": body, "html": is_html}
            )
        else:
            message_id = self._send_via_smtplib(
                to, from_addr, subject, body, is_html
            )

        return {
            "action":     "send",
            "sent":       True,
            "to":         to,
            "subject":    subject,
            "message_id": message_id,
        }

    async def _call_smtp_sender(self, msg_dict: dict) -> str:
        import inspect
        if inspect.iscoroutinefunction(self._smtp_sender):
            return await self._smtp_sender(msg_dict)
        return self._smtp_sender(msg_dict)

    def _send_via_smtplib(
        self,
        to:        list[str],
        from_addr: str,
        subject:   str,
        body:      str,
        is_html:   bool,
    ) -> str:
        import smtplib

        host     = os.getenv("SMTP_HOST", "localhost")
        port     = int(os.getenv("SMTP_PORT", "25"))
        user     = os.getenv("SMTP_USER",     "")
        password = os.getenv("SMTP_PASSWORD", "")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = from_addr
        msg["To"]      = ", ".join(to)

        mime_type = "html" if is_html else "plain"
        msg.attach(MIMEText(body, mime_type, "utf-8"))

        try:
            with smtplib.SMTP(host, port, timeout=10) as server:
                if user:
                    server.login(user, password)
                server.sendmail(from_addr, to, msg.as_string())
        except Exception as exc:
            raise ToolActionError(
                f"SMTP send failed: {exc}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            ) from exc

        return msg.get("Message-ID", f"<{id(msg)}@kbeauty.local>")

    def _parse(self, raw: str, action: str) -> dict[str, Any]:
        try:
            msg = stdlib_email.message_from_string(raw)
        except Exception as exc:
            raise ToolActionError(
                f"Failed to parse email: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

        to_header = msg.get("To", "")
        to_list   = [a.strip() for a in to_header.split(",") if a.strip()]

        body_text = ""
        body_html = ""
        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/plain" and not body_text:
                    body_text = part.get_payload(decode=True).decode("utf-8", errors="replace")
                elif ct == "text/html" and not body_html:
                    body_html = part.get_payload(decode=True).decode("utf-8", errors="replace")
        else:
            ct = msg.get_content_type()
            payload = msg.get_payload(decode=True)
            if payload:
                decoded = payload.decode("utf-8", errors="replace")
                if ct == "text/html":
                    body_html = decoded
                else:
                    body_text = decoded

        headers = {k: v for k, v in msg.items()}

        return {
            "action": action,
            "parsed": {
                "from":      msg.get("From",    ""),
                "to":        to_list,
                "subject":   msg.get("Subject", ""),
                "date":      msg.get("Date",    ""),
                "body_text": body_text,
                "body_html": body_html,
                "headers":   headers,
            },
        }

    def _validate_addr(self, address: str, action: str) -> dict[str, Any]:
        if _EMAIL_RE.match(address.strip()):
            return {"action": action, "address": address, "valid": True,  "reason": ""}
        return {
            "action":  action,
            "address": address,
            "valid":   False,
            "reason":  "Does not match email format (local@domain.tld)",
        }
