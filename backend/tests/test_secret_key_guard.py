"""Unset OPENVOX_GUI_SECRET_KEY: refused everywhere except debug=True."""
from __future__ import annotations

import asyncio
import secrets

import pytest

from app import config as config_mod
from app.config import (
    _DEFAULT_SECRET_KEY,
    Settings,
    refuse_unset_secret_key,
    secret_key_is_unset,
)
from app.services import secrets as secrets_mod


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_sentinel_and_empty_are_unset():
    assert secret_key_is_unset(_DEFAULT_SECRET_KEY)
    assert secret_key_is_unset("")
    assert secret_key_is_unset("   ")
    assert secret_key_is_unset(None)
    assert not secret_key_is_unset(secrets.token_hex(32))


def test_built_in_default_is_the_sentinel(monkeypatch):
    monkeypatch.delenv("OPENVOX_GUI_SECRET_KEY", raising=False)
    assert _settings().secret_key == _DEFAULT_SECRET_KEY


@pytest.mark.parametrize("auth_backend", ["none", "local", "ldap"])
def test_unset_key_refused_in_every_auth_backend_without_debug(auth_backend):
    s = _settings(secret_key=_DEFAULT_SECRET_KEY, auth_backend=auth_backend, debug=False)
    assert refuse_unset_secret_key(s)
    s = _settings(secret_key="", auth_backend=auth_backend, debug=False)
    assert refuse_unset_secret_key(s)


@pytest.mark.parametrize("auth_backend", ["none", "local"])
def test_unset_key_allowed_with_explicit_debug(auth_backend):
    s = _settings(secret_key=_DEFAULT_SECRET_KEY, auth_backend=auth_backend, debug=True)
    assert not refuse_unset_secret_key(s)


def test_real_key_never_refused():
    key = secrets.token_hex(32)
    for debug in (False, True):
        assert not refuse_unset_secret_key(_settings(secret_key=key, debug=debug))


def test_encrypt_refuses_unset_key_without_debug(monkeypatch):
    monkeypatch.setattr(secrets_mod.settings, "secret_key", _DEFAULT_SECRET_KEY)
    monkeypatch.setattr(secrets_mod.settings, "debug", False)
    value = secrets.token_urlsafe(16)
    with pytest.raises(RuntimeError, match="OPENVOX_GUI_SECRET_KEY"):
        secrets_mod.encrypt_secret(value)


def test_encrypt_round_trips_with_debug_and_with_real_key(monkeypatch):
    value = secrets.token_urlsafe(16)
    monkeypatch.setattr(secrets_mod.settings, "secret_key", _DEFAULT_SECRET_KEY)
    monkeypatch.setattr(secrets_mod.settings, "debug", True)
    assert secrets_mod.decrypt_secret(secrets_mod.encrypt_secret(value)) == value

    monkeypatch.setattr(secrets_mod.settings, "secret_key", secrets.token_hex(32))
    monkeypatch.setattr(secrets_mod.settings, "debug", False)
    stored = secrets_mod.encrypt_secret(value)
    assert stored.startswith("enc:v1:")
    assert secrets_mod.decrypt_secret(stored) == value


def test_lifespan_exits_on_unset_key_with_auth_enabled(monkeypatch):
    from app import main as main_mod

    assert main_mod.settings is config_mod.settings
    monkeypatch.setattr(config_mod.settings, "secret_key", _DEFAULT_SECRET_KEY)
    monkeypatch.setattr(config_mod.settings, "auth_backend", "local")
    monkeypatch.setattr(config_mod.settings, "debug", False)

    async def _start():
        async with main_mod.lifespan(main_mod.app):
            pass

    with pytest.raises(SystemExit) as exc:
        asyncio.run(_start())
    assert exc.value.code == 1
