"""
Deploy history — JSON file (legacy UI) + SQLite execution_history (srdev2 A6).

Keeps the existing deploy_history.json contract for GET /api/deploy/history
while also recording type=deploy rows in ExecutionHistory for unified audit.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

HISTORY_FILE = Path("/opt/openvox-gui/data/deploy_history.json")
_history_lock = threading.Lock()


def load_json_history() -> List[dict]:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_json_history(history: list) -> None:
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(history, indent=2, default=str) + "\n"
    fd, tmp_path = tempfile.mkstemp(dir=HISTORY_FILE.parent, prefix="deploy_history.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, HISTORY_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise


def add_json_history_entry(entry: dict) -> None:
    """Append one deploy event to the JSON file (last 100 entries)."""
    with _history_lock:
        history = load_json_history()
        history.insert(0, entry)
        history = history[:100]
        save_json_history(history)


async def record_deploy_execution(
    db,
    *,
    environment: str,
    executed_by: str,
    success: bool,
    exit_code: int,
    output_preview: str = "",
    error_message: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
) -> None:
    """Insert ExecutionHistory row with execution_type='deploy' (best-effort)."""
    if db is None:
        return
    try:
        from ..models import ExecutionHistory

        row = ExecutionHistory(
            execution_type="deploy",
            node_name=environment or "all",
            command_name="r10k-deploy.sh",
            environment=environment or "all",
            parameters=parameters,
            status="success" if success else "failure",
            executed_by=executed_by or "unknown",
            executed_at=datetime.now(timezone.utc),
            error_message=(error_message or "")[:500] or None,
            result_preview=(output_preview or "")[:500] or None,
        )
        # duration unknown for sync subprocess path — leave null
        db.add(row)
        await db.commit()
    except Exception as exc:
        logger.warning("Failed to record deploy in execution_history: %s", exc, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass


def record_deploy(
    *,
    environment: str,
    triggered_by: str,
    success: bool,
    exit_code: int,
    output_lines: int = 0,
    output_preview: str = "",
    commit: Optional[str] = None,
    db=None,
    extra_json: Optional[dict] = None,
) -> dict:
    """
    Synchronous JSON append + schedule note for async DB (caller awaits record_deploy_execution).

    Returns the JSON entry dict written to disk.
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": environment or "all",
        "triggered_by": triggered_by,
        "success": success,
        "exit_code": exit_code,
        "output_lines": output_lines,
    }
    if commit is not None:
        entry["commit"] = commit
    if extra_json:
        entry.update(extra_json)
    add_json_history_entry(entry)
    return entry
