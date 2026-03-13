"""tests/tools/test_tools_email.py – Phase 15 EmailTool tests."""
from __future__ import annotations

import pytest

from app.tools.tools.email import EmailTool
from app.tools.types       import ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _mock_smtp_sender(msg_dict: dict) -> str:
    return "<mock-message-id@kbeauty.local>"


_RAW_EMAIL = """\
From: sender@example.com
To: recipient@example.com
Subject: Test Order Notification
Date: Thu, 12 Mar 2026 10:00:00 +0000
Content-Type: text/plain

Hello, your order has been processed.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailToolContract:
    def test_name(self):
        assert EmailTool().name == "email"

    def test_actions(self):
        actions = EmailTool().get_actions()
        assert "send"          in actions
        assert "parse"         in actions
        assert "validate_addr" in actions

    def test_can_handle(self):
        t = EmailTool()
        assert t.can_handle("send")    is True
        assert t.can_handle("unknown") is False


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailToolValidation:
    def test_send_valid(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "send",
            params    = {
                "to":      "user@example.com",
                "subject": "Order Update",
                "body":    "Your order is ready.",
            },
        )
        r = EmailTool().validate_input(ti)
        assert r.passed

    def test_send_missing_to(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "send",
            params    = {"subject": "Hi", "body": "Hello"},
        )
        r = EmailTool().validate_input(ti)
        assert not r.passed

    def test_send_empty_subject(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "send",
            params    = {"to": "a@b.com", "subject": "", "body": "test"},
        )
        r = EmailTool().validate_input(ti)
        assert not r.passed

    def test_parse_valid(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "parse",
            params    = {"raw": _RAW_EMAIL},
        )
        r = EmailTool().validate_input(ti)
        assert r.passed

    def test_parse_empty_raw(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "parse",
            params    = {"raw": ""},
        )
        r = EmailTool().validate_input(ti)
        assert not r.passed

    def test_validate_addr_valid(self):
        ti = ToolInput(
            tool_name = "email",
            action    = "validate_addr",
            params    = {"address": "user@domain.com"},
        )
        r = EmailTool().validate_input(ti)
        assert r.passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailToolHappyPath:
    @pytest.mark.asyncio
    async def test_send_success(self):
        tool = EmailTool(smtp_sender=_mock_smtp_sender)
        ti   = ToolInput(
            tool_name = "email",
            action    = "send",
            params    = {
                "to":      "buyer@example.com",
                "subject": "Your K-Beauty order",
                "body":    "Thank you for your order!",
            },
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["sent"]             is True
        assert "buyer@example.com"            in normalized["to"]
        assert normalized["subject"]          == "Your K-Beauty order"
        assert len(normalized["message_id"])  > 0

    @pytest.mark.asyncio
    async def test_send_list_recipients(self):
        tool = EmailTool(smtp_sender=_mock_smtp_sender)
        ti   = ToolInput(
            tool_name = "email",
            action    = "send",
            params    = {
                "to":      ["a@example.com", "b@example.com"],
                "subject": "Bulk notification",
                "body":    "Hello everyone",
            },
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)
        assert len(normalized["to"]) == 2

    @pytest.mark.asyncio
    async def test_parse_email(self):
        tool = EmailTool()
        ti   = ToolInput(
            tool_name = "email",
            action    = "parse",
            params    = {"raw": _RAW_EMAIL},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["from"]      == "sender@example.com"
        assert "recipient@example.com" in normalized["to"]
        assert normalized["subject"]   == "Test Order Notification"
        assert "order has been processed" in normalized["body_text"]

    @pytest.mark.asyncio
    async def test_validate_addr_valid(self):
        tool = EmailTool()
        ti   = ToolInput(
            tool_name = "email",
            action    = "validate_addr",
            params    = {"address": "valid@example.com"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)
        assert normalized["valid"] is True

    @pytest.mark.asyncio
    async def test_validate_addr_invalid(self):
        tool = EmailTool()
        ti   = ToolInput(
            tool_name = "email",
            action    = "validate_addr",
            params    = {"address": "not-an-email"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)
        assert normalized["valid"]  is False
        assert len(normalized["reason"]) > 0


# ─────────────────────────────────────────────────────────────────────────────
# Output validation
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailToolOutputValidation:
    def test_valid_output(self):
        r = EmailTool().validate_output({"action": "send", "sent": True})
        assert r.passed

    def test_missing_action(self):
        r = EmailTool().validate_output({"sent": True})
        assert not r.passed

    def test_non_dict_fails(self):
        r = EmailTool().validate_output("string output")
        assert not r.passed
