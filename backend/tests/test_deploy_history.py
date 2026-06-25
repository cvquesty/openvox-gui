"""deploy_history JSON helpers (srdev2 A6) — isolated from full app imports."""
import importlib.util
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

# Load module file with minimal stubs so we never import app.services.__init__
_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "deploy_history.py"


def _load_mod(history_file: Path):
    src = _PATH.read_text()
    # Force HISTORY_FILE assignment after load via monkeypatch on namespace
    ns = {
        "__name__": "deploy_history_isolated",
        "__file__": str(_PATH),
        "annotations": True,
    }
    # Provide imports used by module
    import types
    g = {
        "json": json,
        "logging": __import__("logging"),
        "os": os,
        "tempfile": tempfile,
        "threading": threading,
        "Path": Path,
        "datetime": datetime,
        "timezone": timezone,
        "Any": object,
        "Dict": dict,
        "List": list,
        "Optional": type(None),
        "logger": __import__("logging").getLogger("test"),
    }
    # Execute only the functions we need by compiling with rewritten HISTORY_FILE
    code = compile(src.replace(
        'HISTORY_FILE = Path("/opt/openvox-gui/data/deploy_history.json")',
        f'HISTORY_FILE = Path({str(history_file)!r})',
    ), str(_PATH), "exec")
    # Strip async record_deploy_execution body dependency on models — keep function
    exec(code, g)
    return g


def test_add_json_roundtrip(tmp_path):
    g = _load_mod(tmp_path / "deploy_history.json")
    g["add_json_history_entry"]({"timestamp": "t1", "environment": "production", "success": True})
    g["add_json_history_entry"]({"timestamp": "t2", "environment": "staging", "success": False})
    hist = g["load_json_history"]()
    assert len(hist) == 2
    assert hist[0]["timestamp"] == "t2"


def test_record_deploy_writes_json(tmp_path):
    g = _load_mod(tmp_path / "dh.json")
    entry = g["record_deploy"](
        environment="production",
        triggered_by="admin",
        success=True,
        exit_code=0,
        output_lines=3,
    )
    assert entry["triggered_by"] == "admin"
    assert g["load_json_history"]()[0]["exit_code"] == 0
