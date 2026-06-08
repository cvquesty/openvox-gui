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

        try:
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
        except Exception as e:
            logger.warning(f"Failed to parse PuppetDB pool settings: {e}")
            return {"read": None, "write": None}

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

    # ─────────────────────────────────────────────────────────────────────────────
    # JVM / Sysconfig handling (Puppet Server and PuppetDB)
    # ─────────────────────────────────────────────────────────────────────────────

    def _read_sysconfig_java_args(self, service: str) -> str:
        """Read JAVA_ARGS from /etc/sysconfig/<service>."""
        try:
            sysconfig = Path(f"/etc/sysconfig/{service}")
            if not sysconfig.exists():
                return ""
            content = sysconfig.read_text()
            for line in content.splitlines():
                if line.strip().startswith("JAVA_ARGS"):
                    # JAVA_ARGS="-Xms2g -Xmx2g ..."
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return val
            return ""
        except Exception as e:
            logger.warning(f"Failed to read sysconfig JAVA_ARGS for {service}: {e}")
            return ""

    def get_puppetserver_jvm_settings(self) -> Dict[str, Any]:
        """Return parsed JVM settings for Puppet Server."""
        args = self._read_sysconfig_java_args("puppetserver")
        return self._parse_java_args(args)

    def get_puppetdb_jvm_settings(self) -> Dict[str, Any]:
        """Return parsed JVM settings for PuppetDB."""
        args = self._read_sysconfig_java_args("puppetdb")
        return self._parse_java_args(args)

    def _parse_java_args(self, args: str) -> Dict[str, Any]:
        """Very lightweight parser for common JVM flags we care about."""
        result = {
            "raw": args,
            "heap_min": None,
            "heap_max": None,
            "reserved_code_cache": None,
        }

        import re
        m = re.search(r"-Xms(\d+)([gGmM])", args)
        if m:
            size = int(m.group(1))
            unit = m.group(2).lower()
            result["heap_min"] = f"{size}{unit}"

        m = re.search(r"-Xmx(\d+)([gGmM])", args)
        if m:
            size = int(m.group(1))
            unit = m.group(2).lower()
            result["heap_max"] = f"{size}{unit}"

        m = re.search(r"-XX:ReservedCodeCacheSize=(\d+)([gGmM])", args)
        if m:
            size = int(m.group(1))
            unit = m.group(2).lower()
            result["reserved_code_cache"] = f"{size}{unit}"

        return result

    def set_puppetserver_jvm_heap(self, heap_gb: int) -> Path:
        """
        Set both -Xms and -Xmx to the same value in /etc/sysconfig/puppetserver.

        Creates backup first.
        """
        sysconfig = Path("/etc/sysconfig/puppetserver")
        backup_dir = self._create_backup_dir("puppetserver")
        shutil.copy2(sysconfig, backup_dir / "puppetserver")

        content = sysconfig.read_text()
        new_heap = f"-Xms{heap_gb}g -Xmx{heap_gb}g"

        # Replace existing -Xms/-Xmx or append
        import re
        new_content = re.sub(r"-Xms\d+[gGmM]?\s*-Xmx\d+[gGmM]?", new_heap, content)
        if new_content == content:
            # No existing heap flags found — append to JAVA_ARGS line or add one
            if "JAVA_ARGS" in content:
                new_content = re.sub(
                    r'(JAVA_ARGS\s*=\s*")([^"]*)(")',
                    rf'\1\2 {new_heap}\3',
                    content
                )
            else:
                new_content = content.rstrip() + f'\nJAVA_ARGS="{new_heap}"\n'

        sysconfig.write_text(new_content)
        logger.info(f"Set Puppet Server JVM heap to {heap_gb}g (backup in {backup_dir})")
        return backup_dir

    def set_puppetserver_reserved_code_cache(self, size: str) -> Path:
        """
        Set -XX:ReservedCodeCacheSize (e.g. "1g" or "512m").

        Creates backup first.
        """
        sysconfig = Path("/etc/sysconfig/puppetserver")
        backup_dir = self._create_backup_dir("puppetserver")
        shutil.copy2(sysconfig, backup_dir / "puppetserver")

        content = sysconfig.read_text()
        flag = f"-XX:ReservedCodeCacheSize={size}"

        import re
        # Replace existing reserved code cache flag
        new_content = re.sub(r"-XX:ReservedCodeCacheSize=[^\s\"']+", flag, content)

        if new_content == content:
            # Not found — append to JAVA_ARGS
            if "JAVA_ARGS" in content:
                new_content = re.sub(
                    r'(JAVA_ARGS\s*=\s*")([^"]*)(")',
                    rf'\1\2 {flag}\3',
                    content
                )
            else:
                new_content = content.rstrip() + f'\nJAVA_ARGS="{flag}"\n'

        sysconfig.write_text(new_content)
        logger.info(f"Set Puppet Server ReservedCodeCacheSize to {size} (backup in {backup_dir})")
        return backup_dir
