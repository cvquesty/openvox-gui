# OpenVox GUI - Backend Application
# Version is read from the root VERSION file (single source of truth).
from pathlib import Path as _Path

__version__ = (_Path(__file__).resolve().parent.parent.parent / "VERSION").read_text().strip()
