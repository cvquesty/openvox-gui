"""
Security middleware, response headers, and rate limiting configuration.

This module provides three security layers:

1. SecurityHeadersMiddleware — Adds defence-in-depth HTTP response headers
   to every response (HSTS, X-Frame-Options, CSP, Referrer-Policy, etc.).
   These headers instruct the browser to enforce strict security policies
   that mitigate XSS, clickjacking, MIME-sniffing, and data-leak attacks.

2. Rate limiting — Uses the slowapi library (built on top of limits) to
   throttle request rates per client IP. Three tiers are defined:
     - rate_limit_auth:  5 requests/minute  (login, password changes)
     - rate_limit_api:   60 requests/minute (general API calls)
     - rate_limit_heavy: 10 requests/minute (PQL queries, deployments)

3. Utility functions for generating cryptographic secrets used during
   installation and configuration.

Content Security Policy notes:
  - 'unsafe-inline' is required for script-src because Mantine UI (and
    some Vite-injected helpers) uses inline event handlers and styles.
  - 'unsafe-eval' has been deliberately REMOVED. Production Vite builds
    do not use eval(), so allowing it would only widen the XSS attack
    surface with no benefit. If a third-party library is later added that
    requires eval, it should be loaded via a web worker or a separate
    domain instead of weakening the CSP.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from typing import Callable
import hashlib
import secrets


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that adds security headers to every HTTP response.

    These headers are the last line of defence if application-level
    sanitisation fails. They instruct the browser to:
      - Refuse to render the page inside an iframe (clickjacking protection)
      - Refuse to MIME-sniff the content type
      - Enable the browser's built-in XSS filter
      - Only communicate over HTTPS for the next year (HSTS)
      - Restrict which origins can load scripts, styles, images, etc. (CSP)
      - Prevent the Referer header from leaking full URLs to other origins
      - Deny access to device APIs (geolocation, microphone, camera)
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        # ── Standard security headers ──────────────────────────
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # ── Content Security Policy ────────────────────────────
        # Each directive is documented with why it is set to its
        # current value so that future maintainers can make informed
        # decisions about tightening or loosening constraints.
        csp_directives = [
            # Only allow resources from the same origin by default.
            "default-src 'self'",

            # Scripts: 'unsafe-inline' is required because Mantine UI
            # injects inline event handlers at runtime. 'unsafe-eval' is
            # deliberately NOT included — Vite production builds do not
            # use eval(), and omitting it blocks a major XSS vector.
            "script-src 'self' 'unsafe-inline'",

            # Styles: 'unsafe-inline' is required because Mantine and
            # Emotion (its CSS-in-JS engine) inject <style> tags at
            # runtime for component styling.
            "style-src 'self' 'unsafe-inline'",

            # Images from the same origin, data: URIs (inline SVGs), and
            # any HTTPS source (for external badge/status images).
            "img-src 'self' data: https:",

            # Fonts from the same origin and data: URIs (base64 fonts).
            "font-src 'self' data:",

            # Fetch/XHR/WebSocket connections only to the same origin.
            "connect-src 'self'",

            # Prevent the page from being embedded in any iframe.
            "frame-ancestors 'none'",

            # Restrict the <base> tag to same-origin to prevent base-URI
            # injection attacks.
            "base-uri 'self'",

            # Restrict form submissions to same-origin.
            "form-action 'self'",
        ]
        response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

        return response


def generate_secret_key() -> str:
    """Generate a cryptographically secure random string suitable for use
    as a JWT signing key. Produces 32 bytes of randomness encoded as a
    URL-safe base64 string (43 characters).

    Called by the install script to populate OPENVOX_GUI_SECRET_KEY in
    the .env configuration file.
    """
    return secrets.token_urlsafe(32)


def hash_password_salt() -> str:
    """Generate a random 256-bit salt encoded as a hex string.

    This is a utility for the install script and is not used by the
    application at runtime (bcrypt generates its own salts internally).
    """
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


# ── Rate limiting ──────────────────────────────────────────────
# The limiter uses the client's IP address (via X-Forwarded-For when
# behind a reverse proxy) as the rate-limiting key. Rate limits are
# defined as decorators that can be applied to individual route handlers.

limiter = Limiter(key_func=get_remote_address)


def rate_limit_auth():
    """Strict rate limit for authentication endpoints.

    5 requests per minute per IP. This makes brute-force password guessing
    impractical while still allowing legitimate users who mistype their
    password a few times.
    """
    return limiter.limit("5/minute")


def rate_limit_api():
    """Standard rate limit for general API endpoints.

    60 requests per minute per IP. This is generous enough for normal UI
    usage (which typically makes 5-10 requests per page load) but prevents
    runaway scripts from overwhelming the backend.
    """
    return limiter.limit("60/minute")


def rate_limit_heavy():
    """Restrictive rate limit for resource-intensive endpoints.

    10 requests per minute per IP. Applied to PQL queries, code
    deployments, and Bolt execution — operations that are expensive on
    the server side and should not be called in tight loops.
    """
    return limiter.limit("10/minute")