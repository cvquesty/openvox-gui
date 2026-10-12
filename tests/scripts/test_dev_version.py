"""Ordering and next-dev arithmetic. Git integration lives in tests/shell."""

import dev_version


def test_dev_counter_is_numeric():
    assert dev_version.compare("3.14.1-dev.10", "3.14.1-dev.9") == 1
    assert dev_version.compare("3.14.1-dev.2", "3.14.1-dev.10") == -1


def test_pep440_phase_order():
    # dev < alpha < beta < rc < final, matching packaging.version.
    assert dev_version.strictly_greater("3.14.1-rc.1", "3.14.1-dev.26")
    assert dev_version.strictly_greater("3.14.1", "3.14.1-rc.1")
    assert dev_version.strictly_greater("3.14.1-beta.1", "3.14.1-alpha.2")
    assert dev_version.strictly_greater("3.14.1-beta.1", "3.14.1-dev.1")
    assert not dev_version.strictly_greater("3.14.1-dev.2", "3.14.1-beta.1")


def test_higher_release_beats_final():
    assert dev_version.strictly_greater("3.14.2-dev.1", "3.14.1")
    assert dev_version.compare("3.14.1-dev.26", "3.14.1-dev.26") == 0


def test_next_dev_uses_max_of_main_and_tags():
    tags = [
        "v3.14.1-dev.2",
        "v3.14.1-dev.3",
        "v3.14.1-dev.26",
        "v3.14.1-dev.40",
        "v3.15.0-dev.1",
        "3.14.1-dev.9",
    ]
    assert dev_version.next_dev_version("3.14.1-dev.26", tags) == "3.14.1-dev.41"


def test_next_dev_after_stable_starts_next_patch_train():
    assert dev_version.next_dev_version("3.14.0", []) == "3.14.1-dev.1"
    tags = ["v3.14.1-dev.2", "v3.14.1-dev.9"]
    assert dev_version.next_dev_version("3.14.0", tags) == "3.14.1-dev.10"


def test_next_dev_refuses_non_dev_prerelease():
    try:
        dev_version.next_dev_version("3.14.1-rc.1", [])
    except ValueError as exc:
        assert "explicit version" in str(exc)
    else:
        raise AssertionError("rc baseline should not guess a dev number")


def test_guard_passes_when_version_was_not_edited():
    verdict = dev_version.judge_version_change(
        touched=False,
        candidate="3.14.1-dev.1",
        baseline="3.14.1-dev.26",
        baseline_name="origin/main",
        tag_names=["v3.14.1-dev.2", "v3.14.1-dev.26"],
    )
    assert verdict.ok


def test_guard_fails_when_not_strictly_greater():
    verdict = dev_version.judge_version_change(
        touched=True,
        candidate="3.14.1-dev.3",
        baseline="3.14.1-dev.26",
        baseline_name="origin/main",
        tag_names=["v3.14.1-dev.3"],
    )
    assert not verdict.ok
    assert "not strictly greater" in verdict.message
    assert "v3.14.1-dev.3" in verdict.message


def test_guard_fails_when_tag_exists_even_if_newer():
    verdict = dev_version.judge_version_change(
        touched=True,
        candidate="3.14.1-dev.27",
        baseline="3.14.1-dev.26",
        baseline_name="origin/main",
        tag_names=["v3.14.1-dev.27"],
    )
    assert not verdict.ok
    assert "already exists" in verdict.message


def test_guard_passes_for_the_next_unused_number():
    verdict = dev_version.judge_version_change(
        touched=True,
        candidate="3.14.1-dev.27",
        baseline="3.14.1-dev.26",
        baseline_name="origin/main",
        tag_names=["v3.14.1-dev.26"],
    )
    assert verdict.ok


def test_untagged_name_also_occupies_the_version():
    assert dev_version.existing_tag("3.9.4-beta1", ["3.9.4-beta1"]) == "3.9.4-beta1"
    assert dev_version.existing_tag("3.14.1-dev.2", ["v3.14.1-dev.2"]) == "v3.14.1-dev.2"
