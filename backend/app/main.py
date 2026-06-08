"""
OpenVox GUI - Main Application Entry Point

A web-based management GUI for OpenVox/Puppet infrastructure.
Provides:
1. Fleet status dashboard with monitoring visualizations
2. External Node Classifier (ENC) for Puppet agents
3. Configuration management for PuppetServer, PuppetDB, and this application
4. Code deployment via r10k integration
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from . import __version__
from .config import settings
from .database import init_db
from .middleware.auth import AuthMiddleware
from .middleware.security import SecurityHeadersMiddleware, limiter
from .middleware.maintenance import MaintenanceMiddleware
from .routers import dashboard, nodes, reports, enc, config as config_router, performance
from .routers import bolt as bolt_router
from .routers import facts as facts_router
from .routers import pql as pql_router
from .routers import certificates as cert_router
from .routers import auth as auth_router
from .routers import deploy as deploy_router
from .routers import execution_history as execution_history_router
from .routers import installer as installer_router
from .routers import ssl_wizard as ssl_wizard_router
from .routers import logs as logs_router
from .routers import metrics as metrics_router
from .routers import infra as infra_router
from .routers import maintenance as maintenance_router
from .services.puppetdb import puppetdb_service

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle manager for startup and shutdown events.
    
    This async context manager handles the complete lifecycle of the FastAPI application:
    
    **Startup Phase:**
    1. Logs application name and version for debugging/troubleshooting
    2. Logs backend service endpoints (PuppetDB, PuppetServer) for verification
    3. Creates required directories (data_dir, log_dir) if they don't exist
    4. Initializes the SQLite database via init_db() which creates all tables
       including users, enc_nodes, enc_groups, execution_history, etc.
    5. Migrates any legacy htpasswd users to the database (one-time migration)
       when using local authentication backend
    
    **Shutdown Phase:**
    1. Closes the PuppetDB HTTP client connection pool gracefully
    2. Logs shutdown completion for audit trail
    
    This pattern ensures clean resource management and proper initialization
    order. The lifespan is tied to the FastAPI app instance and runs once
    per application start/stop cycle.
    """
    # Startup: Log configuration for operational visibility
    logger.info(f"Starting {settings.app_name} v{__version__}")
    logger.info(f"PuppetDB: {settings.puppetdb_host}:{settings.puppetdb_port}")
    logger.info(f"PuppetServer: {settings.puppet_server_host}:{settings.puppet_server_port}")

    # Ensure directories exist - critical for first-run initialization
    # data_dir stores SQLite database and preferences.json
    # log_dir stores application logs
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.log_dir).mkdir(parents=True, exist_ok=True)

    # Initialize database (creates all tables including active_sessions)
    # Uses SQLAlchemy async engine with aiosqlite for async SQLite access
    await init_db()
    logger.info("Database initialized")

    # Strong runtime guard for the dangerous "none" auth backend (GitHub #25)
    # This backend makes every request appear as an unauthenticated "admin" user.
    # It must never be active on anything resembling a production or network-exposed instance.
    if settings.auth_backend == "none":
        logger.warning(
            "⚠️  Authentication backend is 'none'. This disables all auth and grants full admin to EVERY request. "
            "This is ONLY for initial setup or local development. It is a critical misconfiguration risk in production."
        )
        if not settings.debug:
            logger.critical(
                "SECURITY: Refusing to start with auth_backend='none' when debug=False. "
                "Set OPENVOX_GUI_AUTH_BACKEND=local (or ldap) for production. "
                "Use debug=true ONLY for local development on localhost."
            )
            import sys
            sys.exit(1)

    # Migrate legacy htpasswd users to database (one-time)
    # This ensures backward compatibility with pre-database authentication
    if settings.auth_backend == "local":
        from .middleware.auth_local import migrate_htpasswd_users
        await migrate_htpasswd_users()

    # Prune any token denylist rows whose original JWT expiry has
    # passed (3.3.5-29). Keeps the table small over time -- entries
    # past their expires_at serve no purpose because the JWT itself
    # is naturally invalid by then.
    try:
        from .middleware.auth_local import prune_expired_tokens
        n_pruned = await prune_expired_tokens()
        if n_pruned:
            logger.info(f"Pruned {n_pruned} expired token-denylist entries")
    except Exception as exc:
        logger.warning(f"Token denylist prune failed: {exc}")

    # --- Maintenance Mode Stale State Handling (post-3.7 maintenance feature) ---
    # The maintenance flag (maintenance.json + .flag) is intentionally persistent
    # so deploy scripts can keep the GUI "down" during updates. However, this
    # caused a regression where plain `systemctl restart openvox-gui` (or auto-
    # restarts after crashes) would leave the service stuck returning 503s.
    #
    # On every clean backend startup we check: if maintenance is still marked
    # active, it is almost certainly stale (a previous deploy didn't finish its
    # trap cleanup, or someone did a manual restart). We auto-clear it so the
    # service comes back cleanly. Deploy scripts re-enable the flag early in
    # their run before the restart, so the window is protected during actual
    # deploys.
    try:
        from .utils.maintenance import is_maintenance_active, disable_maintenance, get_maintenance_info
        if is_maintenance_active():
            info = get_maintenance_info()
            logger.warning(
                "Maintenance mode was still enabled on backend startup. "
                "This typically means a previous deploy script did not complete "
                "or a manual restart occurred while the flag was present. "
                "Automatically clearing maintenance state so the service comes "
                "back cleanly."
            )
            if info.get("started_at"):
                logger.warning(f"Stale maintenance started at: {info['started_at']}")
            disable_maintenance()
    except Exception as exc:
        logger.error(f"Failed to check/clear stale maintenance state on startup: {exc}")

    yield  # Application runs here

    # Shutdown: Clean up resources
    await puppetdb_service.close()
    logger.info("Application shutdown complete")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    description="Web-based management GUI for OpenVox/Puppet infrastructure",
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# Add rate limiter state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# Maintenance mode middleware — returns clean 503s instead of errors when the
# GUI has been intentionally placed into maintenance (via `ovox maintenance enable`
# or the /api/maintenance/enable endpoint). This runs early so most requests
# are short-circuited before hitting auth or business logic.
app.add_middleware(MaintenanceMiddleware)

# CORS middleware - restrictive in production
allowed_origins = []
if settings.debug:
    # Allow localhost origins for development
    allowed_origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]
else:
    # In production, only allow same-origin (frontend served from same domain)
    # Add specific origins if needed for your deployment
    allowed_origins = []

if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

# Authentication middleware
app.add_middleware(AuthMiddleware, auth_backend=settings.auth_backend)

# Register API routers
app.include_router(auth_router.router)
app.include_router(dashboard.router)
app.include_router(nodes.router)
app.include_router(reports.router)
app.include_router(enc.router)
app.include_router(config_router.router)
app.include_router(performance.router)
app.include_router(deploy_router.router)
app.include_router(bolt_router.router)
app.include_router(pql_router.router)
app.include_router(cert_router.router)
app.include_router(facts_router.router)
app.include_router(execution_history_router.router)
app.include_router(installer_router.router)
app.include_router(ssl_wizard_router.router)
app.include_router(logs_router.router)
app.include_router(metrics_router.router)
app.include_router(infra_router.router)
app.include_router(maintenance_router.router)

# Serve React frontend static files
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

# Serve the local OpenVox package mirror at /packages/*.
#
# This is the FastAPI-side fallback for the puppetserver static-content
# mount that install.sh adds to /etc/puppetlabs/puppetserver/conf.d/.
# Most agents will hit the puppetserver mount on port 8140 (because
# that's the standard agent port, already permitted through firewalls);
# this mount on the openvox-gui port (4567 by default) lets operators
# verify the layout via the browser and gives agents a working URL even
# if the puppetserver mount hasn't been configured yet.
#
# The directory may legitimately not exist yet (first install before
# the initial sync runs), in which case we simply skip mounting and
# /packages/* falls through to the SPA 404 handler.
_pkg_repo_dir = Path(os.environ.get("OPENVOX_GUI_PKG_REPO_DIR", "/opt/openvox-pkgs"))
if _pkg_repo_dir.exists():
    # html=False so directory listings are NOT served (we don't want
    # to leak the full directory structure to anonymous users).
    # Auto-error responses for missing files are handled by StaticFiles
    # itself, returning a 404 that flows through to the SPA catch-all.
    app.mount("/packages", StaticFiles(directory=str(_pkg_repo_dir), html=False), name="packages")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": __version__}


@app.get("/api/version")
async def get_version():
    """Public endpoint returning the application version. No auth required."""
    return {"version": __version__}


@app.api_route("/{full_path:path}", methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"])
async def serve_spa(request: Request, full_path: str):
    """Serve static files from dist root, or fall back to React SPA.

    API paths that reach this handler are genuine 404s — no matching
    API route was found. Return a proper JSON 404 instead of serving
    the SPA shell (which would confuse API clients with a 200 HTML
    response for GET, or a misleading 405 for other methods).
    """
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail=f"API endpoint not found: /{full_path}")
    if request.method not in ("GET", "HEAD"):
        raise HTTPException(status_code=405, detail="Method Not Allowed")
    # Serve static files (e.g. openvox-logo.svg) directly from dist
    if full_path:
        static_file = (frontend_dist / full_path).resolve()
        # Ensure the resolved path is still within frontend_dist (prevent traversal)
        if static_file.is_file() and str(static_file).startswith(str(frontend_dist.resolve())):
            # Set cache headers based on file type
            headers = {}
            if full_path.startswith("assets/"):
                # Versioned assets can be cached for a long time
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                # Other static files get shorter cache
                headers["Cache-Control"] = "public, max-age=3600"
            return FileResponse(str(static_file), headers=headers)
    # Fall back to SPA index.html (no-cache so browser always gets latest chunk references)
    index_file = frontend_dist / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file), headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return {"message": f"OpenVox GUI API is running. Frontend not built yet. Visit /api/docs for API documentation."}
