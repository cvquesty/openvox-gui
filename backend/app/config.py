"""
Application configuration with environment variable support.

All settings can be overridden via environment variables prefixed with
OPENVOX_GUI_ (for example, OPENVOX_GUI_SECRET_KEY) or via the .env file
located at /opt/openvox-gui/config/.env. The .env file is the
recommended way to configure the application in production.

Security-critical settings:
  - secret_key: Signs JWT authentication tokens and derives the key
    that encrypts stored ``enc:v1:`` secrets. The built-in default is
    an unset sentinel, not a key: the app and the encryption helpers
    refuse to run on it (or on an empty value) unless debug=True.
  - auth_backend: Controls which authentication strategy is active.
    The "none" backend disables all authentication and should only be
    used during initial setup or development.
"""
import logging
from pydantic_settings import BaseSettings
# Note: pydantic + pydantic-settings are kept at specific versions for security
# (see backend/requirements.txt and SECURITY.md for the 2.14.2 patch addressing
# GHSA-4xgf-cpjx-pc3j symlink issue in nested secrets handling).
from pathlib import Path
from typing import Optional

_config_logger = logging.getLogger(__name__)

# Sentinel meaning "OPENVOX_GUI_SECRET_KEY was never set". It is public, so
# it must never sign tokens or encrypt secrets outside debug mode; see
# secret_key_is_unset() and refuse_unset_secret_key().
_DEFAULT_SECRET_KEY = "__OPENVOX_GUI_SECRET_KEY_UNSET__"


class Settings(BaseSettings):
    """Application settings loaded from environment variables or the
    .env configuration file.

    Every field has a sensible default so the application can start
    out-of-the-box for development, but several values — particularly
    secret_key — MUST be overridden before running in production.
    """

    # ── Application identity and network binding ──────────────
    app_name: str = "OpenVox GUI"
    # Bind address for uvicorn.
    # "0.0.0.0" = all IPv4 interfaces
    # "::"      = all IPv6 + dual-stack (preferred default on modern systems)
    # Use "127.0.0.1" / "::1" / "localhost" to restrict to local only.
    app_host: str = "::"
    app_port: int = 4567
    debug: bool = False
    # When True, GUI skips Mantine pre-flight confirms for Bolt runs (command/task/plan),
    # r10k deploy, and single-node "Run OpenVox". Destructive actions (purge, certs, ENC
    # deletes, user delete) always keep their confirms.
    skip_adhoc_confirm_dialogs: bool = False

    # Signs JWTs and keys enc:v1: at-rest secrets. install.sh generates
    # one; a hand-built install must set OPENVOX_GUI_SECRET_KEY in .env.
    # Every console in a cluster uses the same value.
    secret_key: str = _DEFAULT_SECRET_KEY

    # ── PuppetServer connection settings ──────────────────────
    puppet_server_host: str = "localhost"
    puppet_server_port: int = 8140
    # Dedicated CA VIP/FQDN for clustered estates (console is not the CA).
    # Empty = use puppet_server_host (co-located / small install).
    # Multi-DC example: ovca.example.com  (NOT ovcompilers.*)
    puppet_ca_host: str = ""
    puppet_ca_port: int = 8140
    puppet_ssl_cert: str = "/etc/puppetlabs/puppet/ssl/certs/localhost.pem"
    puppet_ssl_key: str = "/etc/puppetlabs/puppet/ssl/private_keys/localhost.pem"
    puppet_ssl_ca: str = "/etc/puppetlabs/puppet/ssl/certs/ca.pem"
    puppet_confdir: str = "/etc/puppetlabs/puppet"
    puppet_codedir: str = "/etc/puppetlabs/code"

    # ── PuppetDB connection settings ──────────────────────────
    puppetdb_host: str = "localhost"
    puppetdb_port: int = 8081
    puppetdb_ssl: bool = True
    # Extra OpenVoxDB FQDNs to merge newest reports from (comma/space).
    # Dual-VIP estates: the other site's ovdb VIP so Overview matches.
    puppetdb_peers: Optional[str] = None

    # ── Database ──────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:////opt/openvox-gui/data/openvox_gui.db"

    # ── Authentication ────────────────────────────────────────
    # Supported backends: none | local | ldap  (saml and oidc planned)
    auth_backend: str = "none"
    # Minimum session lifetime (seconds). Forced logout must not fire
    # before this floor after login (VIP multi-console thrash protection).
    # Default 4 hours. JWT lifetime is auth_token_hours (separate, longer).
    auth_session_timeout: int = 14400  # seconds (≥ 4h enforced in code)
    # JWT absolute lifetime in hours (default 24). Never below 4.
    auth_token_hours: int = 24
    # Comma-separated VIP / public FQDNs for the console load balancer.
    # When the request Host matches one of these, the API reports
    # access_mode=vip so the SPA can soften polling and avoid reload storms.
    # Also mergeable via cluster_config.json "vip_hosts".
    # Example: console.example.com,console-a.example.com
    vip_hosts: Optional[str] = None
    # VIP poll floor (ms) advertised to the SPA — minimum auto-refresh interval
    # when access_mode=vip. Direct node FQDNs keep their page defaults.
    vip_poll_floor_ms: int = 45000
    # Hours after which a Failed latest-report is annotated stale
    # (Needs attention). Does not rewrite the badge. 0 = skip. Default 8.
    failed_alert_hours: float = 8.0
    # Hours after which any latest-report is annotated stale
    # (Needs attention). Does not rewrite the badge. 0 = skip. Default 24.
    node_fresh_hours: float = 24.0
    # Comma/space-separated certnames to hide from live fleet (HAProxy/DNS VIPs).
    # Merged with cluster_config ca_vips / infra_vips / vip_hosts / fleet_exclude.
    # Example: compilers.site-a.example.com,compilers.site-b.example.com
    fleet_exclude: Optional[str] = None

    # ── Filesystem paths ──────────────────────────────────────
    data_dir: str = "/opt/openvox-gui/data"
    log_dir: str = "/opt/openvox-gui/logs"

    # Optional bootstrap token for unauthenticated installer script routes
    # (OPENVOX_GUI_BOOTSTRAP_TOKEN). Empty = no token required.
    bootstrap_token: Optional[str] = None

    # Optional comma-separated IP/CIDR allowlist for installer script routes
    # (OPENVOX_GUI_INSTALLER_IP_ALLOWLIST). Empty = allow all (or use etc file).
    installer_ip_allowlist: Optional[str] = None

    # ── Proxy settings ────────────────────────────────────────
    # These are auto-detected during installation and used for
    # outbound API calls (e.g., to PuppetDB, external services)
    http_proxy: Optional[str] = None
    https_proxy: Optional[str] = None
    no_proxy: str = "localhost,127.0.0.1,::1,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,*.local"

    # ── Deploy webhook (GitHub) ───────────────────────────────
    # Shared secret used to verify HMAC signatures on incoming
    # webhook requests at /api/deploy/webhook. When set, requests
    # without a valid X-Hub-Signature-256 header are rejected with
    # 401. When empty, the webhook endpoint refuses ALL requests
    # (3.3.5-27 audit fix CRIT-3 -- the previous "anonymous, please
    # add an IP filter yourself" posture was an open r10k-deploy-as-
    # root entrypoint). Set this in your .env to enable the webhook,
    # then configure the same string as the secret in the GitHub
    # webhook settings.
    deploy_webhook_secret: str = ""

    # Strict regex for git refs accepted by the webhook (passed to
    # r10k-deploy.sh as the environment name). Matches what git itself
    # allows in branch names. Anything not matching is rejected.
    # Tightened from the previous lenient parser in 3.3.5-27.
    deploy_webhook_ref_pattern: str = r"^[a-zA-Z0-9._/-]{1,200}$"

    # ── Fleet Health Report (weekly, Monday 08:00 America/New_York) ──
    # Generated by scripts/generate_fleet_health_report.py (triggered by
    # openvox-gui-fleet-health.timer). When enabled, the report is
    # produced and (optionally) emailed directly from the server.
    fleet_health_report_enabled: bool = True
    # Comma or space-separated list of recipients.
    fleet_health_report_emails: str = ""
    # Where to save dated copies on the server (script default).
    fleet_health_report_output_dir: str = "/opt/openvox-gui/data/reports"

    # ── SSL / TLS for incoming connections ────────────────────
    # Enable SSL on the uvicorn server itself (not nginx). If enabled,
    # the app serves HTTPS directly using the provided cert/key paths.
    # Defaults point to Puppet certs for convenience.
    ssl_enabled: bool = False
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_ca_certs: Optional[str] = None  # Optional: for client cert verification (mTLS)

    # ── Provisioning (VM builder) ────────────────────────────
    # Seed for the default vCenter connection when none is saved yet.
    # Connections saved on Provisioning → Settings (app DB; password
    # Fernet-encrypted) take precedence.
    vcenter_host: str = ""
    vcenter_port: int = 443
    vcenter_user: str = ""
    vcenter_password: str = ""
    vcenter_verify_ssl: bool = True
    vcenter_ca_bundle: str = ""
    # Development only: built-in fake provider inventory and provisioning.
    provisioning_fake: bool = False
    # "worker": the openvox-gui-provisioner service runs queued builds.
    # "inline": run builds inside the uvicorn worker that accepted them (dev/tests).
    provisioning_runner: str = "worker"
    provisioning_max_parallel: int = 2
    provisioning_max_active_per_user: int = 3
    provisioning_max_active_total: int = 10
    # Seconds between provider / CA / OpenVoxDB polls while a build waits.
    provisioning_poll_s: float = 10.0

    class Config:
        env_prefix = "OPENVOX_GUI_"
        env_file = "/opt/openvox-gui/config/.env"
        env_file_encoding = "utf-8"
        # Ignore unknown OPENVOX_GUI_* keys so a newer .env (e.g. PUPPET_CA_HOST)
        # cannot prevent an older build from starting (pydantic extra_forbidden).
        extra = "ignore"


settings = Settings()


def secret_key_is_unset(key: Optional[str]) -> bool:
    """True when ``key`` is empty or still the built-in sentinel."""
    return not (key or "").strip() or key == _DEFAULT_SECRET_KEY


def refuse_unset_secret_key(s: Optional[Settings] = None) -> bool:
    """True when the process must not run on its secret key.

    An unset key is allowed only with debug=True, in every auth backend:
    auth=none still encrypts stored secrets with it.
    """
    s = s or settings
    return secret_key_is_unset(s.secret_key) and not s.debug


# ── Startup safety check ──────────────────────────────────────
if secret_key_is_unset(settings.secret_key):
    _config_logger.warning(
        "SECURITY: OPENVOX_GUI_SECRET_KEY is not set. %s",
        "Allowed only because debug=True."
        if settings.debug
        else "The GUI will refuse to start. Set a random value in .env "
        "(python3 -c 'import secrets; print(secrets.token_hex(32))').",
    )
