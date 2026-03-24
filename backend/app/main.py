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
from .routers import dashboard, nodes, reports, enc, config as config_router, performance
from .routers import bolt as bolt_router
from .routers import facts as facts_router
from .routers import pql as pql_router
from .routers import certificates as cert_router
from .routers import auth as auth_router
from .routers import deploy as deploy_router
from .routers import execution_history as execution_history_router
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

    # Migrate legacy htpasswd users to database (one-time)
    # This ensures backward compatibility with pre-database authentication
    if settings.auth_backend == "local":
        from .middleware.auth_local import migrate_htpasswd_users
        await migrate_htpasswd_users()

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

# Serve React frontend static files
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")


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
