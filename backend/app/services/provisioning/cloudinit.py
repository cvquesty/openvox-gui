"""
cloud-init first-boot payload shared by every provisioning provider.

The payload gives a new machine its hostname, static network identity and
first-boot commands without SSH from the GUI. How it reaches the guest is
provider-specific: VMware puts it in ``guestinfo.*`` extraConfig (the
ovbuilder approach); a bare-metal provider (issue #173) could serve the
same metadata/user-data through NoCloud.

cloud-init's own network renderer is disabled. A first-boot script
(``/usr/local/sbin/openvox-gui-net.sh``) edits the image's existing NIC
profiles in place, which is what ovbuilder learned works across Ubuntu
netplan and EL NetworkManager goldens:

* netplan present → write ``99-openvox-gui.yaml`` for the real ifaces, apply.
* nmcli present   → modify the existing ethernet profiles, drop spares.
* otherwise       → raw ``ip addr`` / ``ip route`` (non-persistent).

NICs are matched to the request in PCI order (VMware adds them in device
order). NIC 1 carries the gateway and DNS. Extra NICs take a static
address without a gateway, or DHCP when no address is given.

The OpenVox agent step runs this console's ``install.bash`` with the same
``--server`` / ``--ca-server`` / ``--pkg-repo-url`` flags the Agent Install
page shows, pins ``certname`` to the FQDN, and, when the build asked the
GUI to sign, adds the per-build ``challengePassword`` (see ``csr.py``).

The payload can be read by whoever can read the provider's VM config
(vCenter: advanced settings). It never carries passwords; the per-build
CSR token and an HTTP proxy URL with credentials are the exceptions, and
VMware blanks ``guestinfo.userdata`` once the CSR has been handled.
"""
from __future__ import annotations

import json
import re
import shlex
from dataclasses import dataclass, field
from typing import List, Optional, Sequence
from urllib.parse import urlparse

from .csr import challenge_argument
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
_SAFE_CHALLENGE = re.compile(r"^[A-Za-z0-9-]{16,128}$")


@dataclass(frozen=True)
class NicAddress:
    """Addressing for one NIC. Empty ``ip`` means DHCP (extra NICs only)."""

    ip: str = ""
    prefix: int = 0


@dataclass(frozen=True)
class GuestIdentity:
    hostname: str
    domain: str
    ip: str
    prefix: int
    gateway: str = ""
    dns_servers: Sequence[str] = ()
    search_domains: Sequence[str] = ()
    extra_nics: Sequence[NicAddress] = ()

    @property
    def fqdn(self) -> str:
        return f"{self.hostname}.{self.domain}" if self.domain else self.hostname

    @property
    def nics(self) -> List[NicAddress]:
        return [NicAddress(self.ip, self.prefix), *self.extra_nics]


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
    csr_challenge: str = field(default="", repr=False)


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


def _q(value: str) -> str:
    return shlex.quote(value) if value else "''"


def build_network_script(identity: GuestIdentity) -> str:
    """Bash body (no shebang) that applies addressing to every requested NIC."""
    nics = identity.nics
    dns = list(identity.dns_servers)
    search = list(identity.search_domains) or ([identity.domain] if identity.domain else [])
    gw = identity.gateway

    netplan_blocks: List[str] = []
    nm_calls: List[str] = []
    ip_calls: List[str] = []
    for idx, nic in enumerate(nics):
        var = f"$IF{idx}"
        guard = f'[ -n "{var}" ] && '
        if nic.ip:
            cidr = f"{nic.ip}/{nic.prefix}"
            body = (
                f"    {var}:\n"
                "      dhcp4: false\n"
                "      dhcp6: false\n"
                "      addresses:\n"
                f"        - {cidr}\n"
            )
            if idx == 0 and gw:
                body += "      routes:\n        - to: 0.0.0.0/0\n" f"          via: {gw}\n"
            if idx == 0 and (dns or search):
                body += "      nameservers:\n"
                if dns:
                    body += f"        addresses: [{', '.join(dns)}]\n"
                if search:
                    body += f"        search: [{', '.join(search)}]\n"
            nm_calls.append(
                f'{guard}nm_conf "{var}" manual {_q(cidr)} '
                f"{_q(gw if idx == 0 else '')} {_q(' '.join(dns) if idx == 0 else '')} "
                f"{_q(' '.join(search) if idx == 0 else '')}"
            )
            ip_calls.append(f'{guard}{{ ip link set "{var}" up; ip addr flush dev "{var}"; '
                            f'ip addr add {_q(cidr)} dev "{var}"; }}')
        else:
            body = f"    {var}:\n      dhcp4: true\n      dhcp6: false\n"
            nm_calls.append(f"{guard}nm_conf \"{var}\" auto '' '' '' ''")
        # NOTE: unquoted heredoc on purpose: the guest shell must expand $IFn.
        # Everything else in the block is validated IPv4 / DNS text.
        netplan_blocks.append(f'if [ -n "{var}" ]; then\ncat >> "$NP" <<EOF\n{body}EOF\nfi')
    if gw:
        ip_calls.append(f"ip route replace default via {_q(gw)} || true")

    assign = "\n".join(f'IF{i}="${{IFACES[{i}]:-}}"' for i in range(len(nics)))
    configured = " ".join(f'"$IF{i}"' for i in range(len(nics)))
    return f"""set +e
# Ethernet ifaces in PCI order (VMware adds NICs in device order).
mapfile -t IFACES < <(for i in $(ls -1 /sys/class/net 2>/dev/null | grep -E '^e'); do
  printf '%s %s\\n' "$(readlink -f /sys/class/net/$i/device 2>/dev/null)" "$i"
done | sort | awk '{{print $2}}')
if [ "${{#IFACES[@]}}" -eq 0 ]; then
  echo "openvox-gui-net: no ethernet interface found" >&2
  exit 1
fi
{assign}
if [ "${{#IFACES[@]}}" -lt {len(nics)} ]; then
  echo "openvox-gui-net: expected {len(nics)} NICs, found ${{#IFACES[@]}}" >&2
fi
echo "openvox-gui-net: ifaces=${{IFACES[*]}} primary=$IF0 ip={identity.ip}/{identity.prefix}"

if [ -d /etc/netplan ] && command -v netplan >/dev/null 2>&1; then
  echo "openvox-gui-net: path=netplan"
  for f in /etc/netplan/*.yaml /etc/netplan/*.yml; do
    [ -f "$f" ] || continue
    case "$f" in */99-openvox-gui.yaml) continue ;; esac
    rm -f "$f"
  done
  NP=/etc/netplan/99-openvox-gui.yaml
  printf 'network:\\n  version: 2\\n  ethernets:\\n' > "$NP"
{chr(10).join(netplan_blocks)}
  chmod 600 "$NP"
  netplan generate 2>/dev/null || true
  netplan apply
  ip -br addr || true
  exit 0
fi

if command -v nmcli >/dev/null 2>&1; then
  echo "openvox-gui-net: path=nmcli"
  nm_conf() {{
    local IFACE="$1" METHOD="$2" CIDR="$3" GW="$4" DNS="$5" SEARCH="$6" CONN
    CONN=$(nmcli -t -f NAME,DEVICE connection show 2>/dev/null | awk -F: -v i="$IFACE" '$2 == i {{ print $1; exit }}')
    if [ -z "$CONN" ]; then
      CONN=$(nmcli -t -f NAME,DEVICE,TYPE connection show 2>/dev/null | awk -F: -v done="$DONE" \\
        '$3 == "802-3-ethernet" && $2 == "" && index(" " done " ", " " $1 " ") == 0 {{ print $1; exit }}')
    fi
    if [ -z "$CONN" ]; then
      nmcli connection add type ethernet ifname "$IFACE" con-name "$IFACE" ipv4.method auto ipv6.method ignore
      CONN="$IFACE"
    fi
    if [ "$METHOD" = manual ]; then
      nmcli connection modify "$CONN" connection.id "$IFACE" connection.interface-name "$IFACE" \\
        connection.autoconnect yes ipv4.method manual ipv4.addresses "$CIDR" ipv4.gateway "$GW" \\
        ipv4.dns "$DNS" ipv4.dns-search "$SEARCH" ipv6.method ignore
    else
      nmcli connection modify "$CONN" connection.id "$IFACE" connection.interface-name "$IFACE" \\
        connection.autoconnect yes ipv4.method auto ipv6.method ignore
    fi
    DONE="$DONE $IFACE"
    nmcli connection up "$IFACE" || nmcli device reapply "$IFACE" || true
  }}
  DONE=""
{chr(10).join("  " + c for c in nm_calls)}
  KEEP=" {configured} "
  nmcli -t -f NAME,TYPE connection show 2>/dev/null | while IFS=: read -r name typ; do
    [ "$typ" = "802-3-ethernet" ] || continue
    case "$KEEP" in *" $name "*) continue ;; esac
    nmcli connection delete "$name" 2>/dev/null || true
  done
  ip -br addr || true
  exit 0
fi

echo "openvox-gui-net: path=iproute2"
{chr(10).join(ip_calls)}
ip -br addr || true
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


def agent_install_command(target: BootstrapTarget, certname: str, csr_challenge: str = "") -> str:
    """``curl … install.bash | bash -s -- …`` exactly as the Agent Install page builds it."""
    target.validate()
    if not is_valid_domain(certname):
        raise NetSpecError(f"Invalid certname {certname!r}")
    if csr_challenge and not _SAFE_CHALLENGE.match(csr_challenge):
        raise NetSpecError("Invalid CSR challenge")
    repo = target.pkg_repo_url.rstrip("/")
    noproxy = ",".join(h for h in target.noproxy_hosts if h) or target.server
    args = ["--server", target.server]
    if target.ca_server:
        args += ["--ca-server", target.ca_server]
    args += ["--pkg-repo-url", repo]
    if target.agent_version:
        args += ["--version", target.agent_version]
    args.append(f"main:certname={certname}")
    if csr_challenge:
        args.append(challenge_argument(csr_challenge))
    return (
        f"curl -fsSk --noproxy {shlex.quote(noproxy)} {shlex.quote(repo + '/install.bash')} "
        f"| bash -s -- {' '.join(shlex.quote(a) for a in args)}"
    )


def build_agent_script(target: BootstrapTarget, certname: str, csr_challenge: str = "") -> str:
    cmd = agent_install_command(target, certname, csr_challenge)
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


def _write_file(path: str, content: str, mode: str = "0755") -> List[str]:
    return [
        f"  - path: {path}",
        f"    permissions: '{mode}'",
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
    lines += ["network:", "  config: disabled", "write_files:"]
    lines += _write_file("/usr/local/sbin/openvox-gui-net.sh", "#!/bin/bash\n" + build_network_script(identity))
    if proxy:
        no_proxy = ["localhost", "127.0.0.1", "::1", identity.fqdn, identity.ip, *options.no_proxy]
        if options.bootstrap:
            no_proxy += [h for h in options.bootstrap.noproxy_hosts if h]
        deduped: List[str] = []
        for host in no_proxy:
            if host and host not in deduped:
                deduped.append(host)
        lines += _write_file("/usr/local/sbin/openvox-gui-proxy.sh", build_proxy_script(proxy, deduped), "0700")
    if groups:
        lines += _write_file("/usr/local/sbin/openvox-gui-dnf-groups.sh", build_dnf_script(groups))
    if options.bootstrap:
        lines += _write_file(
            "/usr/local/sbin/openvox-gui-agent.sh",
            build_agent_script(options.bootstrap, identity.fqdn, options.csr_challenge),
            "0700",
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
