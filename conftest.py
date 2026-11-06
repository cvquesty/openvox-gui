"""Root pytest bootstrap so ovox + backend collection share one data dir."""
from __future__ import annotations

import os
import secrets
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="openvox-gui-pytest-"))
(_tmp / "logs").mkdir(parents=True, exist_ok=True)

os.environ.setdefault("OPENVOX_GUI_DATA_DIR", str(_tmp))
os.environ.setdefault("OPENVOX_GUI_LOG_DIR", str(_tmp / "logs"))
os.environ.setdefault(
    "OPENVOX_GUI_DATABASE_URL",
    f"sqlite+aiosqlite:///{_tmp / 'test.db'}",
)
os.environ.setdefault("OPENVOX_GUI_SECRET_KEY", secrets.token_hex(32))
os.environ.setdefault("OPENVOX_GUI_AUTH_BACKEND", "none")
