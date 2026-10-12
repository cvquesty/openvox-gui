"""Mirror sync must keep going after a single rsync package error."""
from app.routers.installer import _rsync_transfer_ok


def test_rsync_ok_and_partial_are_not_fatal():
    assert _rsync_transfer_ok(0) is True
    assert _rsync_transfer_ok(23) is True
    assert _rsync_transfer_ok(24) is True


def test_rsync_hard_failure_is_fatal():
    assert _rsync_transfer_ok(1) is False
    assert _rsync_transfer_ok(12) is False
    assert _rsync_transfer_ok(255) is False
