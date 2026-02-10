"""
Application configuration with environment variable support.
"""
from pydantic_settings import BaseSettings
from pathlib import Path
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment or config file."""

    # Application
    app_name: str = "OpenVox GUI"
    app_host: str = "0.0.0.0"
    app_port: int = 4567
    debug: bool = False
    secret_key: str = "change-me-in-production"

    # PuppetServer
    puppet_server_host: str = "openvox.questy.org"
    puppet_server_port: int = 8140
    puppet_ssl_cert: str = "/etc/puppetlabs/puppet/ssl/certs/openvox.questy.org.pem"
    puppet_ssl_key: str = "/etc/puppetlabs/puppet/ssl/private_keys/openvox.questy.org.pem"
    puppet_ssl_ca: str = "/etc/puppetlabs/puppet/ssl/certs/ca.pem"
    puppet_confdir: str = "/etc/puppetlabs/puppet"
    puppet_codedir: str = "/etc/puppetlabs/code"

    # PuppetDB
    puppetdb_host: str = "openvox.questy.org"
    puppetdb_port: int = 8081
    puppetdb_ssl: bool = True

    # Database
    database_url: str = "sqlite+aiosqlite:////opt/openvox-gui/data/openvox_gui.db"

    # Auth (pluggable - future)
    auth_backend: str = "none"  # none | local | ldap | saml | oidc
    auth_session_timeout: int = 3600

    # Paths
    data_dir: str = "/opt/openvox-gui/data"
    log_dir: str = "/opt/openvox-gui/logs"

    class Config:
        env_prefix = "OPENVOX_GUI_"
        env_file = "/opt/openvox-gui/config/.env"
        env_file_encoding = "utf-8"


settings = Settings()
