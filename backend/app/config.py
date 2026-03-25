"""
Application configuration with environment variable support.

All settings can be overridden via environment variables prefixed with
OPENVOX_GUI_ (for example, OPENVOX_GUI_SECRET_KEY) or via the .env file
located at /opt/openvox-gui/config/.env. The .env file is the
recommended way to configure the application in production.

Security-critical settings:
  - secret_key: Used to sign JWT authentication tokens. If left at
    the default value in production, an attacker who knows the default
    can forge valid tokens and gain admin access. A loud warning is
    emitted at startup if the default is still in use and authentication
    is enabled.
  - auth_backend: Controls which authentication strategy is active.
    The "none" backend disables all authentication and should only be
    used during initial setup or development.
"""
import logging
from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Optional

_config_logger = logging.getLogger(__name__)

# This is the well-known default value that ships in the codebase. We
# compare against it at startup to detect whether the operator forgot to
# set a real secret. It must never be used in production because anyone
# who can read this source code could forge valid JWT tokens.
_DEFAULT_SECRET_KEY = "change-me-in-production"


class Settings(BaseSettings):
    """Application settings loaded from environment variables or the
    .env configuration file.

    Every field has a sensible default so the application can start
    out-of-the-box for development, but several values — particularly
    secret_key — MUST be overridden before running in production.
    """

    # ── Application identity and network binding ──────────────
    app_name: str = "OpenVox GUI"
    app_host: str = "0.0.0.0"
    app_port: int = 4567
    debug: bool = False

    # Secret key used for signing JWT authentication tokens. This MUST
    # be changed to a unique, random value in production. The install
    # script generates one automatically, but if the application is
    # deployed manually, the operator must set OPENVOX_GUI_SECRET_KEY
    # in the .env file.
    secret_key: str = _DEFAULT_SECRET_KEY

    # ── PuppetServer connection settings ──────────────────────
    puppet_server_host: str = "localhost"
    puppet_server_port: int = 8140
    puppet_ssl_cert: str = "/etc/puppetlabs/puppet/ssl/certs/localhost.pem"
    puppet_ssl_key: str = "/etc/puppetlabs/puppet/ssl/private_keys/localhost.pem"
    puppet_ssl_ca: str = "/etc/puppetlabs/puppet/ssl/certs/ca.pem"
    puppet_confdir: str = "/etc/puppetlabs/puppet"
    puppet_codedir: str = "/etc/puppetlabs/code"

    # ── PuppetDB connection settings ──────────────────────────
    puppetdb_host: str = "localhost"
    puppetdb_port: int = 8081
    puppetdb_ssl: bool = True

    # ── Database ──────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:////opt/openvox-gui/data/openvox_gui.db"

    # ── Authentication ────────────────────────────────────────
    # Supported backends: none | local | ldap  (saml and oidc planned)
    auth_backend: str = "none"
    auth_session_timeout: int = 3600  # seconds

    # ── Filesystem paths ──────────────────────────────────────
    data_dir: str = "/opt/openvox-gui/data"
    log_dir: str = "/opt/openvox-gui/logs"

    # ── Proxy settings ────────────────────────────────────────
    # These are auto-detected during installation and used for
    # outbound API calls (e.g., to PuppetDB, external services)
    http_proxy: Optional[str] = None
    https_proxy: Optional[str] = None
    no_proxy: str = "localhost,127.0.0.1,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,*.local,*.local.twitter.com,*.twitter.com,*.corp"

    class Config:
        env_prefix = "OPENVOX_GUI_"
        env_file = "/opt/openvox-gui/config/.env"
        env_file_encoding = "utf-8"


settings = Settings()

# ── Startup safety check ──────────────────────────────────────
# Emit a loud warning if the operator has enabled authentication but
# forgot to change the secret key from its well-known default value.
# In that scenario, any attacker who can read this source code could
# forge valid JWT tokens and authenticate as any user, including admin.
if settings.secret_key == _DEFAULT_SECRET_KEY and settings.auth_backend != "none":
    _config_logger.warning(
        "╔══════════════════════════════════════════════════════════════╗\n"
        "║  SECURITY WARNING: secret_key is still set to the default  ║\n"
        "║  value. Anyone who knows the default can forge JWT tokens   ║\n"
        "║  and gain admin access. Set OPENVOX_GUI_SECRET_KEY in your  ║\n"
        "║  .env file to a unique, random value immediately.           ║\n"
        "╚══════════════════════════════════════════════════════════════╝"
    )
