"""Sync now must wrap sudo so CIS requiretty sees a TTY."""
from __future__ import annotations

from app.utils.sudo import tty_wrap_argv


def test_tty_wrap_uses_script_when_present(monkeypatch, tmp_path):
    script = tmp_path / "script"
    script.write_text("#!/bin/sh\n")
    monkeypatch.setattr("app.utils.sudo._SCRIPT_BIN", str(script))
    out = tty_wrap_argv(
        ["sudo", "-n", "/opt/openvox-gui/scripts/sync-openvox-repo.sh"],
    )
    assert out[0] == str(script)
    assert out[1:4] == ["-q", "-e", "-c"]
    assert out[4] == "sudo -n /opt/openvox-gui/scripts/sync-openvox-repo.sh"
    assert out[5] == "/dev/null"
    assert "--quiet" not in out[4]


def test_tty_wrap_passthrough_without_script(monkeypatch):
    monkeypatch.setattr("app.utils.sudo._SCRIPT_BIN", "/no/such/script")
    cmd = ["sudo", "-n", "/opt/openvox-gui/scripts/sync-openvox-repo.sh"]
    assert tty_wrap_argv(cmd) == cmd
