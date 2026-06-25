"""
Structured security audit logging (srdev1 rec #9 / 3.10.01.a2).

Single-line AUDIT records for privileged actions. Do not log secrets,
full command output, or tokens — only identity, action, targets, and rc.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

_audit = logging.getLogger("openvox_gui.audit")


def audit_event(
    action: str,
    *,
    user: str = "unknown",
    targets: Optional[str] = None,
    detail: Optional[str] = None,
    rc: Optional[int] = None,
    success: Optional[bool] = None,
    **extra: Any,
) -> None:
    """Emit one AUDIT log line (INFO). Safe for operators; no payload dumps."""
    parts = [f"AUDIT: type={action}", f"user={user}"]
    if targets is not None:
        # Truncate huge target lists
        t = str(targets)
        if len(t) > 200:
            t = t[:197] + "..."
        parts.append(f"targets={t}")
    if detail is not None:
        d = str(detail).replace("\n", " ").strip()
        if len(d) > 160:
            d = d[:157] + "..."
        parts.append(f"detail={d}")
    if rc is not None:
        parts.append(f"rc={rc}")
    if success is not None:
        parts.append(f"success={str(success).lower()}")
    for key, val in sorted(extra.items()):
        if val is None:
            continue
        parts.append(f"{key}={val}")
    _audit.info(" ".join(parts))
