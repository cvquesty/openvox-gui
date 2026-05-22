"""
Version handling for ovox (the OpenVox CLI).

ovox has its own independent version (starting 3.7.1-alpha1), separate from
the main OpenVox GUI version. This lets the CLI evolve on its own cadence
while still being distributed together with the GUI.

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

    We deliberately look for an *ovox* VERSION file first so the CLI can
    have its own release train (3.7.1-alpha1, alpha2, beta1, 3.7.1, ...).
    """
    # 1. Explicit environment override (highest priority)
    for env_name in ("OPENVOX_CLI_VERSION", "OPENVOX_VERSION"):
        if ver := os.environ.get(env_name):
            return ver.strip()

    # 2. Installed layout: /opt/openvox-gui/ovox/VERSION
    #    (this is where install.sh / deploy.sh copy the ovox/ tree)
    for candidate in (
        Path("/opt/openvox-gui/ovox/VERSION"),
        Path("/opt/openvox-gui/ovox/VERSION"),  # explicit
    ):
        if candidate.exists():
            try:
                ver = candidate.read_text(encoding="utf-8").strip()
                if ver:
                    return ver
            except OSError:
                pass

    # 3. Development checkout — ovox has its own VERSION file at ovox/VERSION
    #    From ovox/ovox/version.py we go up two directories to reach the ovox/ tree.
    for candidate in (
        Path(__file__).resolve().parent.parent / "VERSION",           # ovox/ovox/../VERSION → ovox/VERSION
        Path(__file__).resolve().parent.parent.parent / "ovox" / "VERSION",  # from repo root
        Path("/opt/openvox-gui/ovox/VERSION"),                        # production install
    ):
        if candidate.exists():
            try:
                ver = candidate.read_text(encoding="utf-8").strip()
                if ver:
                    return ver
            except OSError:
                pass

    # 4. Last resort: the version that was baked into the wheel/sdist
    return _pkg_version


VERSION = get_version()
