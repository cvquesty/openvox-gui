"""
Sudo command runner with pseudo-TTY support.

Many RHEL/enterprise systems set ``Defaults requiretty`` in sudoers,
which rejects sudo calls from processes without a controlling terminal
(like systemd services). This module provides a shared helper used by
CA, Bolt, Config, Logs, and Code Deployment so privileged work never
depends solely on ``Defaults:puppet !requiretty`` surviving in
/etc/sudoers.d/.

Strategy (defense in depth):
  1. Prefer util-linux ``script -q -e -c ... /dev/null`` when present —
     it allocates a real controlling TTY and is the most reliable fix
     under systemd.
  2. Fall back to a manual PTY + session + TIOCSCTTY path when ``script``
     is missing.

Callers always pass an argv list (typically starting with ``sudo``).
"""
from __future__ import annotations

import asyncio
import fcntl
import logging
import os
import pty
import shlex
import termios
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# util-linux script path on RHEL/Rocky/Alma/Ubuntu AIO hosts
_SCRIPT_BIN = "/usr/bin/script"


def tty_wrap_argv(cmd: List[str]) -> List[str]:
    """Wrap argv so a background sudo still sees a controlling TTY.

    ``run_sudo`` waits for the child. Repo sync runs for minutes, so
    Sync now uses Popen. CIS ``Defaults requiretty`` rejects bare
    ``sudo -n`` from systemd (CA/r10k still go through ``run_sudo``).
    util-linux ``script -q -e -c`` is the same wrap those paths use.
    """
    if not cmd:
        return list(cmd)
    if os.path.isfile(_SCRIPT_BIN):
        return [_SCRIPT_BIN, "-q", "-e", "-c", shlex.join(cmd), "/dev/null"]
    return list(cmd)


async def run_sudo(
    cmd: List[str],
    timeout: int = 30,
    env: Optional[dict] = None,
) -> Dict[str, object]:
    """Run a command (typically prefixed with ``sudo``) with a pseudo-TTY.

    Returns a dict with ``returncode``, ``stdout``, and ``stderr`` keys.
    Never raises into FastAPI — unexpected failures are logged and
    returned as a non-zero result.
    """
    if not cmd:
        return {"returncode": -1, "stdout": "", "stderr": "Empty command"}

    if env is None:
        env = os.environ.copy()

    if os.path.isfile(_SCRIPT_BIN):
        result = await _run_via_script(cmd, timeout=timeout, env=env)
        if result is not None:
            return result
        logger.warning(
            "script(1) runner failed to start; falling back to manual PTY for %s",
            cmd[:3],
        )

    return await _run_via_pty(cmd, timeout=timeout, env=env)


async def _run_via_script(
    cmd: List[str],
    timeout: int,
    env: dict,
) -> Optional[Dict[str, object]]:
    """Run argv under util-linux script for a controlling terminal.

    ``-q`` quiet, ``-e`` return the child exit status (critical for deploy
    success detection). ``-c`` runs the joined command string; argv is
    shell-escaped via ``shlex.join`` so this stays list-safe.
    """
    # -e / --return: propagate child exit code (util-linux). Without it,
    # script often exits 0 even when sudo/r10k failed.
    wrapped_cmd = [_SCRIPT_BIN, "-q", "-e", "-c", shlex.join(cmd), "/dev/null"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *wrapped_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
    except asyncio.TimeoutError:
        logger.error("Command timed out after %ss: %s", timeout, cmd[:6])
        return {"returncode": -1, "stdout": "", "stderr": "Command timed out"}
    except FileNotFoundError:
        # script vanished between exists check and exec
        return None
    except (OSError, ValueError) as e:
        logger.error("Error running via script %s: %s", cmd[0:3], e, exc_info=True)
        return {"returncode": -1, "stdout": "", "stderr": str(e)}
    except Exception as e:
        logger.error(
            "Unexpected error running via script %s: %s", cmd[0:3], e, exc_info=True
        )
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": "Internal error running privileged command",
        }


async def _run_via_pty(
    cmd: List[str],
    timeout: int,
    env: dict,
) -> Dict[str, object]:
    """Manual PTY fallback when script(1) is unavailable."""
    master_fd, slave_fd = pty.openpty()
    try:

        def preexec() -> None:
            # Become session leader so the PTY can be the controlling terminal.
            # start_new_session=True also calls setsid(); tolerate the second call.
            try:
                os.setsid()
            except OSError:
                pass
            try:
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 1)
            except OSError:
                pass

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=slave_fd,
            preexec_fn=preexec,
            start_new_session=True,
            env=env,
        )
        os.close(slave_fd)
        slave_fd = -1

        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
    except asyncio.TimeoutError:
        logger.error("Command timed out after %ss: %s", timeout, cmd[:6])
        return {"returncode": -1, "stdout": "", "stderr": "Command timed out"}
    except (OSError, ValueError) as e:
        logger.error("Error running via PTY %s: %s", cmd[0:3], e, exc_info=True)
        return {"returncode": -1, "stdout": "", "stderr": str(e)}
    except Exception as e:
        logger.error(
            "Unexpected error running via PTY %s: %s", cmd[0:3], e, exc_info=True
        )
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": "Internal error running privileged command",
        }
    finally:
        if slave_fd >= 0:
            try:
                os.close(slave_fd)
            except OSError:
                pass
        try:
            os.close(master_fd)
        except OSError:
            pass
