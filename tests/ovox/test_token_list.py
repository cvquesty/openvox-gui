"""ovox token list talks to GET /api/auth/users/{username}/tokens."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ovox"))

from ovox.client import OvoxAPIError  # noqa: E402
from ovox.commands.token import _token_metadata  # noqa: E402
from ovox.main import cli  # noqa: E402

runner = CliRunner()

SAMPLE_TOKENS = {
    "tokens": [
        {
            "id": 7,
            "username": "bolt",
            "name": "Bolt service token",
            "role": "bolt",
            "created_at": "2026-11-01T12:00:00+00:00",
            "created_by": "admin",
            "expires_at": None,
            "last_used_at": "2026-11-20T08:15:00+00:00",
            "active": True,
            "notes": None,
            # Must never appear in output even if a payload includes it
            "token": "example-token",
        }
    ]
}


def test_token_metadata_strips_secret_fields():
    cleaned = _token_metadata(SAMPLE_TOKENS["tokens"][0])
    assert cleaned["name"] == "Bolt service token"
    assert cleaned["id"] == 7
    assert "token" not in cleaned
    assert "example-token" not in cleaned.values()


def test_list_tokens_table_prints_metadata_not_secret():
    client = MagicMock()
    client.get.return_value = SAMPLE_TOKENS
    with patch("ovox.commands.token.get_client", return_value=client):
        result = runner.invoke(cli, ["--token", "example-jwt", "token", "list", "bolt"])
    assert result.exit_code == 0, result.output
    client.get.assert_called_once_with("/api/auth/users/bolt/tokens")
    assert "API tokens for bolt" in result.output
    # Rich may clip long cell text on a narrow tty; the title and flags are enough here.
    assert "yes" in result.output
    assert "never" in result.output
    assert "example-token" not in result.output


def test_list_tokens_json_omits_secret():
    client = MagicMock()
    client.get.return_value = SAMPLE_TOKENS
    with patch("ovox.commands.token.get_client", return_value=client):
        result = runner.invoke(cli, ["--token", "example-jwt", "token", "list", "bolt", "--json"])
    assert result.exit_code == 0, result.output
    assert "Bolt service token" in result.output
    assert "example-token" not in result.output
    assert '"id"' in result.output or '"id":' in result.output


def test_list_tokens_empty():
    client = MagicMock()
    client.get.return_value = {"tokens": []}
    with patch("ovox.commands.token.get_client", return_value=client):
        result = runner.invoke(cli, ["--token", "example-jwt", "token", "list", "alice"])
    assert result.exit_code == 0, result.output
    assert "No tokens found for user 'alice'" in result.output


def test_list_tokens_api_error():
    client = MagicMock()
    client.get.side_effect = OvoxAPIError(403, "Admin access required")
    with patch("ovox.commands.token.get_client", return_value=client):
        result = runner.invoke(cli, ["--token", "example-jwt", "token", "list", "bolt"])
    assert result.exit_code == 1
    assert "Admin access required" in result.output
