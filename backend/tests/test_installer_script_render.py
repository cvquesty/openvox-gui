"""#103: GUI script route must not inherit a compiler CA from the mirror copy."""
from pathlib import Path

from app.routers import installer as inst


def test_load_install_script_skips_baked_compiler_ca(tmp_path: Path, monkeypatch):
    pkg = tmp_path / "pkgs"
    pkg.mkdir()
    (pkg / "install.bash").write_text(
        'CA_SERVER="${CA_SERVER:-compiler01.example.com}"\n'
    )
    monkeypatch.setattr(inst, "PKG_REPO_DIR", pkg)
    text = inst._load_install_script("install.bash")
    assert "__OPENVOX_CA_SERVER__" in text
    assert "compiler01.example.com" not in text


def test_render_template_uses_ca_not_compiler(monkeypatch):
    monkeypatch.setattr(inst, "_puppet_server_fqdn", lambda: "compiler01.example.com")
    monkeypatch.setattr(inst, "_ca_server_fqdn", lambda: "ovca.example.com")
    monkeypatch.setattr(inst, "_latest_agent_version", lambda: "8")
    out = inst._render_template(
        'CA_SERVER="${CA_SERVER:-__OPENVOX_CA_SERVER__}"\n'
        'PUPPET_SERVER="${PUPPET_SERVER:-__OPENVOX_PUPPET_SERVER__}"\n'
    )
    assert "ovca.example.com" in out
    assert "__OPENVOX_CA_SERVER__" not in out
    assert 'CA_SERVER="${CA_SERVER:-compiler01.example.com}"' not in out


def test_api_script_re_renders_live_ca_over_baked_mirror(tmp_path: Path, monkeypatch):
    pkg = tmp_path / "pkgs"
    pkg.mkdir()
    (pkg / "install.bash").write_text(
        'CA_SERVER="${CA_SERVER:-compiler01.example.com}"\n'
        'PUPPET_SERVER="${PUPPET_SERVER:-compiler01.example.com}"\n'
        "DEFAULT_OPENVOX_VERSION=8\n"
    )
    monkeypatch.setattr(inst, "PKG_REPO_DIR", pkg)
    monkeypatch.setattr(inst, "_puppet_server_fqdn", lambda: "compiler01.example.com")
    monkeypatch.setattr(inst, "_ca_server_fqdn", lambda: "ovca.example.com")
    monkeypatch.setattr(inst, "_latest_agent_version", lambda: "8")
    body = inst._render_template(inst._load_install_script("install.bash"))
    assert 'CA_SERVER="${CA_SERVER:-ovca.example.com}"' in body
    assert 'CA_SERVER="${CA_SERVER:-compiler01.example.com}"' not in body


def test_ca_server_fqdn_uses_cluster_ca_vips(monkeypatch):
    monkeypatch.setattr(inst.settings, "puppet_ca_host", "")
    monkeypatch.delenv("OPENVOX_GUI_PUPPET_CA_HOST", raising=False)
    monkeypatch.delenv("PUPPET_CA_HOST", raising=False)
    monkeypatch.setattr(inst, "_puppet_server_fqdn", lambda: "ovcompilers.site-a.example.com")
    monkeypatch.setattr(
        "app.services.cluster_config.load_cluster_config",
        lambda: {
            "ca_vips": [
                "ovca.site-a.example.com",
                "ovca.example.com",
            ]
        },
    )
    assert inst._ca_server_fqdn() == "ovca.example.com"


def test_ca_server_fqdn_never_returns_compiler(monkeypatch):
    monkeypatch.setattr(inst.settings, "puppet_ca_host", "")
    monkeypatch.delenv("OPENVOX_GUI_PUPPET_CA_HOST", raising=False)
    monkeypatch.delenv("PUPPET_CA_HOST", raising=False)
    monkeypatch.setattr(inst, "_puppet_server_fqdn", lambda: "ovcompilers.site-a.example.com")
    monkeypatch.setattr(
        "app.services.cluster_config.load_cluster_config",
        lambda: {"ca_vips": []},
    )
    assert inst._ca_server_fqdn() == ""
