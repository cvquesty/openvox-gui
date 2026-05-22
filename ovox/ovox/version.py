"""
Version handling for ovox.

When ovox is installed alongside OpenVox GUI (the normal case), it prefers
the single source of truth at $INSTALL_DIR/VERSION. This keeps the CLI
version in lockstep with the GUI without a separate release train.
"""

import os
from pathlib import Path

from . import __version__ as _pkg_version


def get_version() -> str:
    """
    Return the best available version string.

    Resolution order:
    1. OPENVOX_VERSION env var (useful for packaging/CI overrides)
    2. $INSTALL_DIR/VERSION (when running from the official /opt layout)
    3. The version baked into the installed ovox package
    """
    env_ver = os.environ.get("OPENVOX_VERSION")
    if env_ver:
        return env_ver.strip()

    # Official production layout: /opt/openvox-gui/VERSION
    for candidate in (
        Path("/opt/openvox-gui/VERSION"),
        Path("/opt/openvox-gui/venv/../VERSION"),  # in case cwd is venv
        Path(__file__).resolve().parent.parent.parent / "VERSION",  # dev checkout
    ):
        if candidate.exists():
            try:
                ver = candidate.read_text(encoding="utf-8").strip()
                if ver:
                    return ver
            except OSError:
                pass

    return _pkg_version


VERSION = get_version()
