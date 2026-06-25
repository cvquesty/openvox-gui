"""Audit helper emits structured AUDIT lines."""
import logging

from pathlib import Path
import importlib.util

_PATH = Path(__file__).resolve().parents[1] / "app" / "utils" / "audit.py"
spec = importlib.util.spec_from_file_location("ovox_audit", _PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_audit_event_logs_info(caplog):
    with caplog.at_level(logging.INFO, logger="openvox_gui.audit"):
        mod.audit_event(
            "bolt_command",
            user="admin",
            targets="agent1.example.com",
            detail="whoami",
            rc=0,
            success=True,
        )
    assert any("AUDIT: type=bolt_command" in r.message for r in caplog.records)
    assert any("user=admin" in r.message for r in caplog.records)
    assert any("rc=0" in r.message for r in caplog.records)


def test_audit_truncates_long_detail(caplog):
    long = "x" * 300
    with caplog.at_level(logging.INFO, logger="openvox_gui.audit"):
        mod.audit_event("deploy_run", user="op", detail=long, success=True)
    msg = next(r.message for r in caplog.records if "AUDIT:" in r.message)
    assert "..." in msg
    assert len(msg) < 500
