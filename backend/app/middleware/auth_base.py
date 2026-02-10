"""Base authentication backend interface."""
from fastapi import Request
from typing import Optional, Dict, Any


class AuthBackend:
    """Base authentication backend interface."""

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        """
        Authenticate a request.
        Returns user info dict if authenticated, None if not.
        """
        raise NotImplementedError

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user info by ID."""
        raise NotImplementedError
