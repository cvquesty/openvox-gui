"""
SSH bootstrap for machines without a first-boot payload (ISO installs).

Port of ovbuilder ``ssh.py`` onto the system OpenSSH client (the console
already has it for Bolt; paramiko is not used because every published
release carries an open advisory). The operator finishes the OS install in
the console and gives the GUI one-time credentials; the job then:

1. uploads each script with ``cat > file`` under ``umask 077``,
2. runs it with ``sudo -S`` (password on stdin) or as root,
3. the script deletes itself.

Secrets never reach argv or the environment: a password is read by an
``SSH_ASKPASS`` helper from a 0600 file, a private key is a 0600 file, and
both live in a private temp directory removed afterwards. The agent script
carries the per-build CSR challenge, so script bodies are never logged;
only the last lines of output are kept. The network script runs detached
because it may change the address the session is using.

Host keys are trust-on-first-use (``StrictHostKeyChecking=accept-new``
against a per-build known_hosts); the fingerprint is returned for the log.
"""
from __future__ import annotations

import os
import re
import secrets
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

_SAFE_USER = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")
_SAFE_HOST = re.compile(r"^[A-Za-z0-9.:-]{1,253}$")


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
        if not _SAFE_HOST.match(self.host or "") or self.host.startswith("-"):
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


def _write_private(path: str, content: str, mode: int = 0o600) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "w") as fh:
        fh.write(content)


def _ssh_command(target: SshTarget, workdir: str, ssh_bin: str = "ssh") -> Tuple[List[str], dict]:
    known = os.path.join(workdir, "known_hosts")
    argv = [
        ssh_bin, "-p", str(int(target.port)),
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", f"UserKnownHostsFile={known}",
        "-o", "GlobalKnownHostsFile=/dev/null",
        "-o", "ConnectTimeout=20",
        "-o", "ServerAliveInterval=30",
        "-o", "LogLevel=ERROR",
    ]
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SSH_", "DISPLAY"))}
    if target.private_key:
        key = os.path.join(workdir, "id_key")
        _write_private(key, target.private_key.strip() + "\n")
        argv += ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no"]
    else:
        secret = os.path.join(workdir, "pw")
        _write_private(secret, target.password)
        askpass = os.path.join(workdir, "askpass")
        _write_private(askpass, f"#!/bin/sh\ncat {shlex.quote(secret)}\n", 0o700)
        env.update(SSH_ASKPASS=askpass, SSH_ASKPASS_REQUIRE="force", DISPLAY="none")
        argv += ["-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1",
                 "-o", "PreferredAuthentications=password,keyboard-interactive"]
    argv.append(f"{target.username}@{target.host}")
    return argv, env


def _run(argv: List[str], env: dict, remote: str, stdin: str, timeout_s: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv + ["--", remote], input=stdin, env=env, capture_output=True,
                              text=True, timeout=timeout_s, check=False)
    except FileNotFoundError as exc:
        raise SshError("The OpenSSH client (ssh) is not installed on this console") from exc
    except subprocess.TimeoutExpired as exc:
        raise SshError(f"SSH command timed out after {timeout_s}s") from exc


def _fingerprint(workdir: str) -> str:
    known = os.path.join(workdir, "known_hosts")
    if not os.path.exists(known):
        return ""
    try:
        out = subprocess.run(["ssh-keygen", "-lf", known], capture_output=True, text=True, timeout=10, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    line = (out.stdout or "").strip().splitlines()
    return line[0] if line else ""


def run_scripts(target: SshTarget, scripts: List[RemoteScript], *, timeout_s: int = 1800,
                ssh_bin: str = "ssh") -> SshReport:
    """Blocking; run in a thread. Raises ``SshError`` on connect failure or a non-zero exit."""
    target.validate()
    report = SshReport()
    workdir = tempfile.mkdtemp(prefix="openvox-gui-ssh-")
    try:
        os.chmod(workdir, 0o700)
        argv, env = _ssh_command(target, workdir, ssh_bin)
        root = target.username == "root"
        for script in scripts:
            path = f"/tmp/openvox-gui-{secrets.token_hex(6)}.sh"
            body = script.body.rstrip("\n") + f"\nrm -f {shlex.quote(path)}\n"
            up = _run(argv, env, f"umask 077 && cat > {shlex.quote(path)}", body, 60)
            if up.returncode != 0:
                detail = (up.stderr or "").strip().splitlines()[-1:] or ["no output"]
                raise SshError(f"SSH to {target.host} failed: {detail[0][:200]}")
            if not report.host_key:
                report.host_key = _fingerprint(workdir)
            run = f"bash {shlex.quote(path)}"
            if script.detached:
                run = f"nohup bash {shlex.quote(path)} >/var/log/openvox-gui-net.log 2>&1 </dev/null &"
            stdin = ""
            if not root:
                if target.password:
                    run = f"sudo -S -p '' bash -c {shlex.quote(run)}"
                    stdin = target.password + "\n"
                else:
                    run = f"sudo -n bash -c {shlex.quote(run)}"
            done = _run(argv, env, run, stdin, timeout_s)
            output = ((done.stdout or "") + (done.stderr or "")).splitlines()
            report.lines.append(f"{script.label}: exit {done.returncode}")
            report.lines.extend(f"  {line}" for line in output[-10:])
            if done.returncode != 0:
                raise SshError(f"{script.label} exited {done.returncode} on {target.host}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return report


def bootstrap_scripts(hostname_fqdn: str, agent_script: Optional[str], network_script: str) -> List[RemoteScript]:
    """Hostname, then the agent install, then the (detached) static network."""
    scripts = [RemoteScript("hostname", f"#!/bin/bash\nset -e\nhostnamectl set-hostname {shlex.quote(hostname_fqdn)}\n")]
    if agent_script:
        scripts.append(RemoteScript("openvox-agent", agent_script))
    scripts.append(RemoteScript("network", "#!/bin/bash\nsleep 2\n" + network_script, detached=True))
    return scripts
