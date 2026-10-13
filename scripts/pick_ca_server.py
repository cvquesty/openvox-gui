#!/usr/bin/env python3
"""Choose the CA VIP baked into /opt/openvox-pkgs/install.bash.

install.sh, update_local.sh, and deploy.sh call this with the system
python3 (not the GUI venv). Keep the algorithm in sync with
backend/app/services/cluster_config.py (resolve_agent_ca_server).

Never print a compiler hostname. Clustered consoles must set
OPENVOX_GUI_PUPPET_CA_HOST or list the global CA VIP in
cluster_config.json ca_vips.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Iterable, List, Optional


def _clean(host: Optional[str]) -> str:
    return (host or "").strip().strip("\"'").strip()


def looks_like_compiler_host(host: Optional[str]) -> bool:
    n = _clean(host).lower()
    return bool(n) and "compiler" in n


def pick_master_ca_vip(vips: Optional[Iterable[str]]) -> str:
    cleaned: List[str] = []
    seen = set()
    for v in vips or []:
        n = _clean(str(v)).lower()
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
    ca_vips: Optional[Iterable[str]] = None,
) -> str:
    exp = _clean(explicit)
    if exp and not looks_like_compiler_host(exp):
        return exp
    vip = pick_master_ca_vip(ca_vips)
    if vip:
        return vip
    compile_n = _clean(compile_host)
    if compile_n and not looks_like_compiler_host(compile_n):
        return compile_n
    return ""


def _ca_vips_from_cluster(path: str) -> List[str]:
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []
    raw = (data or {}).get("ca_vips") or []
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.replace(",", "\n").splitlines() if p.strip()]
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw]


def _ca_from_env_file(path: str) -> str:
    if not path:
        return ""
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except OSError:
        return ""
    for line in lines:
        s = line.strip()
        if s.startswith("OPENVOX_GUI_PUPPET_CA_HOST="):
            return _clean(s.split("=", 1)[1])
    return ""


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--explicit", default="", help="PUPPET_CA_HOST / prompt value")
    parser.add_argument("--compile", default="", help="OPENVOX_GUI_PUPPET_SERVER_HOST")
    parser.add_argument("--cluster-config", default="", help="cluster_config.json")
    parser.add_argument("--env-file", default="", help="config/.env")
    args = parser.parse_args(argv)
    explicit = _clean(args.explicit) or _ca_from_env_file(args.env_file)
    picked = resolve_agent_ca_server(
        explicit=explicit,
        compile_host=args.compile,
        ca_vips=_ca_vips_from_cluster(args.cluster_config),
    )
    if picked:
        sys.stdout.write(picked)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
