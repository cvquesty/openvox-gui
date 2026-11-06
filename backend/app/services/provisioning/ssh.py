"""
SSH bootstrap for machines without a first-boot payload (ISO installs).

Port of ovbuilder ``ssh.py``. The operator finishes the OS install in the
console and gives the GUI one-time SSH credentials; the job then:

1. uploads each script over SFTP to a private temp file,
2. runs it with ``sudo -S`` (password on stdin, never on argv) or as root,
3. removes it.

The agent script carries the per-build CSR challenge, so scripts are
written with mode 0700 and their contents are never logged; only the last
lines of output are kept. The network script runs detached because it may
change the address the session is using.

Host keys are trust-on-first-use (a freshly installed guest has no known
key); the fingerprint is returned so the job log records it.
"""
from __future__ import annotations

import io
import re
import secrets
import shlex
from dataclasses import dataclass, field
from typing import List, Optional

_SAFE_USER = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")


class SshError(RuntimeError):
    """SSH bootstrap failed. Messages never include passwords or keys."""


@dataclass(frozen=True)
class SshTarget:
    host: str
    username: str
    port: int = 22
    password: str = field(default="", repr=False)
    private_key: str = field(default="", repr=False)

    def validate(self) -> None:
        if not self.host or any(c in self.host for c in " /;'\"`$"):
            raise SshError("Invalid SSH host")
        if not _SAFE_USER.match(self.username or ""):
            raise SshError("Invalid SSH username")
        if not 1 <= int(self.port) <= 65535:
            raise SshError("Invalid SSH port")
        if not self.password and not self.private_key:
            raise SshError("An SSH password or private key is required")


@dataclass(frozen=True)
class RemoteScript:
    label: str
    body: str
    detached: bool = False


@dataclass
class SshReport:
    host_key: str = ""
    lines: List[str] = field(default_factory=list)


def _load_key(text: str):
    import paramiko

    for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return cls.from_private_key(io.StringIO(text))
        except Exception:  # noqa: BLE001 — try the next key type
            continue
    raise SshError("The private key could not be read (ed25519, ECDSA or RSA, unencrypted PEM/OpenSSH)")


def run_scripts(target: SshTarget, scripts: List[RemoteScript], *, timeout_s: int = 1800) -> SshReport:
    """Blocking; run in a thread. Raises ``SshError`` on connect or non-zero exit."""
    target.validate()
    try:
        import paramiko
    except ImportError as exc:
        raise SshError("paramiko is not installed in the GUI virtualenv") from exc

    report = SshReport()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            target.host, port=int(target.port), username=target.username,
            password=target.password or None,
            pkey=_load_key(target.private_key) if target.private_key else None,
            timeout=20, allow_agent=False, look_for_keys=False,
        )
    except SshError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise SshError(f"SSH connection to {target.host} failed: {exc.__class__.__name__}") from exc
    try:
        key = client.get_transport().get_remote_server_key()
        report.host_key = f"{key.get_name()} {key.fingerprint if hasattr(key, 'fingerprint') else key.get_base64()[:32]}"
        sftp = client.open_sftp()
        root = target.username == "root"
        for script in scripts:
            path = f"/tmp/openvox-gui-{secrets.token_hex(6)}.sh"
            with sftp.file(path, "w") as fh:
                fh.write(script.body + f'\nrm -f {shlex.quote(path)}\n')
            sftp.chmod(path, 0o700)
            run = f"bash {shlex.quote(path)}"
            if script.detached:
                run = f"nohup bash {shlex.quote(path)} >/var/log/openvox-gui-net.log 2>&1 &"
            if not root:
                prefix = "sudo -S -p '' " if target.password else "sudo -n "
                run = f"{prefix}bash -c {shlex.quote(run)}"
            stdin, stdout, _stderr = client.exec_command(run, timeout=timeout_s, get_pty=False)
            if not root and target.password:
                stdin.write(target.password + "\n")
                stdin.flush()
            stdin.channel.shutdown_write()
            output = stdout.read().decode("utf-8", "replace").splitlines()
            code = stdout.channel.recv_exit_status()
            report.lines.append(f"{script.label}: exit {code}")
            report.lines.extend(f"  {line}" for line in output[-10:])
            if code != 0:
                raise SshError(f"{script.label} exited {code} on {target.host}")
        sftp.close()
    finally:
        client.close()
    return report


def bootstrap_scripts(hostname_fqdn: str, agent_script: Optional[str], network_script: str) -> List[RemoteScript]:
    """Hostname, then the agent install, then the (detached) static network."""
    scripts = [RemoteScript("hostname", f"#!/bin/bash\nset -e\nhostnamectl set-hostname {shlex.quote(hostname_fqdn)}\n")]
    if agent_script:
        scripts.append(RemoteScript("openvox-agent", agent_script))
    scripts.append(RemoteScript("network", "#!/bin/bash\nsleep 2\n" + network_script, detached=True))
    return scripts
