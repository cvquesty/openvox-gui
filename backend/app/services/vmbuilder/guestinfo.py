"""
cloud-init ``guestinfo.*`` payload for a template clone (ovbuilder approach).

VMware Tools + cloud-init read ``guestinfo.metadata`` / ``guestinfo.userdata``
from the VM's extraConfig on first boot. That gives the guest its
hostname, static IPv4 and first-boot commands without SSH from the GUI
and without a vCenter guest customization spec.

cloud-init's own network renderer is disabled. A first-boot script
(``/usr/local/sbin/openvox-gui-net.sh``) edits the template's existing NIC
profile in place, which is what ovbuilder learned works across Ubuntu
netplan and EL NetworkManager goldens:

* netplan present → write ``99-openvox-gui.yaml`` for the real iface, apply.
* nmcli present   → modify the existing ethernet profile, drop spares.
* otherwise       → raw ``ip addr`` / ``ip route`` (non-persistent).

The OpenVox agent step runs this console's ``install.bash`` with the same
``--server`` / ``--ca-server`` / ``--pkg-repo-url`` flags the Agent Install
page shows, and pins ``certname`` to the requested FQDN.

guestinfo is readable by any vCenter user who can read the VM's advanced
settings. Never put passwords in it; an HTTP proxy URL with credentials
is the one operator-supplied exception and is documented as such.
"""
from __future__ import annotations

import base64
import json
import re
import shlex
from dataclasses import dataclass
from typing import List, Optional, Sequence
from urllib.parse import urlparse

from .netspec import NetSpecError, is_valid_domain

_SSH_PUBKEY_PREFIXES = (
    "ssh-ed25519 ",
    "ssh-ed25519-cert-v01@",
    "ssh-rsa ",
    "ssh-rsa-cert-v01@",
    "ecdsa-sha2-nistp256 ",
    "ecdsa-sha2-nistp384 ",
    "ecdsa-sha2-nistp521 ",
    "ecdsa-sha2-nistp256-cert-v01@",
    "ecdsa-sha2-nistp384-cert-v01@",
    "ecdsa-sha2-nistp521-cert-v01@",
    "sk-ssh-ed25519@",
    "sk-ecdsa-sha2-nistp256@",
)
_SAFE_DNF_GROUP = re.compile(r"^[A-Za-z0-9 ._+/-]+$")
_SAFE_URL = re.compile(r"^https?://[A-Za-z0-9._:/@%+-]+$")


@dataclass(frozen=True)
class GuestIdentity:
    hostname: str
    domain: str
    ip: str
    prefix: int
    gateway: str = ""
    dns_servers: Sequence[str] = ()
    search_domains: Sequence[str] = ()

    @property
    def fqdn(self) -> str:
        return f"{self.hostname}.{self.domain}" if self.domain else self.hostname


@dataclass(frozen=True)
class BootstrapTarget:
    """Where the new agent points. Mirrors the Agent Install page one-liner."""

    server: str
    ca_server: str
    pkg_repo_url: str
    agent_version: str = ""
    noproxy_hosts: Sequence[str] = ()

    def validate(self) -> None:
        for label, host in (("server", self.server), ("CA server", self.ca_server)):
            if host and not is_valid_domain(host) and host != "localhost":
                raise NetSpecError(f"Invalid OpenVox {label} {host!r}")
        if not self.server:
            raise NetSpecError("OpenVox server is not configured for agent bootstrap")
        if not _SAFE_URL.match(self.pkg_repo_url or ""):
            raise NetSpecError(f"Invalid package repo URL {self.pkg_repo_url!r}")
        if self.agent_version and not re.fullmatch(r"\d{1,2}", self.agent_version):
            raise NetSpecError(f"Invalid agent version {self.agent_version!r}")


@dataclass(frozen=True)
class GuestOptions:
    ssh_authorized_keys: Sequence[str] = ()
    http_proxy: str = ""
    no_proxy: Sequence[str] = ()
    dnf_groups: Sequence[str] = ()
    bootstrap: Optional[BootstrapTarget] = None


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def normalize_ssh_authorized_keys(keys: Optional[Sequence[str] | str]) -> List[str]:
    """Unique SSH public keys. Private-key blocks and comments are dropped."""
    if not keys:
        return []
    raw_lines: List[str] = []
    for item in [keys] if isinstance(keys, str) else keys:
        raw_lines.extend(str(item or "").replace("\r\n", "\n").split("\n"))
    out: List[str] = []
    in_private = False
    for raw in raw_lines:
        line = raw.strip()
        if not line:
            continue
        if "PRIVATE KEY" in line.upper() or line.startswith("-----BEGIN"):
            in_private = True
            continue
        if in_private:
            if line.startswith("-----END"):
                in_private = False
            continue
        if line.startswith(_SSH_PUBKEY_PREFIXES) and line not in out:
            out.append(line)
    return out


def sanitize_dnf_groups(groups: Optional[Sequence[str]]) -> List[str]:
    out: List[str] = []
    for raw in groups or []:
        name = (raw or "").strip()
        if name and _SAFE_DNF_GROUP.match(name) and name not in out:
            out.append(name)
    return out


def validate_proxy_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"http://{text}"
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise NetSpecError("HTTP proxy must look like http://host:port")
    if any(ch in text for ch in "'\"\\`$\n\r "):
        raise NetSpecError("HTTP proxy URL contains characters that are not allowed")
    return text


def redact_proxy_url(url: str) -> str:
    """Proxy URL with any password replaced (for previews and logs)."""
    if not url:
        return ""
    parsed = urlparse(url if "://" in url else f"http://{url}")
    if parsed.password is None:
        return url
    netloc = f"{parsed.username}:***@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return parsed._replace(netloc=netloc).geturl()


def build_metadata(identity: GuestIdentity) -> str:
    return (
        f"instance-id: {identity.fqdn}\n"
        f"local-hostname: {identity.hostname}\n"
        f"hostname: {identity.hostname}\n"
    )


def _nm_value(value: str) -> str:
    return shlex.quote(value) if value else "''"


def build_network_script(identity: GuestIdentity) -> str:
    """Bash body (no shebang) that applies the static IPv4 on the primary NIC."""
    ip_cidr = f"{identity.ip}/{identity.prefix}"
    gw = identity.gateway
    dns = list(identity.dns_servers)
    search = list(identity.search_domains) or ([identity.domain] if identity.domain else [])

    routes_block = ""
    if gw:
        routes_block = (
            "      routes:\n"
            "        - to: 0.0.0.0/0\n"
            f"          via: {gw}\n"
        )
    nameservers_block = ""
    if dns or search:
        nameservers_block = "      nameservers:\n"
        if dns:
            nameservers_block += f"        addresses: [{', '.join(dns)}]\n"
        if search:
            nameservers_block += f"        search: [{', '.join(search)}]\n"

    nm_args = [
        f"ipv4.gateway {_nm_value(gw)}",
        f"ipv4.dns {_nm_value(' '.join(dns))}",
        f"ipv4.dns-search {_nm_value(' '.join(search))}",
    ]
    ip_q = shlex.quote(ip_cidr)
    gw_route = f"ip route replace default via {shlex.quote(gw)} || true" if gw else "true"

    # NOTE: the netplan heredoc delimiter is unquoted on purpose: the guest
    # shell must expand $IFACE. Every other value is validated IPv4/DNS text.
    return f"""set +e
IFACE=$(ls -1 /sys/class/net 2>/dev/null | grep -E '^e' | head -1)
if [ -z "$IFACE" ]; then
  echo "openvox-gui-net: no ethernet interface found" >&2
  exit 1
fi
echo "openvox-gui-net: primary iface=$IFACE ip={ip_cidr}"

if [ -d /etc/netplan ] && command -v netplan >/dev/null 2>&1; then
  echo "openvox-gui-net: path=netplan"
  for f in /etc/netplan/*.yaml /etc/netplan/*.yml; do
    [ -f "$f" ] || continue
    case "$f" in */99-openvox-gui.yaml) continue ;; esac
    rm -f "$f"
  done
  cat > /etc/netplan/99-openvox-gui.yaml <<EOF
network:
  version: 2
  ethernets:
    $IFACE:
      dhcp4: false
      dhcp6: false
      addresses:
        - {ip_cidr}
{routes_block}{nameservers_block}EOF
  chmod 600 /etc/netplan/99-openvox-gui.yaml
  netplan generate 2>/dev/null || true
  netplan apply
  ip -br addr show "$IFACE" || true
  exit 0
fi

if command -v nmcli >/dev/null 2>&1; then
  echo "openvox-gui-net: path=nmcli"
  CONN=$(nmcli -t -f NAME,DEVICE connection show 2>/dev/null | awk -F: -v i="$IFACE" '$2 == i {{ print $1; exit }}')
  if [ -z "$CONN" ]; then
    CONN=$(nmcli -t -f NAME,TYPE connection show 2>/dev/null | awk -F: '$2 == "802-3-ethernet" {{ print $1; exit }}')
  fi
  if [ -z "$CONN" ]; then
    nmcli connection add type ethernet ifname "$IFACE" con-name "$IFACE" ipv4.method manual ipv6.method ignore
    CONN="$IFACE"
  fi
  nmcli connection modify "$CONN" connection.id "$IFACE" connection.interface-name "$IFACE" \\
    connection.autoconnect yes ipv4.method manual ipv4.addresses {ip_q} ipv6.method ignore \\
    {' '.join(nm_args)}
  CONN="$IFACE"
  nmcli -t -f NAME,TYPE connection show 2>/dev/null | while IFS=: read -r name typ; do
    [ "$typ" = "802-3-ethernet" ] || continue
    [ "$name" = "$CONN" ] && continue
    nmcli connection delete "$name" 2>/dev/null || true
  done
  nmcli connection up "$CONN" || nmcli device reapply "$IFACE" || true
  ip -br addr show "$IFACE" || true
  exit 0
fi

echo "openvox-gui-net: path=iproute2"
ip link set "$IFACE" up || true
ip addr flush dev "$IFACE" 2>/dev/null || true
ip addr add {ip_q} dev "$IFACE" || true
{gw_route}
"""


def build_proxy_script(proxy_url: str, no_proxy: Sequence[str]) -> str:
    url = validate_proxy_url(proxy_url)
    parsed = urlparse(url)
    url_q = shlex.quote(url)
    np_q = shlex.quote(",".join(no_proxy))
    host_port = shlex.quote(f"{parsed.scheme}://{parsed.hostname}:{parsed.port or 3128}")
    dnf_user = f"echo proxy_username={shlex.quote(parsed.username)}" if parsed.username else "true"
    dnf_pw = f"echo proxy_password={shlex.quote(parsed.password)}" if parsed.password else "true"
    return f"""#!/bin/bash
set -euo pipefail
umask 077
mkdir -p /etc/profile.d /etc/apt/apt.conf.d /etc/dnf
printf '%s\\n' 'export http_proxy={url_q}' 'export https_proxy={url_q}' \\
  'export HTTP_PROXY={url_q}' 'export HTTPS_PROXY={url_q}' \\
  'export no_proxy={np_q}' 'export NO_PROXY={np_q}' > /etc/profile.d/openvox-gui-proxy.sh
chmod 0644 /etc/profile.d/openvox-gui-proxy.sh
if [ -d /etc/apt/apt.conf.d ]; then
  printf '%s\\n' 'Acquire::http::Proxy {json.dumps(url)};' 'Acquire::https::Proxy {json.dumps(url)};' \\
    > /etc/apt/apt.conf.d/01openvox-gui-proxy
fi
if command -v dnf >/dev/null 2>&1 || [ -f /etc/dnf/dnf.conf ]; then
  mkdir -p /etc/dnf/dnf.conf.d
  {{
    echo '[main]'
    echo proxy={host_port}
    {dnf_user}
    {dnf_pw}
  }} > /etc/dnf/dnf.conf.d/openvox-gui-proxy.conf
fi
"""


def build_dnf_script(groups: Sequence[str]) -> str:
    clean = sanitize_dnf_groups(groups)
    quoted = " ".join(shlex.quote(g) for g in clean)
    return f"""#!/bin/bash
set +e
if ! command -v dnf >/dev/null 2>&1; then
  echo "openvox-gui-dnf: no dnf on PATH; skipping"
  exit 0
fi
for group in {quoted}; do
  dnf -y group install "$group" || echo "openvox-gui-dnf: group '$group' failed (continuing)"
done
exit 0
"""


def agent_install_command(target: BootstrapTarget, certname: str) -> str:
    """``curl … install.bash | bash -s -- …`` exactly as the Agent Install page builds it."""
    target.validate()
    if not is_valid_domain(certname):
        raise NetSpecError(f"Invalid certname {certname!r}")
    repo = target.pkg_repo_url.rstrip("/")
    noproxy = ",".join(h for h in target.noproxy_hosts if h) or target.server
    args = ["--server", target.server]
    if target.ca_server:
        args += ["--ca-server", target.ca_server]
    args += ["--pkg-repo-url", repo]
    if target.agent_version:
        args += ["--version", target.agent_version]
    args.append(f"main:certname={certname}")
    return (
        f"curl -fsSk --noproxy {shlex.quote(noproxy)} {shlex.quote(repo + '/install.bash')} "
        f"| bash -s -- {' '.join(shlex.quote(a) for a in args)}"
    )


def build_agent_script(target: BootstrapTarget, certname: str) -> str:
    cmd = agent_install_command(target, certname)
    return f"""#!/bin/bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
[ -f /etc/profile.d/openvox-gui-proxy.sh ] && . /etc/profile.d/openvox-gui-proxy.sh
for attempt in 1 2 3 4 5; do
  if {cmd}; then
    echo "openvox-gui-agent: install.bash finished (attempt $attempt)"
    exit 0
  fi
  echo "openvox-gui-agent: attempt $attempt failed; retrying in 30s" >&2
  sleep 30
done
exit 1
"""


def _indent_block(text: str, spaces: int = 6) -> str:
    pad = " " * spaces
    return "\n".join(f"{pad}{line}" if line else pad for line in text.splitlines())


def _write_file(path: str, content: str) -> List[str]:
    return [
        f"  - path: {path}",
        "    permissions: '0755'",
        "    owner: root:root",
        "    content: |",
        _indent_block(content),
    ]


def build_userdata(identity: GuestIdentity, options: GuestOptions) -> str:
    """cloud-init user-data. SSH password auth stays off; root stays locked."""
    keys = normalize_ssh_authorized_keys(list(options.ssh_authorized_keys))
    groups = sanitize_dnf_groups(options.dnf_groups)
    proxy = validate_proxy_url(options.http_proxy)

    lines = [
        "#cloud-config",
        f"hostname: {identity.hostname}",
        f"fqdn: {identity.fqdn}",
        "prefer_fqdn_over_hostname: true",
        "manage_etc_hosts: true",
        "package_update: false",
        "package_upgrade: false",
        "ssh_pwauth: false",
        "disable_root: true",
    ]
    if keys:
        lines.append("ssh_authorized_keys:")
        lines.extend(f"  - {json.dumps(k)}" for k in keys)
    lines += [
        "network:",
        "  config: disabled",
        "write_files:",
    ]
    lines += _write_file(
        "/usr/local/sbin/openvox-gui-net.sh",
        "#!/bin/bash\n" + build_network_script(identity),
    )
    if proxy:
        no_proxy = ["localhost", "127.0.0.1", "::1", identity.fqdn, identity.ip, *options.no_proxy]
        if options.bootstrap:
            no_proxy += [h for h in options.bootstrap.noproxy_hosts if h]
        deduped: List[str] = []
        for host in no_proxy:
            if host and host not in deduped:
                deduped.append(host)
        lines += _write_file("/usr/local/sbin/openvox-gui-proxy.sh", build_proxy_script(proxy, deduped))
    if groups:
        lines += _write_file("/usr/local/sbin/openvox-gui-dnf-groups.sh", build_dnf_script(groups))
    if options.bootstrap:
        lines += _write_file(
            "/usr/local/sbin/openvox-gui-agent.sh",
            build_agent_script(options.bootstrap, identity.fqdn),
        )
    lines += [
        "runcmd:",
        f"  - [hostnamectl, set-hostname, {identity.fqdn}]",
        "  - [/usr/local/sbin/openvox-gui-net.sh]",
    ]
    if proxy:
        lines.append("  - [/usr/local/sbin/openvox-gui-proxy.sh]")
    if groups:
        lines.append("  - [/usr/local/sbin/openvox-gui-dnf-groups.sh]")
    if options.bootstrap:
        lines.append(
            "  - [bash, -c, '/usr/local/sbin/openvox-gui-agent.sh "
            ">> /var/log/openvox-gui-agent-bootstrap.log 2>&1']"
        )
    lines += [f'final_message: "openvox-gui cloud-init finished for {identity.fqdn}"', ""]
    return "\n".join(lines)


def guestinfo_extra_config(identity: GuestIdentity, options: GuestOptions) -> dict:
    """extraConfig keys for the clone ConfigSpec."""
    return {
        "guestinfo.metadata": _b64(build_metadata(identity)),
        "guestinfo.metadata.encoding": "base64",
        "guestinfo.userdata": _b64(build_userdata(identity, options)),
        "guestinfo.userdata.encoding": "base64",
    }
