"""Provisioning: provider connections and build jobs."""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProvisionConnection(Base):
    """One provider endpoint (a vCenter today; a BMC/Redfish controller later).

    The password lives in ``cluster_secrets`` as
    ``provisioning_connection_password:<id>`` (Fernet), never here.
    """

    __tablename__ = "provision_connections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), default="vmware")
    name: Mapped[str] = mapped_column(String(128), default="")
    host: Mapped[str] = mapped_column(String(255), default="")
    port: Mapped[int] = mapped_column(Integer, default=443)
    username: Mapped[str] = mapped_column(String(255), default="")
    verify_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    ca_bundle: Mapped[str] = mapped_column(String(1024), default="")
    options_json: Mapped[str] = mapped_column(Text, default="{}")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    updated_by: Mapped[str] = mapped_column(String(128), default="")


class ProvisionJob(Base):
    """Request, per-step progress, and outcome of one build.

    ``request_json`` holds the operator's form input only. Credentials and
    the per-build CSR token are never stored; ``csr_challenge_hash`` is
    sha256(token) and is not returned by the API.
    """

    __tablename__ = "provision_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), default="vmware")
    connection_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    certname: Mapped[str] = mapped_column(String(255), index=True)
    vm_name: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    request_json: Mapped[str] = mapped_column(Text, default="{}")
    steps_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    log: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    csr_challenge_hash: Mapped[str] = mapped_column(String(64), default="")
    requested_by: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
