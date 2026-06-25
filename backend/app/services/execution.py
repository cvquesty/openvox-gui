"""
Execution domain service facade (srdevarch1 HP1).

Target resolution for Bolt lives here; CLI argv assembly remains in routers.bolt
(run_bolt_command) for proven lab behavior.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from .command_execution import (
    CommandExecutionService,
    LocalSudoTransport,
    SSHRemoteTransport,
    default_service,
    get_active_job_count,
    TOKEN_SCOPES,
    BOLT_INVENTORY_ROLES,
)

__all__ = [
    "CommandExecutionService",
    "LocalSudoTransport",
    "SSHRemoteTransport",
    "default_service",
    "get_active_job_count",
    "TOKEN_SCOPES",
    "BOLT_INVENTORY_ROLES",
    "resolve_targets",
]


async def resolve_targets(targets: str, db: AsyncSession) -> str:
    """Resolve targets (certnames, ENC groups, 'all') to comma-separated certnames."""
    from ..services.enc import enc_service
    from ..services.puppetdb import puppetdb_service

    if not targets or not targets.strip():
        return ""

    raw_parts = [p.strip() for p in targets.split(",") if p.strip()]
    if not raw_parts:
        return ""

    seen: set[str] = set()
    resolved: list[str] = []

    try:
        groups = await enc_service.list_groups(db)
        all_nodes_list = await enc_service.list_nodes(db)
    except Exception:
        groups = []
        all_nodes_list = []

    group_map = {g.name.lower(): g for g in groups}

    all_certnames: list[str] = []
    if any(p.lower() == "all" for p in raw_parts):
        try:
            pdb_nodes = await puppetdb_service.get_nodes()
            all_certnames = [n["certname"] for n in pdb_nodes if n.get("certname")]
        except Exception:
            all_certnames = [n.certname for n in all_nodes_list if n.certname]

    for part in raw_parts:
        part_lower = part.lower()

        if part_lower == "all":
            for cn in all_certnames:
                if cn not in seen:
                    seen.add(cn)
                    resolved.append(cn)
            continue

        group = group_map.get(part_lower)
        if group:
            members = []
            for node in all_nodes_list:
                if not node.certname:
                    continue
                try:
                    node_groups = getattr(node, "groups", None) or []
                    if group.name in [g.name for g in node_groups]:
                        members.append(node.certname)
                except Exception:
                    pass
            for cn in members:
                if cn not in seen:
                    seen.add(cn)
                    resolved.append(cn)
            continue

        if part not in seen:
            seen.add(part)
            resolved.append(part)

    resolved.sort(key=lambda x: x.lower())
    return ",".join(resolved)
