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

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .database import init_db
from .middleware.auth import AuthMiddleware
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
    """Application startup and shutdown events."""
    # Startup
    logger.info(f"Starting {settings.app_name} v1.3.7")
    logger.info(f"PuppetDB: {settings.puppetdb_host}:{settings.puppetdb_port}")
    logger.info(f"PuppetServer: {settings.puppet_server_host}:{settings.puppet_server_port}")

    # Ensure directories exist
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.log_dir).mkdir(parents=True, exist_ok=True)

    # Initialize database (creates all tables including active_sessions)
    await init_db()
    logger.info("Database initialized")

    # Migrate legacy htpasswd users to database (one-time)
    if settings.auth_backend == "local":
        from .middleware.auth_local import migrate_htpasswd_users
        await migrate_htpasswd_users()

    yield

    # Shutdown
    await puppetdb_service.close()
    logger.info("Application shutdown complete")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    description="Web-based management GUI for OpenVox/Puppet infrastructure",
    version="1.3.7",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS middleware (for development; production serves frontend from same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"status": "ok", "version": "1.3.7"}


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve static files from dist root, or fall back to React SPA."""
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
