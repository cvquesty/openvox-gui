"""
Cluster / multi-server configuration for openvox-gui.

Single-server (default) keeps the historic singleton UX. When
``deployment_mode`` is ``clustered``, the UI exposes multi-compiler
code deploy, infrastructure ENC groups, and per-FQDN service health.

Access rule of thumb (data plane for code/ENC discovery):
  - **single** (all-in-one): prefer **local files** — codedir, r10k.yaml,
    puppet.conf, local puppetserver/PuppetDB on this host.
  - **clustered** (dedicated console): prefer **HTTP APIs + Bolt** to
    compilers / deploy targets — no control_repo on the GUI host.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from ..config import settings

logger = logging.getLogger(__name__)

_FQDN_RE = re.compile(
    r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)

DEFAULT_CONFIG: Dict[str, Any] = {
    "deployment_mode": "single",  # single | clustered
    "compilers": [],  # list of FQDNs (catalog compilers / deploy targets)
    "puppetdb_nodes": [],  # list of FQDNs (OpenVoxDB application hosts)
    "ca_nodes": [],  # list of CA member FQDNs (ovca1, ovca2 per site)
    "ca_vips": [],  # DNS RR for CA (ovca.corp) — hide from Nodes
    # Health-probe only (HAProxy compiler frontends). Does NOT hide Nodes.
    "infra_vips": [],
    # DNS-only RR names with no OS (ovdb.corp). Hidden from Nodes.
    "dns_rr_vips": [],
    # Extra hide list. Never put ovcompilers.* here (code strips them).
    "fleet_exclude": [],
    "code_deploy_targets": [],  # FQDNs that receive r10k stage/activate (defaults to compilers)
    "consoles": [],  # GUI FQDNs (openvox.pdxc…, openvox.atlc…)
    # Public VIP / LB hostnames for the console (not individual node FQDNs).
    # Used for access_mode=vip (session-safe SPA polling behind the VIP).
    # Also excluded from live fleet (not agent nodes).
    "vip_hosts": [],
    "database_backend": "sqlite",  # sqlite | postgresql
    "enc_api_urls": [],  # ENC script failover list, e.g. https://openvox.pdxc…:4567
    "staging_codedir": "/etc/puppetlabs/code-staging",
    "live_codedir": "/etc/puppetlabs/code",
}


def _config_path() -> Path:
    return Path(settings.data_dir) / "cluster_config.json"


def _validate_fqdn(name: str) -> str:
    n = (name or "").strip().lower()
    if not n or len(n) > 253 or not _FQDN_RE.match(n):
        raise ValueError(f"Invalid FQDN: {name!r}")
    return n


def _normalize(data: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(DEFAULT_CONFIG)
    if not isinstance(data, dict):
        return out
    mode = data.get("deployment_mode", "single")
    if mode not in ("single", "clustered"):
        mode = "single"
    out["deployment_mode"] = mode

    backend = str(data.get("database_backend") or "sqlite").strip().lower()
    if backend not in ("sqlite", "postgresql"):
        backend = "sqlite"
    out["database_backend"] = backend

    raw_urls = data.get("enc_api_urls") or []
    if isinstance(raw_urls, str):
        raw_urls = [u.strip() for u in raw_urls.replace(",", "\n").splitlines() if u.strip()]
    urls: List[str] = []
    if isinstance(raw_urls, list):
        for u in raw_urls:
            s = str(u).strip().rstrip("/")
            if s.startswith("https://") or s.startswith("http://"):
                urls.append(s)
    out["enc_api_urls"] = list(dict.fromkeys(urls))

    for key in (
        "compilers",
        "puppetdb_nodes",
        "ca_nodes",
        "ca_vips",
        "infra_vips",
        "dns_rr_vips",
        "fleet_exclude",
        "code_deploy_targets",
        "consoles",
        "vip_hosts",
    ):
        raw = data.get(key) or []
        if isinstance(raw, str):
            raw = [p.strip() for p in raw.replace(",", "\n").splitlines() if p.strip()]
        if not isinstance(raw, list):
            raw = []
        cleaned: List[str] = []
        for item in raw:
            try:
                cleaned.append(_validate_fqdn(str(item)))
            except ValueError:
                logger.warning("Skipping invalid FQDN in %s: %r", key, item)
        # de-dupe preserve order
        seen = set()
        uniq = []
        for c in cleaned:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        out[key] = uniq

    for key in ("staging_codedir", "live_codedir"):
        val = data.get(key) or DEFAULT_CONFIG[key]
        if isinstance(val, str) and val.startswith("/") and ".." not in val:
            out[key] = val

    # Default deploy targets to compilers when clustered and empty
    if out["deployment_mode"] == "clustered" and not out["code_deploy_targets"]:
        out["code_deploy_targets"] = list(out["compilers"])

    return out


def load_cluster_config() -> Dict[str, Any]:
    path = _config_path()
    if not path.exists():
        return dict(DEFAULT_CONFIG)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _normalize(data)
    except Exception as e:
        logger.error("Failed to load cluster_config.json: %s", e)
        return dict(DEFAULT_CONFIG)


def save_cluster_config(
    data: Dict[str, Any],
    *,
    require_postgres_url: bool = False,
) -> Dict[str, Any]:
    """Persist cluster_config.json.

    When deployment_mode is clustered, database_backend is forced to
    postgresql. If require_postgres_url is True (config API when enabling
    clustered), the running settings.database_url must already be Postgres
    or the caller must be writing a postgres URL in the same request.
    """
    normalized = _normalize(data)
    if normalized.get("deployment_mode") == "clustered":
        normalized["database_backend"] = "postgresql"
        if require_postgres_url:
            url = (settings.database_url or "").strip().lower()
            if not url.startswith(("postgresql", "postgres")):
                raise ValueError(
                    "Clustered mode requires a PostgreSQL application database "
                    "(OPENVOX_GUI_DATABASE_URL=postgresql+asyncpg://…/openvox_gui). "
                    "Provide database_url in this request, or run "
                    "scripts/bootstrap-openvox-gui-db.sh / install with "
                    "OPENVOX_GUI_DB_BACKEND=postgresql first. SQLite cannot "
                    "support a second console or durable multi-host DR."
                )
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    logger.info(
        "Saved cluster config mode=%s compilers=%s puppetdb=%s deploy=%s backend=%s",
        normalized["deployment_mode"],
        len(normalized["compilers"]),
        len(normalized["puppetdb_nodes"]),
        len(normalized["code_deploy_targets"]),
        normalized.get("database_backend"),
    )
    return normalized


def is_clustered() -> bool:
    return load_cluster_config().get("deployment_mode") == "clustered"


def deploy_targets() -> List[str]:
    cfg = load_cluster_config()
    if cfg.get("deployment_mode") != "clustered":
        return []
    targets = cfg.get("code_deploy_targets") or cfg.get("compilers") or []
    return list(targets)


def is_compiler_haproxy_agent(certname: Optional[str]) -> bool:
    """True for HAProxy compiler-frontends: first label is ``ovcompilers``.

    ``ovcompilers.atlc-it…`` / ``ovcompilers.pdxc-it…`` are real VMs with
    an agent. ``ovcompiler1.*`` (the backends) are also agents but are
    never hide-list candidates. DNS RR names (``ovca.corp``, ``ovdb.corp``)
    do not match.
    """
    n = (certname or "").strip().lower()
    return bool(n) and n.split(".", 1)[0] == "ovcompilers"


def looks_like_compiler_host(host: Optional[str]) -> bool:
    """True if *host* is a compile VIP or compiler backend (CA disabled).

    Matches any FQDN whose labels contain ``compiler`` (``ovcompilers.*``,
    ``ovcompiler1.*``, ``compiler01.*``). CA VIPs (``ovca.*``) do not match.

    Keep in sync with ``scripts/pick_ca_server.py``.
    """
    n = (host or "").strip().strip("\"'").lower()
    return bool(n) and "compiler" in n


def pick_master_ca_vip(vips: Optional[List[str]]) -> str:
    """Choose the global/master CA VIP from cluster ``ca_vips``.

    Agents use one stable ``ca_server`` — the DNS name that follows the
    active CA writer — not a site-local VIP and never a compiler.
    Prefer the fewest DNS labels (shared/global VIP), then shorter
    length, then lexical order.

    Keep in sync with ``scripts/pick_ca_server.py``.
    """
    cleaned: List[str] = []
    seen = set()
    for v in vips or []:
        n = str(v or "").strip().strip("\"'").lower()
        if not n or looks_like_compiler_host(n) or n in seen:
            continue
        seen.add(n)
        cleaned.append(n)
    if not cleaned:
        return ""
    cleaned.sort(key=lambda h: (h.count("."), len(h), h))
    return cleaned[0]


def resolve_agent_ca_server(
    *,
    explicit: Optional[str] = None,
    compile_host: Optional[str] = None,
    ca_vips: Optional[List[str]] = None,
) -> str:
    """Hostname for agent ``ca_server=`` / install.bash ``CA_SERVER``.

    Order:
      1. Explicit ``OPENVOX_GUI_PUPPET_CA_HOST`` (ignored if it looks
         like a compiler)
      2. Master VIP from cluster ``ca_vips`` (fewest DNS labels)
      3. Compile host only when it is not a compiler (AIO)
      4. Empty — never bake a compiler hostname

    Keep in sync with ``scripts/pick_ca_server.py``.
    """
    exp = (explicit or "").strip().strip("\"'")
    if exp and not looks_like_compiler_host(exp):
        return exp
    vip = pick_master_ca_vip(ca_vips)
    if vip:
        return vip
    compile_n = (compile_host or "").strip().strip("\"'")
    if compile_n and not looks_like_compiler_host(compile_n):
        return compile_n
    return ""


def fleet_excluded_certnames() -> Set[str]:
    """DNS-only RR names that must not appear as live-fleet *nodes*.

    Hide names that are not VMs (``ovca.corp``, ``ovdb.corp``). Never hide
    ``ovcompilers.*`` even if someone lists them in a VIP field.

    Sources (union, case-insensitive):
      - cluster ``ca_vips``, ``dns_rr_vips``, ``vip_hosts``, ``fleet_exclude``
      - env ``OPENVOX_GUI_FLEET_EXCLUDE`` (comma/space/newline separated)

    ``infra_vips`` is **not** used here (compiler LB hostnames are agents).
    """
    out: Set[str] = set()
    try:
        cfg = load_cluster_config()
        for key in ("ca_vips", "dns_rr_vips", "vip_hosts", "fleet_exclude"):
            for h in cfg.get(key) or []:
                n = str(h).strip().lower()
                if n:
                    out.add(n)
    except Exception as e:
        logger.debug("fleet_exclude from cluster_config: %s", e)

    raw = (getattr(settings, "fleet_exclude", None) or "").strip()
    if raw:
        for part in raw.replace(",", " ").replace("\n", " ").split():
            n = part.strip().lower().split(":")[0]
            if n:
                out.add(n)
    return {n for n in out if not is_compiler_haproxy_agent(n)}


def is_fleet_excluded(certname: Optional[str]) -> bool:
    """True if *certname* is a VIP/LB name (or explicit fleet_exclude)."""
    n = (certname or "").strip().lower()
    if not n:
        return False
    return n in fleet_excluded_certnames()
