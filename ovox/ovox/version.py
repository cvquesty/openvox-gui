"""
Version handling for ovox (the OpenVox CLI).

As of OpenVox GUI 3.7.3, the ovox CLI is versioned in lockstep with the
main GUI project. The root `VERSION` file is the single source of truth;
`scripts/bump-version.sh` keeps `ovox/VERSION`, `__init__.py`, and
`pyproject.toml` in sync automatically.

This module provides a robust `get_version()` helper with sensible precedence
for development, installed, and CI/packaging scenarios.

Resolution order (highest priority first):
1. OPENVOX_CLI_VERSION or OPENVOX_VERSION env var (CI / packaging override)
2. The ovox-specific VERSION file when installed with the GUI:
     /opt/openvox-gui/ovox/VERSION
3. The VERSION file next to the ovox source tree (development checkouts)
4. The version baked into the installed Python package (__version__)
"""

import os
from pathlib import Path

from . import __version__ as _pkg_version


def get_version() -> str:
    """
    Return the best available ovox version string.

    With unified versioning (GUI 3.7.3+), the root VERSION and ovox/VERSION
    are kept in sync. The precedence here still provides flexibility for
    development, packaging, and CI overrides.
    """
    # 1. Explicit environment override (highest priority)
    for env_name in ("OPENVOX_CLI_VERSION", "OPENVOX_VERSION"):
        if ver := os.environ.get(env_name):
            return ver.strip()

    # 2. Installed layout: /opt/openvox-gui/ovox/VERSION
    #    (this is where install.sh / deploy.sh copy the ovox/ tree)
    for candidate in (
        Path("/opt/openvox-gui/ovox/VERSION"),
    ):
        try:
            if candidate.exists():
                ver = candidate.read_text(encoding="utf-8").strip()
                if ver:
                    return ver
        except (OSError, PermissionError):
            # No permission or other FS error — skip this candidate
            pass

    # 3. Development / fallback locations
    for candidate in (
        Path(__file__).resolve().parent.parent / "VERSION",                    # ovox/VERSION in source tree
        Path(__file__).resolve().parent.parent.parent / "ovox" / "VERSION",
        Path("/opt/openvox-gui/ovox/VERSION"),
    ):
        try:
            if candidate.exists():
                ver = candidate.read_text(encoding="utf-8").strip()
                if ver:
                    return ver
        except (OSError, PermissionError):
            pass

    # 4. Last resort: the version that was baked into the wheel/sdist
    return _pkg_version


VERSION = get_version()
