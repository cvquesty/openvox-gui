"""
PuppetServer management service.
Reads/writes Puppet configuration files and manages the Puppet server.
"""
import subprocess
import logging
import configparser
import json
import os
import glob
from pathlib import Path
from typing import Dict, List, Optional, Any
from ..config import settings

logger = logging.getLogger(__name__)


class PuppetServerService:
    """Service for managing PuppetServer configuration."""

    def __init__(self):
        self.confdir = Path(settings.puppet_confdir)
        self.codedir = Path(settings.puppet_codedir)

    # ─── puppet.conf ────────────────────────────────────────

    def read_puppet_conf(self) -> Dict[str, Any]:
        """Read and parse puppet.conf."""
        conf_path = self.confdir / "puppet.conf"
        config = configparser.ConfigParser()
        config.read(str(conf_path))
        result = {}
        for section in config.sections():
            result[section] = dict(config[section])
        return result

    def update_puppet_conf(self, section: str, key: str, value: str) -> bool:
        """Update a setting in puppet.conf."""
        conf_path = self.confdir / "puppet.conf"
        config = configparser.ConfigParser()
        config.read(str(conf_path))
        if not config.has_section(section):
            config.add_section(section)
        config.set(section, key, value)
        try:
            with open(conf_path, 'w') as f:
                config.write(f)
            return True
        except PermissionError:
            logger.error(f"Permission denied writing to {conf_path}")
            return False

    # ─── Environments ───────────────────────────────────────

    def list_environments(self) -> List[str]:
        """List available Puppet environments."""
        env_path = self.codedir / "environments"
        if not env_path.exists():
            return []
        return [d.name for d in env_path.iterdir() if d.is_dir()]

    def list_modules(self, environment: str = "production") -> List[Dict[str, str]]:
        """List modules in an environment."""
        modules_path = self.codedir / "environments" / environment / "modules"
        if not modules_path.exists():
            return []
        result = []
        for mod_dir in sorted(modules_path.iterdir()):
            if mod_dir.is_dir():
                metadata = mod_dir / "metadata.json"
                info = {"name": mod_dir.name, "path": str(mod_dir)}
                if metadata.exists():
                    try:
                        with open(metadata) as f:
                            meta = json.load(f)
                        info["version"] = meta.get("version", "unknown")
                        info["author"] = meta.get("author", "unknown")
                        info["summary"] = meta.get("summary", "")
                    except Exception:
                        pass
                result.append(info)
        return result

    # ─── Available Puppet Classes ───────────────────────────

    def list_available_classes(self, environment: str = "production") -> List[Dict[str, Any]]:
        """
        Discover available Puppet classes from modules in an environment.
        Scans manifests/*.pp files for 'class <name>' declarations.
        Returns a list of {name, module, file} dicts.
        """
        import re
        modules_path = self.codedir / "environments" / environment / "modules"
        classes = []
        if not modules_path.exists():
            return classes

        class_pattern = re.compile(r'^\s*class\s+([\w:]+)', re.MULTILINE)

        for mod_dir in sorted(modules_path.iterdir()):
            if not mod_dir.is_dir():
                continue
            module_name = mod_dir.name
            manifests_dir = mod_dir / "manifests"
            if not manifests_dir.exists():
                continue
            for pp_file in manifests_dir.rglob("*.pp"):
                try:
                    content = pp_file.read_text(errors='ignore')
                    for match in class_pattern.finditer(content):
                        class_name = match.group(1)
                        classes.append({
                            "name": class_name,
                            "module": module_name,
                            "file": str(pp_file.relative_to(modules_path)),
                        })
                except Exception as e:
                    logger.debug(f"Error reading {pp_file}: {e}")
                    continue

        # Also scan site modules if present
        site_path = self.codedir / "environments" / environment / "site"
        if site_path.exists():
            for mod_dir in sorted(site_path.iterdir()):
                if not mod_dir.is_dir():
                    continue
                module_name = mod_dir.name
                manifests_dir = mod_dir / "manifests"
                if not manifests_dir.exists():
                    continue
                for pp_file in manifests_dir.rglob("*.pp"):
                    try:
                        content = pp_file.read_text(errors='ignore')
                        for match in class_pattern.finditer(content):
                            class_name = match.group(1)
                            classes.append({
                                "name": class_name,
                                "module": module_name,
                                "file": str(pp_file.relative_to(site_path)),
                            })
                    except Exception:
                        continue

        # Sort by class name
        classes.sort(key=lambda c: c["name"])
        return classes

    # ─── Service Management ─────────────────────────────────

    def get_service_status(self, service: str = "puppetserver") -> Dict[str, str]:
        """Get systemd service status."""
        try:
            result = subprocess.run(
                ["systemctl", "is-active", service],
                capture_output=True, text=True, timeout=5
            )
            active = result.stdout.strip()
            result2 = subprocess.run(
                ["systemctl", "show", service, "--property=ActiveEnterTimestamp,MainPID,MemoryCurrent"],
                capture_output=True, text=True, timeout=5
            )
            props = {}
            for line in result2.stdout.strip().split('\n'):
                if '=' in line:
                    k, v = line.split('=', 1)
                    props[k] = v
            return {
                "service": service,
                "status": active,
                "pid": props.get("MainPID", ""),
                "since": props.get("ActiveEnterTimestamp", ""),
                "memory": props.get("MemoryCurrent", ""),
            }
        except Exception as e:
            logger.error(f"Error checking service {service}: {e}")
            return {"service": service, "status": "unknown", "error": str(e)}

    def restart_service(self, service: str) -> Dict[str, str]:
        """Restart a systemd service."""
        allowed = {"puppetserver", "puppetdb", "puppet"}
        if service not in allowed:
            return {"status": "error", "message": f"Service {service} not allowed"}
        try:
            result = subprocess.run(
                ["sudo", "systemctl", "restart", service],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode == 0:
                return {"status": "success", "message": f"{service} restarted"}
            else:
                return {"status": "error", "message": result.stderr}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ─── PuppetServer Version ──────────────────────────────

    def get_version(self) -> Optional[str]:
        """Get PuppetServer version."""
        try:
            result = subprocess.run(
                ["puppetserver", "--version"],
                capture_output=True, text=True, timeout=10
            )
            return result.stdout.strip()
        except Exception:
            try:
                result = subprocess.run(
                    ["/opt/puppetlabs/bin/puppetserver", "--version"],
                    capture_output=True, text=True, timeout=10
                )
                return result.stdout.strip()
            except Exception:
                return None

    # ─── PuppetDB Config ───────────────────────────────────

    def read_puppetdb_config(self) -> Dict[str, Dict[str, str]]:
        """Read PuppetDB configuration files via sudo (puppetdb user owns them)."""
        pdb_confdir = "/etc/puppetlabs/puppetdb/conf.d"
        result = {}
        for conf_file in ["jetty.ini", "database.ini", "config.ini"]:
            filepath = f"{pdb_confdir}/{conf_file}"
            try:
                proc = subprocess.run(
                    ["sudo", "cat", filepath],
                    capture_output=True, text=True, timeout=5
                )
                if proc.returncode != 0:
                    continue
                content = proc.stdout
                config = configparser.ConfigParser()
                from io import StringIO
                config.read_string(content)
                file_data = {}
                for section in config.sections():
                    for key, value in config[section].items():
                        file_data[f"{section}.{key}"] = value
                if not config.sections():
                    for line in content.splitlines():
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            k, v = line.split('=', 1)
                            file_data[k.strip()] = v.strip()
                if file_data:
                    result[conf_file.replace('.ini', '')] = file_data
            except Exception as e:
                logger.warning(f"Could not read {filepath}: {e}")
                continue
        return result

    # ─── Hiera ─────────────────────────────────────────────

    def read_hiera_config(self) -> Dict[str, Any]:
        """Read hiera.yaml configuration."""
        import yaml
        hiera_path = self.confdir / "hiera.yaml"
        if not hiera_path.exists():
            return {}
        try:
            with open(hiera_path) as f:
                return yaml.safe_load(f) or {}
        except Exception as e:
            logger.error(f"Error reading hiera.yaml: {e}")
            return {"error": str(e)}

    def read_hiera_raw(self) -> str:
        """Read hiera.yaml as raw YAML text."""
        hiera_path = self.confdir / "hiera.yaml"
        if not hiera_path.exists():
            return ""
        try:
            return hiera_path.read_text()
        except Exception as e:
            logger.error(f"Error reading hiera.yaml: {e}")
            return ""

    def write_hiera_config(self, content: str) -> bool:
        """Write hiera.yaml content (raw YAML)."""
        import yaml
        hiera_path = self.confdir / "hiera.yaml"
        # Validate YAML before writing
        try:
            yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML: {e}")
        try:
            # Backup existing
            backup_path = str(hiera_path) + ".bak"
            if hiera_path.exists():
                import shutil
                shutil.copy2(str(hiera_path), backup_path)
            hiera_path.write_text(content)
            return True
        except PermissionError:
            logger.error(f"Permission denied writing to {hiera_path}")
            return False
        except Exception as e:
            logger.error(f"Error writing hiera.yaml: {e}")
            return False

    def list_hiera_data_files(self, environment: str = "production") -> List[Dict[str, Any]]:
        """
        List Hiera data files in an environment.
        Scans the data/ directory within the environment for .yaml files.
        """
        import yaml
        data_dirs = [
            self.codedir / "environments" / environment / "data",
            self.codedir / "environments" / environment / "hieradata",
        ]
        files = []
        for data_dir in data_dirs:
            if not data_dir.exists():
                continue
            for yaml_file in sorted(data_dir.rglob("*.yaml")):
                rel = str(yaml_file.relative_to(data_dir))
                try:
                    size = yaml_file.stat().st_size
                except Exception:
                    size = 0
                files.append({
                    "path": rel,
                    "full_path": str(yaml_file),
                    "size": size,
                    "data_dir": str(data_dir),
                })
            # Also check for .yml
            for yaml_file in sorted(data_dir.rglob("*.yml")):
                rel = str(yaml_file.relative_to(data_dir))
                try:
                    size = yaml_file.stat().st_size
                except Exception:
                    size = 0
                files.append({
                    "path": rel,
                    "full_path": str(yaml_file),
                    "size": size,
                    "data_dir": str(data_dir),
                })
        return files

    def read_hiera_data_file(self, file_path: str) -> str:
        """Read a Hiera data file (raw YAML content)."""
        # Security: ensure the path is within the codedir
        resolved = Path(file_path).resolve()
        codedir_resolved = self.codedir.resolve()
        if not str(resolved).startswith(str(codedir_resolved)):
            raise ValueError("Path traversal not allowed")
        if not resolved.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        return resolved.read_text()

    def write_hiera_data_file(self, file_path: str, content: str) -> bool:
        """Write a Hiera data file (raw YAML content)."""
        import yaml
        # Security: ensure the path is within the codedir
        resolved = Path(file_path).resolve()
        codedir_resolved = self.codedir.resolve()
        if not str(resolved).startswith(str(codedir_resolved)):
            raise ValueError("Path traversal not allowed")
        # Validate YAML
        try:
            yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML: {e}")
        try:
            # Backup
            if resolved.exists():
                import shutil
                shutil.copy2(str(resolved), str(resolved) + ".bak")
            resolved.write_text(content)
            return True
        except PermissionError:
            logger.error(f"Permission denied writing to {file_path}")
            return False


# Singleton
puppetserver_service = PuppetServerService()
