"""
Security middleware to add security headers and implement rate limiting.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from typing import Callable
import hashlib
import secrets


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        # Content Security Policy
        csp_directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  # Required for React
            "style-src 'self' 'unsafe-inline'",  # Required for inline styles
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ]
        response.headers["Content-Security-Policy"] = "; ".join(csp_directives)
        
        return response


def generate_secret_key() -> str:
    """Generate a secure secret key for JWT signing."""
    return secrets.token_urlsafe(32)


def hash_password_salt() -> str:
    """Generate a salt for password hashing."""
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


# Rate limiter for API endpoints
limiter = Limiter(key_func=get_remote_address)


# Rate limit decorators for different endpoint types
def rate_limit_auth():
    """Rate limit for authentication endpoints (stricter)."""
    return limiter.limit("5/minute")


def rate_limit_api():
    """Rate limit for general API endpoints."""
    return limiter.limit("60/minute")


def rate_limit_heavy():
    """Rate limit for resource-intensive endpoints."""
    return limiter.limit("10/minute")