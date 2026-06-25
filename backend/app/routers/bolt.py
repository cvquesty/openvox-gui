"""Bolt API — physical split (srdev2 A4). URLs remain under /api/bolt."""
from fastapi import APIRouter

from .bolt_config_routes import router as _config_router
from .bolt_execution import router as _execution_router
from .bolt_files import router as _files_router
from .bolt_runtime import BOLT_PATHS, find_bolt, resolve_targets, run_bolt_command

router = APIRouter(prefix="/api/bolt", tags=["bolt"])
router.include_router(_execution_router)
router.include_router(_files_router)
router.include_router(_config_router)

__all__ = ["router", "resolve_targets", "run_bolt_command", "find_bolt", "BOLT_PATHS"]
