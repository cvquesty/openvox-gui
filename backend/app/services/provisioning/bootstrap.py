"""
Bootstrap target and guest options for a build.

Shared by the API (preview, submit) and the provisioner worker, which
rebuilds a job's options from settings when it claims the job.
"""
from __future__ import annotations

from urllib.parse import urlparse

from . import config_store, presets
from .cloudinit import BootstrapTarget, GuestOptions


def bootstrap_target(agent_version: str = "") -> BootstrapTarget:
    """Same server / CA / package mirror the Agent Install page uses."""
    from ...routers.installer import (
        _ca_server_fqdn,
        _latest_agent_version,
        _noproxy_hosts,
        _pkg_repo_url,
        _puppet_server_fqdn,
    )

    repo = _pkg_repo_url()
    server = _puppet_server_fqdn()
    ca = _ca_server_fqdn()
    console = urlparse(repo).hostname or ""
    return BootstrapTarget(
        server=server,
        ca_server=ca,
        pkg_repo_url=repo,
        agent_version=agent_version or _latest_agent_version(),
        noproxy_hosts=tuple(h for h in _noproxy_hosts(console, server, ca).split(",") if h),
    )


async def guest_options(
    cfg: config_store.ProvisioningSettings, with_bootstrap: bool, profile: str = "",
) -> GuestOptions:
    target = None
    if with_bootstrap:
        target = await presets.resolve_profile(
            profile, lambda: bootstrap_target(cfg.agent_version), cfg.agent_version,
        )
    return GuestOptions(
        ssh_authorized_keys=tuple(cfg.ssh_authorized_keys),
        http_proxy=await config_store.load_http_proxy(),
        no_proxy=tuple(cfg.no_proxy),
        dnf_groups=tuple(cfg.dnf_groups),
        bootstrap=target,
    )
