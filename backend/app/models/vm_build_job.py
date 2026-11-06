"""VM builder jobs (one row per VMware provision request)."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VmBuildJob(Base):
    """Request, per-step progress, and outcome of one VM build.

    ``request_json`` holds the operator's form input only. vCenter
    credentials are never stored on the job.
    """

    __tablename__ = "vm_build_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    certname: Mapped[str] = mapped_column(String(255), index=True)
    vm_name: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    request_json: Mapped[str] = mapped_column(Text, default="{}")
    steps_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    log: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    requested_by: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
