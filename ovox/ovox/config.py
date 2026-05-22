"""
Configuration and credential management for ovox.

Locations (following XDG + common CLI conventions):
  $XDG_CONFIG_HOME/ovox/   or  ~/.config/ovox/
      config.yaml
      token               (mode 0600)
  $XDG_DATA_HOME/ovox/     or  ~/.local/share/ovox/   (future history, cache)

Environment overrides always win:
  OPENVOX_URL
  OPENVOX_TOKEN
  OPENVOX_OUTPUT   (table | json | yaml | csv)
"""

import os
import stat
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from pydantic import BaseModel, Field


DEFAULT_CONFIG_DIR = Path.home() / ".config" / "ovox"
DEFAULT_DATA_DIR = Path.home() / ".local" / "share" / "ovox"

# Sensible production default when running on the OpenVox server itself
DEFAULT_LOCAL_URL = "https://localhost:4567"

# Standard location of the Puppet CA bundle on any OpenVox/Puppet server.
# When the CLI is running locally and targeting the internal uvicorn listener
# (port 4567), this is the correct CA to validate the node's own certificate.
PUPPET_CA_BUNDLE = Path("/etc/puppetlabs/puppet/ssl/certs/ca.pem")


class OvoxConfig(BaseModel):
    """Persisted user configuration."""

    url: str = Field(default=DEFAULT_LOCAL_URL, description="Base URL of the OpenVox GUI API")
    output: str = Field(default="table", pattern="^(table|json|yaml|csv)$")
    timeout: int = 30
    verify_ssl: bool = True
    # Future: color, pager, default environment, etc.


class ConfigManager:
    """Handles loading/saving of ovox config and auth token."""

    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or Path(
            os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
        ) / "ovox"
        self.data_dir = Path(
            os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")
        ) / "ovox"
        self.config_file = self.config_dir / "config.yaml"
        self.token_file = self.config_dir / "token"
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # Tighten permissions on config dir (contains token)
        try:
            self.config_dir.chmod(0o700)
        except OSError:
            pass

    # ──────────────────────────────────────────────────────────────────────
    # Smart local server detection (makes "ovox" just work on the box)
    # ──────────────────────────────────────────────────────────────────────

    def _is_likely_local_openvox_server(self) -> bool:
        """Heuristic: are we running on the same machine that hosts the GUI?"""
        return PUPPET_CA_BUNDLE.exists()

    def _get_local_fqdn(self) -> str:
        """Best effort to get the machine's FQDN (what the Puppet cert is issued to)."""
        try:
            import socket
            fqdn = socket.getfqdn()
            if fqdn and "." in fqdn and not fqdn.startswith("localhost"):
                return fqdn
        except Exception:
            pass
        return "localhost"

    def get_effective_verify(self) -> bool | str:
        """
        Return the value that should be passed to httpx `verify=`.

        Rules (in priority order):
        - Explicit OPENVOX_VERIFY_SSL env var wins (true/false)
        - If user set verify_ssl=False in their config file, respect it
        - If targeting the *internal* GUI listener (port 4567) while on a
          real OpenVox server, use the Puppet CA bundle so the node's own
          certificate validates cleanly.
        - Otherwise fall back to normal system trust (True).
        """
        cfg = self.load_config()

        # 1. Hard env override
        if verify_env := os.environ.get("OPENVOX_VERIFY_SSL"):
            if verify_env.lower() in ("0", "false", "no", "off"):
                return False
            return True

        # 2. User explicitly turned it off in ~/.config/ovox/config.yaml
        if cfg.verify_ssl is False:
            return False

        # 3. Smart local case: we are on the server and hitting the internal port
        url = (os.environ.get("OPENVOX_URL") or cfg.url or "").lower()
        if ":4567" in url or "/localhost" in url or "127.0.0.1" in url:
            if self._is_likely_local_openvox_server() and PUPPET_CA_BUNDLE.exists():
                return str(PUPPET_CA_BUNDLE)

        # 4. Normal public / LE case — use system / certifi trust store
        return True

    def load_config(self) -> OvoxConfig:
        """Load persisted config, falling back to defaults + env overrides."""
        cfg = OvoxConfig()

        if self.config_file.exists():
            try:
                raw = yaml.safe_load(self.config_file.read_text(encoding="utf-8")) or {}
                if isinstance(raw, dict):
                    cfg = OvoxConfig(**{**cfg.model_dump(), **raw})
            except Exception:
                # Corrupt config is non-fatal; we just use defaults
                pass

        # Environment always wins
        if url := os.environ.get("OPENVOX_URL"):
            cfg.url = url.rstrip("/")
        if out := os.environ.get("OPENVOX_OUTPUT"):
            if out in ("table", "json", "yaml", "csv"):
                cfg.output = out
        if timeout := os.environ.get("OPENVOX_TIMEOUT"):
            try:
                cfg.timeout = int(timeout)
            except ValueError:
                pass
        if verify := os.environ.get("OPENVOX_VERIFY_SSL"):
            cfg.verify_ssl = verify.lower() not in ("0", "false", "no")

        return cfg

    def save_config(self, cfg: OvoxConfig) -> None:
        """Persist non-sensitive config (URL, output prefs, etc.)."""
        self._ensure_dirs()
        data = cfg.model_dump(exclude_unset=True)
        self.config_file.write_text(yaml.safe_dump(data, sort_keys=True), encoding="utf-8")

    def get_token(self) -> Optional[str]:
        """Return the stored JWT token (from env or disk)."""
        if token := os.environ.get("OPENVOX_TOKEN"):
            return token
        if self.token_file.exists():
            try:
                return self.token_file.read_text(encoding="utf-8").strip()
            except OSError:
                return None
        return None

    def save_token(self, token: str) -> None:
        """Write token with strict 0600 permissions."""
        self._ensure_dirs()
        self.token_file.write_text(token + "\n", encoding="utf-8")
        try:
            self.token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError:
            pass

    def clear_token(self) -> None:
        """Remove any stored token (logout)."""
        try:
            if self.token_file.exists():
                self.token_file.unlink()
        except OSError:
            pass

    def get_effective_url(self) -> str:
        """Return the URL after all overrides (never ends with /)."""
        cfg = self.load_config()
        url = os.environ.get("OPENVOX_URL", cfg.url)

        # If the user hasn't customized the URL and we are on a real OpenVox
        # server, prefer the machine's own FQDN (the name the internal cert is
        # issued to) instead of the generic "localhost".
        if url.rstrip("/") == DEFAULT_LOCAL_URL.rstrip("/") and self._is_likely_local_openvox_server():
            fqdn = self._get_local_fqdn()
            if fqdn != "localhost":
                url = f"https://{fqdn}:4567"

        return url.rstrip("/")


def get_config_manager() -> ConfigManager:
    """Convenience factory (allows tests to inject temp dirs)."""
    return ConfigManager()
