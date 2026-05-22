"""
Infrastructure Configuration Service for ovox infra tune.

Provides clean reading, writing, and backup of key tuning parameters for:
- OpenVox Server / Puppet Server (HOCON configs)
- OpenVoxDB / PuppetDB (INI configs)

All mutations create timestamped backups before writing.
"""

import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from pyhocon import ConfigFactory, ConfigTree

logger = logging.getLogger(__name__)


class InfraConfigService:
    """High-level service for reading and safely mutating infrastructure tuning settings."""

    def __init__(self):
        self.puppet_confdir = Path("/etc/puppetlabs/puppetserver")
        self.puppetdb_confdir = Path("/etc/puppetlabs/puppetdb")

    # ─────────────────────────────────────────────────────────────────────────────
    # Backup helpers
    # ─────────────────────────────────────────────────────────────────────────────

    def _create_backup_dir(self, component: str) -> Path:
        """Create and return a timestamped backup directory for the component."""
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_root = Path(f"/etc/puppetlabs/{component}/backups/ovox-infra-{ts}")
        backup_root.mkdir(parents=True, exist_ok=True)
        return backup_root

    # ─────────────────────────────────────────────────────────────────────────────
    # Puppet Server (OpenVox Server) configuration
    # ─────────────────────────────────────────────────────────────────────────────

    def get_puppetserver_jruby_max_active(self) -> Optional[int]:
        """Read current jruby-puppet.max-active-instances from puppetserver.conf."""
        conf_file = self.puppet_confdir / "conf.d" / "puppetserver.conf"
        if not conf_file.exists():
            return None

        try:
            config = ConfigFactory.parse_file(str(conf_file))
            jruby = config.get("jruby-puppet", {})
            if isinstance(jruby, ConfigTree):
                val = jruby.get("max-active-instances")
            else:
                val = jruby.get("max-active-instances") if hasattr(jruby, "get") else None
            return int(val) if val is not None else None
        except Exception as e:
            logger.warning(f"Failed to parse Puppet Server jruby setting: {e}")
            return None

    def set_puppetserver_jruby_max_active(self, value: int) -> Path:
        """
        Set jruby-puppet.max-active-instances.

        Creates a backup of the config file first.
        Returns the backup directory used.
        """
        conf_file = self.puppet_confdir / "conf.d" / "puppetserver.conf"
        backup_dir = self._create_backup_dir("puppetserver")
        shutil.copy2(conf_file, backup_dir / "puppetserver.conf")

        # Use pyhocon to safely update
        config = ConfigFactory.parse_file(str(conf_file))

        if "jruby-puppet" not in config:
            config["jruby-puppet"] = {}

        config["jruby-puppet"]["max-active-instances"] = value

        # Write back in a reasonably pretty HOCON style
        with open(conf_file, "w") as f:
            f.write(config.to_HOCON())

        logger.info(f"Updated Puppet Server max-active-instances to {value} (backup in {backup_dir})")
        return backup_dir

    # ─────────────────────────────────────────────────────────────────────────────
    # PuppetDB (OpenVoxDB) configuration
    # ─────────────────────────────────────────────────────────────────────────────

    def get_puppetdb_pool_settings(self) -> Dict[str, Optional[int]]:
        """Read current read_pool and write_pool max_connections from database.ini."""
        db_conf = self.puppetdb_confdir / "conf.d" / "database.ini"
        if not db_conf.exists():
            return {"read": None, "write": None}

        import configparser
        parser = configparser.ConfigParser()
        parser.read(str(db_conf))

        result = {}
        for pool in ("read_pool", "write_pool"):
            if parser.has_section(pool) and parser.has_option(pool, "max_connections"):
                try:
                    result[pool.replace("_pool", "")] = int(parser.get(pool, "max_connections"))
                except ValueError:
                    result[pool.replace("_pool", "")] = None
            else:
                result[pool.replace("_pool", "")] = None
        return result

    def set_puppetdb_pool_settings(self, read_max: Optional[int] = None, write_max: Optional[int] = None) -> Path:
        """
        Update PuppetDB read_pool and/or write_pool max_connections.

        Creates backup of database.ini first.
        """
        db_conf = self.puppetdb_confdir / "conf.d" / "database.ini"
        backup_dir = self._create_backup_dir("puppetdb")
        shutil.copy2(db_conf, backup_dir / "database.ini")

        import configparser
        parser = configparser.ConfigParser()
        parser.read(str(db_conf))

        changed = []
        if read_max is not None:
            if not parser.has_section("read_pool"):
                parser.add_section("read_pool")
            parser.set("read_pool", "max_connections", str(read_max))
            changed.append(f"read_pool.max_connections={read_max}")

        if write_max is not None:
            if not parser.has_section("write_pool"):
                parser.add_section("write_pool")
            parser.set("write_pool", "max_connections", str(write_max))
            changed.append(f"write_pool.max_connections={write_max}")

        with open(db_conf, "w") as f:
            parser.write(f)

        logger.info(f"Updated PuppetDB pools: {changed} (backup in {backup_dir})")
        return backup_dir
