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


async def run_sudo(cmd: List[str], timeout: int = 30) -> Dict[str, object]:
    """Run a command (typically prefixed with 'sudo') with a pseudo-TTY.

    Returns a dict with 'returncode', 'stdout', and 'stderr' keys,
    matching the interface used by subprocess helpers throughout the
    application.
    """
    master_fd, slave_fd = pty.openpty()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=slave_fd,
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
        return {"returncode": -1, "stdout": "", "stderr": "Command timed out"}
    except Exception as e:
        logger.error(f"Error running {cmd[0:3]}: {e}")
        return {"returncode": -1, "stdout": "", "stderr": str(e)}
    finally:
        if slave_fd >= 0:
            os.close(slave_fd)
        try:
            os.close(master_fd)
        except OSError:
            pass
