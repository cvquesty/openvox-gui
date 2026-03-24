"""
Authentication Middleware Package

This package provides a pluggable authentication system supporting multiple
authentication backends. The middleware intercepts requests and validates
credentials before allowing access to protected endpoints.

**Architecture:**
- AuthMiddleware (auth.py) - Main middleware class that routes to backends
- AuthBackend (auth_base.py) - Abstract base class for all backends
- LocalAuthBackend (auth_local.py) - Username/password via database
- LDAPAuthBackend (auth_ldap.py) - LDAP/Active Directory authentication
- SecurityHeadersMiddleware (security.py) - CSP, HSTS, X-Frame-Options, etc.

**Authentication Flow:**
1. Request arrives at AuthMiddleware
2. Public paths (/api/docs, /api/version, static files) are allowed through
3. Token is extracted from Authorization header or cookie
4. Backend.validate_token() is called to verify credentials
5. If valid, request.user is set with User object
6. If invalid, 401 Unauthorized is returned

**Security Features:**
- JWT tokens signed with secret_key (HS256 algorithm)
- Rate limiting on auth endpoints (slowapi)
- Security headers on all responses
- CSRF protection via SameSite cookies
- Password hashing with bcrypt

**Backend Selection:**
Set auth_backend in .env: "local", "ldap", or "none"
- "none" disables authentication (development only)
"""
