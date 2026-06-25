"""Domain exceptions (srdev2 A2)."""
from pathlib import Path
import importlib.util

_PATH = Path(__file__).resolve().parents[1] / "app" / "utils" / "exceptions.py"
spec = importlib.util.spec_from_file_location("ovox_exc", _PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_validation_maps_400():
    exc = mod.ValidationAppError("bad input")
    assert exc.http_status == 400
    assert exc.code == "validation_error"
    assert "bad input" in str(exc.to_detail()) or exc.to_detail() == "bad input"


def test_command_execution_carries_rc():
    exc = mod.CommandExecutionError("failed", returncode=2)
    assert exc.returncode == 2
    assert exc.http_status == 500


def test_openvox_error_base():
    exc = mod.OpenVoxError("x")
    assert exc.http_status == 500
