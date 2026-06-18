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
import httpx
import ssl
import urllib.parse
from ..config import settings

logger = logging.getLogger(__name__)


class PuppetServerService:
    """Service for managing PuppetServer configuration."""

    def __init__(self):
        self.confdir = Path(settings.puppet_confdir)
        self.codedir = Path(settings.puppet_codedir)
        # For metrics / health queries to Puppet Server (same mTLS certs as PuppetDB)
        self.ps_base_url = f"https://{settings.puppet_server_host}:{settings.puppet_server_port}"
        self._ps_client: Optional[httpx.AsyncClient] = None

    def _create_ps_ssl_context(self) -> ssl.SSLContext:
        """Create mTLS context using the Puppet agent's certs (same as PuppetDB)."""
        ctx = ssl.create_default_context(cafile=settings.puppet_ssl_ca)
        ctx.load_cert_chain(
            certfile=settings.puppet_ssl_cert,
            keyfile=settings.puppet_ssl_key,
        )
        return ctx

    async def _get_ps_client(self) -> httpx.AsyncClient:
        if self._ps_client is None or self._ps_client.is_closed:
            self._ps_client = httpx.AsyncClient(
                base_url=self.ps_base_url,
                verify=self._create_ps_ssl_context(),
                timeout=30.0,
            )
        return self._ps_client

    async def close(self):
        if self._ps_client and not self._ps_client.is_closed:
            await self._ps_client.aclose()

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
        allowed = {"puppetserver", "puppetdb", "puppet", "openvox-gui"}
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

    # ─── Puppet Server Metrics & Health (for Metrics | PuppetServer Health) ───

    async def get_ps_status(self, service: str = "master", level: Optional[str] = None) -> Dict[str, Any]:
        """Fetch Puppet Server status.

        service: usually "master"
        level: optionally "debug" to get more detail (passed as ?level=debug)
        """
        try:
            client = await self._get_ps_client()
            url = f"/status/v1/services/{service}"
            params = {}
            if level:
                params["level"] = level
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Failed to get Puppet Server status for {service}: {e}")
            return {}

    async def get_ps_metrics(self, mbean: str) -> Dict[str, Any]:
        """Query a specific JMX/mbean from Puppet Server's /metrics/v2 (Jolokia-style).

        Tries both raw and URL-encoded mbean name for compatibility.
        """
        client = await self._get_ps_client()
        candidates = [
            mbean,
            urllib.parse.quote(mbean, safe=""),
            mbean.replace(":", "%3A").replace("=", "%3D").replace(",", "%2C"),
        ]
        for name in candidates:
            try:
                resp = await client.get(f"/metrics/v2/read/{name}")
                if resp.status_code == 200:
                    data = resp.json()
                    # Some responses wrap, some return value directly
                    if data and (isinstance(data, dict) and data.get("value") is not None or "HeapMemoryUsage" in str(data)):
                        return data
            except Exception as e:
                logger.debug(f"PS metrics attempt for {name} failed: {e}")
                continue
        logger.debug(f"Failed to get Puppet Server metric {mbean} after attempts (may be expected if metrics/v2 restricted)")
        return {}

    async def list_ps_metrics(self) -> Dict[str, Any]:
        """List available metrics beans from Puppet Server."""
        try:
            client = await self._get_ps_client()
            resp = await client.get("/metrics/v2/list")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Failed to list Puppet Server metrics: {e}")
            return {"error": str(e)}

    async def get_ps_health_snapshot(self) -> Dict[str, Any]:
        """Convenience snapshot combining status + key JVM/metrics for the health page.

        Tries basic status first, then with level=debug for richer data.
        Uses flexible key lookup because Puppet Server status structure varies by version/config.
        """
        result: Dict[str, Any] = {
            "status": None,
            "jvm_heap": None,
            "compile_time_ms": None,
            "jruby_active": None,
            "jruby_max": None,
            "raw": {},
        }

        def _find_key(obj: Any, keys: List[str]) -> Any:
            """Recursively search for a key in nested dicts."""
            if not isinstance(obj, dict):
                return None
            for k in keys:
                if k in obj:
                    return obj[k]
            for v in obj.values():
                found = _find_key(v, keys)
                if found is not None:
                    return found
            return None

        # Fetch status - try full services list first (more reliable), prefer level=debug for rich data (info level often has empty "status")
        status = None
        try:
            client = await self._get_ps_client()
            resp = await client.get("/status/v1/services?level=debug")
            full = resp.json()
            if isinstance(full, dict):
                if "master" in full:
                    status = full
                else:
                    status = full
        except Exception:
            pass

        if not status:
            status = await self.get_ps_status("master", level="debug")

        if not status:
            # fallback without debug
            try:
                client = await self._get_ps_client()
                resp = await client.get("/status/v1/services")
                full = resp.json()
                if isinstance(full, dict):
                    status = full.get("master") or full
            except Exception:
                pass

        if status:
            master = status.get("master", {}) if isinstance(status, dict) else {}
            if not master and isinstance(status, dict):
                master = status
            result["status"] = master.get("state", "unknown") if isinstance(master, dict) else "unknown"

            svc = {}
            if isinstance(master, dict):
                svc = master.get("status", {}) or {}
            if not svc and isinstance(status, dict):
                svc = status.get("status", {}) or status

            result["raw"]["status"] = svc

            # Compile time - very common key, search broadly
            compile_val = None
            for search_target in [svc, master, status]:
                if compile_val is None:
                    compile_val = _find_key(search_target, [
                        "average_compile_time_ms", "avg_compile_time_ms",
                        "average_compile_time", "compile_time_ms"
                    ])
            if compile_val is not None:
                result["compile_time_ms"] = compile_val

            # JRuby pool info - try common locations, search broadly
            jruby_active = None
            jruby_max = None
            for search_target in [svc, master, status]:
                if jruby_active is None:
                    jruby_active = _find_key(search_target, [
                        "num_jrubies", "current_jruby_instances", "jruby_instances",
                        "active_jrubies", "current_active_jrubies"
                    ])
                if jruby_max is None:
                    jruby_max = _find_key(search_target, [
                        "max_jrubies", "max_active_jrubies", "max_jruby_instances"
                    ])

            jruby_section = _find_key(svc, ["jruby", "jruby_puppet"]) or _find_key(master, ["jruby", "jruby_puppet"]) or {}
            if isinstance(jruby_section, dict):
                jruby_active = jruby_active or jruby_section.get("num_jrubies") or jruby_section.get("active_instances") or jruby_section.get("current")
                jruby_max = jruby_max or jruby_section.get("max_jrubies") or jruby_section.get("max_active_instances")

            if jruby_active is not None:
                result["jruby_active"] = jruby_active
            if jruby_max is not None:
                result["jruby_max"] = jruby_max

            # Direct common keys as additional fallback (some responses put them at master level)
            if result.get("compile_time_ms") is None:
                for k in ["average_compile_time_ms", "compile_time_ms", "avg_compile_time_ms"]:
                    if k in master:
                        result["compile_time_ms"] = master[k]
                        break
                    if k in svc:
                        result["compile_time_ms"] = svc[k]
                        break
            if result.get("jruby_active") is None:
                for k in ["num_jrubies", "current_jruby_instances", "jruby_instances"]:
                    if k in master:
                        result["jruby_active"] = master[k]
                        break
                    if k in svc:
                        result["jruby_active"] = svc[k]
                        break
            if result.get("jruby_max") is None:
                for k in ["max_jrubies", "max_active_jrubies"]:
                    if k in master:
                        result["jruby_max"] = master[k]
                        break
                    if k in svc:
                        result["jruby_max"] = svc[k]
                        break

            # Last resort scan for keys containing relevant terms (handles version differences)
            if result.get("compile_time_ms") is None:
                for k, v in list(master.items()) + list(svc.items()):
                    if isinstance(k, str) and "compile" in k.lower() and isinstance(v, (int, float)):
                        result["compile_time_ms"] = v
                        break
            if result.get("jruby_active") is None:
                for k, v in list(master.items()) + list(svc.items()):
                    if isinstance(k, str) and "jruby" in k.lower() and isinstance(v, (int, float)):
                        if any(x in k.lower() for x in ["num", "current", "active", "instances"]):
                            result["jruby_active"] = v
                            break
            if result.get("jruby_max") is None:
                for k, v in list(master.items()) + list(svc.items()):
                    if isinstance(k, str) and "jruby" in k.lower() and "max" in k.lower() and isinstance(v, (int, float)):
                        result["jruby_max"] = v
                        break

            # Fallback to experimental http-metrics (available in current PS 8.x debug status)
            # since traditional keys and /metrics/v2 may not be present/accessible.
            # Use catalog mean as compile proxy, total mean as activity.
            # Search the entire response tree for the http-metrics list
            def _find_http_metrics(obj, results=None):
                if results is None:
                    results = []
                if isinstance(obj, dict):
                    for key in ["http-metrics", "http-client-metrics"]:
                        if key in obj and isinstance(obj[key], list):
                            results.append(obj[key])
                    for v in obj.values():
                        _find_http_metrics(v, results)
                elif isinstance(obj, list):
                    for item in obj:
                        _find_http_metrics(item, results)
                return results

            http_metrics_lists = _find_http_metrics(status) or _find_http_metrics(svc) or _find_http_metrics(master) or []
            http_m = []
            for lst in http_metrics_lists:
                if isinstance(lst, list):
                    http_m.extend([it for it in lst if isinstance(it, dict)])

            def get_id(it):
                if not isinstance(it, dict):
                    return ""
                # Try common id field names (route-id is Puppet's for experimental routes; metric-id for others)
                for k in ("route-id", "route_id", "metric-id", "metric_id", "name", "id", "path", "route"):
                    val = it.get(k)
                    if val:
                        if isinstance(val, list):
                            return ".".join(str(x).lower() for x in val)
                        s = str(val).lower()
                        if s:
                            return s
                # Last resort: any field whose key hints at identity and whose value looks like an id
                for k, v in it.items():
                    if isinstance(k, str) and any(x in k.lower() for x in ("id", "route", "metric", "name")):
                        if isinstance(v, list):
                            return ".".join(str(x).lower() for x in v)
                        if isinstance(v, str):
                            return v.lower()
                return ""

            def _get_mean(it):
                if not isinstance(it, dict):
                    return None
                m = it.get("mean")
                if isinstance(m, (int, float)):
                    return m
                m = it.get("Mean")
                if isinstance(m, (int, float)):
                    return m
                return None

            def _get_count(it):
                if not isinstance(it, dict):
                    return None
                c = it.get("count")
                if isinstance(c, (int, float)):
                    return c
                c = it.get("Count")
                if isinstance(c, (int, float)):
                    return c
                return None

            # Collect candidates that have a numeric mean (supports mean or Mean)
            def _has_mean(it):
                return _get_mean(it) is not None

            # Find catalog/compile route(s)
            cat_candidates = [it for it in http_m
                              if isinstance(it, dict)
                              and (any(x in get_id(it) for x in ["catalog", "compile", "cat"])
                                   or any(x in str(it).lower() for x in ["catalog", "compile"]))
                              and _has_mean(it)]
            # Prefer the one with highest count (most traffic = most representative)
            cat_item = {}
            if cat_candidates:
                cat_item = max(cat_candidates, key=lambda x: _get_count(x) or 0)

            # Find total/overall
            tot_candidates = [it for it in http_m
                              if isinstance(it, dict)
                              and ("total" in get_id(it) or "total" in str(it).lower() or "requests" in get_id(it))
                              and _has_mean(it)]
            tot_item = {}
            if tot_candidates:
                tot_item = max(tot_candidates, key=lambda x: _get_count(x) or 0)

            # Ultra fallback: walk every item, score loosely on keywords in id or full str rep
            if not cat_item:
                for it in http_m:
                    if _has_mean(it) and any(x in (get_id(it) + " " + str(it).lower()) for x in ["catalog", "compile"]):
                        cat_item = it
                        break
            if not tot_item:
                for it in http_m:
                    if _has_mean(it) and "total" in (get_id(it) + " " + str(it).lower()):
                        tot_item = it
                        break

            # Set proxies (these are what the UI uses for the "Catalog Route Mean" and "Total Req Mean" charts)
            cm = _get_mean(cat_item)
            if cm is not None:
                result["compile_time_ms"] = cm
            tm = _get_mean(tot_item)
            if tm is not None:
                result["jruby_active"] = tm
            cc = _get_count(cat_item)
            if cc is not None:
                result["catalog_count"] = cc

            # Always store a generous sample + ids in raw so the UI "raw" block shows exactly what
            # the http-metrics list looks like (keys, route/metric ids, mean/Mean values). This is
            # the primary diagnostic when graphs are empty but "raw shows values".
            result["raw"]["http_metrics_sample"] = http_m[:8] if http_m else []
            result["raw"]["http_metrics_ids_sample"] = [get_id(x) for x in http_m[:8]] if http_m else []
            result["raw"]["http_metrics_count"] = len(http_m)
            if cat_item:
                result["raw"]["catalog_route"] = cat_item
            if tot_item:
                result["raw"]["total_route"] = tot_item
            # Also keep chosen means visible at top of raw for quick confirmation
            if cm is not None:
                result["raw"]["extracted_catalog_mean"] = cm
            if tm is not None:
                result["raw"]["extracted_total_mean"] = tm

        # JVM heap via metrics/v2 (primary). Falls back gracefully if not enabled.
        jvm = await self.get_ps_metrics("java.lang:type=Memory")
        if jvm and isinstance(jvm, dict):
            value = jvm.get("value", jvm)  # sometimes top level, sometimes wrapped
            mem = {}
            if isinstance(value, dict):
                mem = value.get("HeapMemoryUsage", value.get("heap", {}))
            if mem and isinstance(mem, dict) and mem.get("max"):
                used = mem.get("used", 0)
                maxm = mem.get("max", 1)
                result["jvm_heap"] = {
                    "used_mb": round(used / 1048576, 1),
                    "max_mb": round(maxm / 1048576, 1),
                    "committed_mb": round(mem.get("committed", 0) / 1048576, 1),
                    "pct": round(used / max(maxm, 1) * 100, 1),
                }
            result["raw"]["jvm"] = jvm

        return result

# Singleton
puppetserver_service = PuppetServerService()
