"""Puppetfile pin compare, rewrite, and GitHub remote parsing."""
from app.routers.puppetfile import (
    _bolt_puppetfile,
    _repos_from_r10k_text,
    merge_repositories,
)
from app.services.github_contents import parse_repo
from app.services.puppetfile_check import (
    parse_puppetfile,
    pin_status,
    rewrite_puppetfile,
    version_key,
)


SAMPLE = """\
forge 'https://forge.puppet.com'

mod 'puppet-chrony', '5.0.0'  # keep the note
mod 'kea',
  :git => 'https://github.com/example/kea.git',
mod "puppet-nftables", "7.5.0"
"""


def test_parse_splits_forge_and_git():
    forge, git = parse_puppetfile(SAMPLE)
    assert forge == [("puppet-chrony", "5.0.0"), ("puppet-nftables", "7.5.0")]
    assert git == ["kea"]


def test_version_key_orders_forge_build_pins():
    assert version_key("5.0.0") < version_key("6.0.0")
    assert version_key("1.0.0") < version_key("1.0.0-1")
    assert version_key("6.0.0-0-2") < version_key("6.0.0-0-3")


def test_pin_status():
    assert pin_status("5.0.0", "6.0.0", None) == "update"
    assert pin_status("6.0.0", "6.0.0", None) == "current"
    assert pin_status("6.1.0", "6.0.0", None) == "current"
    assert pin_status("1.0.0", None, "not on the Forge") == "not on the Forge"


def test_rewrite_only_selected_pins():
    new, count = rewrite_puppetfile(SAMPLE, {"puppet-chrony": "6.0.0"})
    assert count == 1
    assert "mod 'puppet-chrony', '6.0.0'  # keep the note" in new
    assert 'mod "puppet-nftables", "7.5.0"' in new
    assert ":git =>" in new


def test_parse_repo_strips_credentials():
    assert parse_repo("git@github.com:xai-org/itsys-control_repo.git") == (
        "xai-org/itsys-control_repo"
    )
    assert parse_repo("https://oauth2:secret@github.com/xai-org/itsys-control_repo.git") == (
        "xai-org/itsys-control_repo"
    )
    assert parse_repo("https://gitlab.example/group/repo.git") is None


def test_repository_list_includes_default_and_extra_sources():
    discovered = _repos_from_r10k_text({
        "sources": {
            "itsys": {"remote": "git@github.com:xai-org/itsys-control_repo.git"},
            "team": {"remote": "https://github.com/xai-org/team-control.git"},
        }
    })
    rows = merge_repositories(discovered)
    assert [row["repo"] for row in rows] == [
        "xai-org/itsys-control_repo",
        "xai-org/team-control",
    ]
    assert rows[0]["label"] == "itsys — xai-org/itsys-control_repo"


def test_compiler_read_script_is_one_shell_line():
    from app.services.github_contents import compiler_read_script

    script = compiler_read_script("xai-org/itsys-control_repo", "Puppetfile", "staging")
    assert "\n" not in script
    assert script.startswith("python3 -c ")


def test_bolt_stdout_keeps_the_puppetfile_after_noise():
    text = "Started on compiler.example\nabc1234\tmod 'puppet-chrony', '5.0.0'\nmod 'kea',\n"
    parsed = _bolt_puppetfile(text)
    assert parsed is not None
    assert parsed["sha"] == "abc1234"
    assert "puppet-chrony" in parsed["content"]
    assert _bolt_puppetfile("no tab here\n") is None


def test_repository_list_defaults_when_r10k_is_absent():
    rows = merge_repositories([])
    assert rows == [{"repo": "xai-org/itsys-control_repo", "label": "xai-org/itsys-control_repo"}]
