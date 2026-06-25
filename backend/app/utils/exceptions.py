"""
Domain exceptions for application-layer error propagation (srdev2 A2).

Routers and FastAPI exception handlers map these to HTTP status codes.
Prefer raising these from services/validation over ad-hoc HTTPException
deep in the stack so layering stays consistent.
"""
from __future__ import annotations

from typing import Any, Optional


class OpenVoxError(Exception):
    """Base domain error. ``http_status`` drives the API mapping."""

    http_status: int = 500
    code: str = "internal_error"

    def __init__(self, message: str = "An error occurred", *, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details

    def to_detail(self) -> Any:
        """Safe payload for HTTPException.detail (no secrets by convention)."""
        if self.details is None:
            return self.message
        return {"message": self.message, "details": self.details, "code": self.code}


class ValidationAppError(OpenVoxError):
    """Input failed validation (maps to HTTP 400)."""

    http_status = 400
    code = "validation_error"


class NotFoundError(OpenVoxError):
    http_status = 404
    code = "not_found"


class PermissionDeniedError(OpenVoxError):
    http_status = 403
    code = "permission_denied"


class CommandExecutionError(OpenVoxError):
    """Privileged command / Bolt / sudo failure (maps to HTTP 500 by default)."""

    http_status = 500
    code = "command_execution_error"

    def __init__(
        self,
        message: str = "Command execution failed",
        *,
        returncode: Optional[int] = None,
        details: Any = None,
    ):
        super().__init__(message, details=details)
        self.returncode = returncode


class ExternalServiceError(OpenVoxError):
    """PuppetDB / Puppet Server / remote HTTP failure."""

    http_status = 502
    code = "external_service_error"


class ConfigurationError(OpenVoxError):
    """Misconfiguration or unsafe path / settings."""

    http_status = 500
    code = "configuration_error"
