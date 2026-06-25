"""
Sudo command runner with pseudo-TTY support.

Many RHEL/enterprise systems set 'Defaults requiretty' in sudoers,
which rejects sudo calls from processes without a controlling terminal
(like systemd services). This module provides a helper that allocates
a PTY on stdin to satisfy that requirement.
"""
import asyncio
import logging
import os
import pty
from typing import Dict, List

logger = logging.getLogger(__name__)


async def run_sudo(cmd: List[str], timeout: int = 30, env: dict = None) -> Dict[str, object]:
    """Run a command (typically prefixed with 'sudo') with a pseudo-TTY.

    Allocates a PTY and runs the subprocess in a new session so the PTY
    becomes the controlling terminal. This satisfies sudo's 'requiretty'
    check on RHEL/enterprise systems.

    Returns a dict with 'returncode', 'stdout', and 'stderr' keys,
    matching the interface used by subprocess helpers throughout the
    application.
    """
    if env is None:
        env = os.environ.copy()
    master_fd, slave_fd = pty.openpty()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=slave_fd,
            start_new_session=True,
            env=env,
        )
        os.close(slave_fd)
        slave_fd = -1
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
        return {
            "returncode": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
    except asyncio.TimeoutError:
        logger.error("Command timed out after %ss: %s", timeout, cmd[:6])
        return {"returncode": -1, "stdout": "", "stderr": "Command timed out"}
    except (OSError, ValueError) as e:
        logger.error("Error running %s: %s", cmd[0:3], e, exc_info=True)
        return {"returncode": -1, "stdout": "", "stderr": str(e)}
    except Exception as e:
        # Last-resort: privileged runner must never raise into FastAPI uncaught,
        # but always log full traceback (srdev1 S1).
        logger.error("Unexpected error running %s: %s", cmd[0:3], e, exc_info=True)
        return {"returncode": -1, "stdout": "", "stderr": "Internal error running privileged command"}
    finally:
        if slave_fd >= 0:
            os.close(slave_fd)
        try:
            os.close(master_fd)
        except OSError:
            pass
