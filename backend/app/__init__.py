"""
OpenVox GUI Backend Application Package

This package contains the FastAPI backend for OpenVox GUI, a web-based
management interface for OpenVox/Puppet infrastructure.

**Architecture Overview:**
- FastAPI application with async SQLAlchemy (aiosqlite)
- JWT-based authentication with local and LDAP backends
- RESTful API for all GUI operations
- Integration with PuppetDB, PuppetServer, and Bolt

**Version Management:**
Version is read from the root VERSION file (single source of truth).
This ensures all components (backend, frontend, installer) stay in sync.

**Module Structure:**
- app/routers/ - FastAPI route handlers (API endpoints)
- app/services/ - Business logic and external service clients
- app/middleware/ - Authentication, security, rate limiting
- app/models/ - SQLAlchemy ORM models and Pydantic schemas
- app/utils/ - Helper utilities (HTTP client, validation)
- app/config.py - Pydantic settings with environment support
- app/database.py - Database engine and session management
- app/dependencies.py - FastAPI dependency injection providers
- app/main.py - Application entry point and lifespan
"""

from pathlib import Path as _Path

# Single source of truth: read version from root VERSION file
# This file is copied during installation and used by all components
__version__ = (_Path(__file__).resolve().parent.parent.parent / "VERSION").read_text().strip()
