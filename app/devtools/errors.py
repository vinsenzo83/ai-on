"""
app/devtools/errors.py
──────────────────────
Phase 16 — Developer Assist Tooling Layer.

Custom exceptions raised by developer tool implementations.
ToolExecutor catches all of these and maps them to DevToolResult.
"""
from __future__ import annotations

from app.devtools.types import DevToolErrorCode


class DevToolError(Exception):
    """
    Base exception for all developer-tool failures.

    Attributes
    ----------
    message    : str – human-readable description
    error_code : str – one of DevToolErrorCode constants
    retryable  : bool – hint for caller retry logic
    """

    def __init__(
        self,
        message:    str,
        error_code: str  = DevToolErrorCode.ACTION_FAILED,
        retryable:  bool = False,
    ) -> None:
        super().__init__(message)
        self.message    = message
        self.error_code = error_code
        self.retryable  = retryable


class PermissionError_(DevToolError):
    """Raised when the requested operation is blocked by mode/safety rules."""
    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(
            message,
            error_code = DevToolErrorCode.PERMISSION_DENIED,
            retryable  = retryable,
        )


class PathUnsafeError(DevToolError):
    """Raised when a path escapes the allowed workspace root."""
    def __init__(self, path: str) -> None:
        super().__init__(
            f"Path is outside workspace root: {path!r}",
            error_code = DevToolErrorCode.PATH_UNSAFE,
        )


class PathNotFoundError(DevToolError):
    """Raised when a required path does not exist."""
    def __init__(self, path: str) -> None:
        super().__init__(
            f"Path not found: {path!r}",
            error_code = DevToolErrorCode.PATH_NOT_FOUND,
        )


class CommandBlockedError(DevToolError):
    """Raised when a shell command matches the block-list."""
    def __init__(self, command: str) -> None:
        super().__init__(
            f"Command is not allowed: {command!r}",
            error_code = DevToolErrorCode.COMMAND_BLOCKED,
        )


class TimeoutError_(DevToolError):
    """Raised when an operation exceeds its timeout."""
    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            error_code = DevToolErrorCode.TIMEOUT,
            retryable  = True,
        )


class DependencyError(DevToolError):
    """Raised when a required external binary / package is missing."""
    def __init__(self, dep: str) -> None:
        super().__init__(
            f"Required dependency not available: {dep!r}",
            error_code = DevToolErrorCode.DEPENDENCY_ERROR,
        )
