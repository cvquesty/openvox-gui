"""
Provisioning jobs: persistence, CA / OpenVoxDB / ENC hooks, and the runner.

A job row holds the operator's request (no secrets), the provider and
connection it targets, per-step progress, and sha256 of the per-build CSR
token. Progress is written after every step so any worker or console
behind the VIP can show it. A job whose row stops updating for
``STALE_AFTER`` is reported as ``interrupted``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, update

from ...database import async_session
from ...models.provision_job import ProvisionJob
from ...utils.audit import audit_event
from .cloudinit import GuestOptions
from .provision import (
    STEPS,
    BuildCancelled,
    BuildError,
    BuildHooks,
    SessionFactory,
    Timing,
    ValidatedRequest,
    run_build,
)

logger = logging.getLogger(__name__)

ACTIVE = ("queued", "running", "cancelling")
STALE_AFTER = timedelta(hours=2)
_LOG_LIMIT = 64 * 1024

_tasks: set[asyncio.Task] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def serialize(job: ProvisionJob) -> Dict[str, Any]:
    status = job.status
    updated = _aware(job.updated_at)
    if status in ACTIVE and updated is not None and _now() - updated > STALE_AFTER:
        status = "interrupted"
    steps = json.loads(job.steps_json or "{}")
    return {
        "id": job.id,
        "provider": job.provider,
        "connection_id": job.connection_id,
        "certname": job.certname,
        "vm_name": job.vm_name,
        "status": status,
        "steps": [{"name": s, **steps.get(s, {"state": "pending"})} for s in STEPS],
        "request": json.loads(job.request_json or "{}"),
        "result": json.loads(job.result_json or "{}"),
        "csr_verified": bool(job.csr_challenge_hash),
        "log": job.log or "",
        "error": job.error or "",
        "requested_by": job.requested_by,
        "created_at": _aware(job.created_at).isoformat() if job.created_at else None,
        "updated_at": updated.isoformat() if updated else None,
        "finished_at": _aware(job.finished_at).isoformat() if job.finished_at else None,
    }


async def list_jobs(limit: int = 50) -> List[Dict[str, Any]]:
    async with async_session() as db:
        rows = (await db.execute(
            select(ProvisionJob).order_by(ProvisionJob.created_at.desc()).limit(limit)
        )).scalars().all()
    return [serialize(r) for r in rows]


async def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    async with async_session() as db:
        row = await db.get(ProvisionJob, job_id)
    return serialize(row) if row is not None else None


async def active_job_for(certname: str) -> Optional[Dict[str, Any]]:
    async with async_session() as db:
        rows = (await db.execute(
            select(ProvisionJob).where(ProvisionJob.certname == certname, ProvisionJob.status.in_(ACTIVE))
        )).scalars().all()
    for row in rows:
        data = serialize(row)
        if data["status"] in ACTIVE:
            return data
    return None


class DbReporter:
    def __init__(self, job_id: str) -> None:
        self.job_id = job_id

    async def _update(self, mutate) -> None:
        async with async_session() as db:
            row = await db.get(ProvisionJob, self.job_id)
            if row is None:
                return
            mutate(row)
            row.updated_at = _now()
            await db.commit()

    def _append(self, row: ProvisionJob, line: str) -> None:
        text = (row.log or "") + f"{_now().strftime('%Y-%m-%dT%H:%M:%SZ')} {line}\n"
        row.log = text[-_LOG_LIMIT:]

    async def step(self, name: str, state: str, message: str = "") -> None:
        def mutate(row: ProvisionJob) -> None:
            steps = json.loads(row.steps_json or "{}")
            steps[name] = {"state": state, "message": message, "at": _now().isoformat()}
            row.steps_json = json.dumps(steps)
            self._append(row, f"[{name}] {state}{': ' + message if message else ''}")

        await self._update(mutate)

    async def log(self, message: str) -> None:
        await self._update(lambda row: self._append(row, message))

    async def set_result(self, **fields) -> None:
        def mutate(row: ProvisionJob) -> None:
            result = json.loads(row.result_json or "{}")
            result.update(fields)
            row.result_json = json.dumps(result)
            if fields.get("vm_name"):
                row.vm_name = fields["vm_name"]

        await self._update(mutate)

    async def store_csr_hash(self, digest: str) -> None:
        await self._update(lambda row: setattr(row, "csr_challenge_hash", digest))

    async def finish(self, status: str, error: str = "") -> None:
        def mutate(row: ProvisionJob) -> None:
            row.status = status
            row.error = error
            row.finished_at = _now()
            self._append(row, f"finished: {status}{' — ' + error if error else ''}")

        await self._update(mutate)


def app_hooks(requested_by: str, job_id: str) -> BuildHooks:
    """CA / OpenVoxDB / ENC calls used by steps 4–5."""

    async def cert_state(certname: str) -> Optional[str]:
        from .. import certificates_service as cs

        state = await cs.cert_state_anywhere(certname)
        if state:
            return state
        listing = await cs.list_certificates(use_cache=False)
        for key in ("signed", "requested"):
            if any((c.get("name") or "").lower() == certname for c in listing.get(key) or []):
                return key
        return None

    async def fetch_csr(certname: str) -> Optional[bytes]:
        from .. import certificates_service as cs

        return await cs.fetch_csr_pem(certname)

    async def sign(certname: str) -> str:
        from .. import certificates_service as cs

        if cs.is_protected_certname(certname):
            raise BuildError(f"Refusing to sign {certname}: it is an estate server identity")
        result = await cs.run_ca_command(["sign", "--certname", certname], timeout=120)
        ok = result.get("returncode") == 0
        audit_event("cert_sign", user=requested_by, targets=certname,
                    detail=f"provisioning job {job_id} (CSR challenge verified)",
                    rc=result.get("returncode"), success=ok)
        cs.invalidate_cert_list_cache()
        if not ok:
            detail = (result.get("stderr") or result.get("stdout") or "").strip()[:300]
            raise BuildError(f"CA sign failed for {certname}: {detail or 'no output'}")
        via = result.get("via") or ""
        return f"Signed certificate for {certname}{f' ({via})' if via else ''}"

    async def csr_rejected(certname: str, reason: str) -> None:
        audit_event("provisioning_csr_rejected", user=requested_by, targets=certname,
                    detail=f"job={job_id} reason={reason}", success=False)

    async def node_in_fleet(certname: str) -> bool:
        from ..puppetdb import puppetdb_service

        live = await puppetdb_service.get_live_nodes()
        return any(str(n.get("certname", "")).lower() == certname for n in live)

    async def classify(certname: str, environment: str, group_ids: List[int]) -> None:
        from ..enc import enc_service

        async with async_session() as db:
            existing = await enc_service.get_node(db, certname)
            await enc_service.save_node(
                db,
                certname=certname,
                environment=environment,
                classes=(existing.classes if existing else None) or {},
                parameters=(existing.parameters if existing else None) or {},
                group_ids=group_ids or None,
            )
            await db.commit()
        audit_event("provisioning_classify", user=requested_by, targets=certname,
                    detail=f"environment={environment} groups={group_ids}")

    async def is_cancelled() -> bool:
        async with async_session() as db:
            row = await db.get(ProvisionJob, job_id)
        return row is not None and row.status == "cancelling"

    return BuildHooks(
        cert_state=cert_state, fetch_csr=fetch_csr, sign_certificate=sign,
        node_in_fleet=node_in_fleet, classify_node=classify, csr_rejected=csr_rejected,
        is_cancelled=is_cancelled,
    )


async def create_job(
    validated: ValidatedRequest, *, provider: str, connection_id: str, requested_by: str,
) -> Dict[str, Any]:
    row = ProvisionJob(
        id=str(uuid.uuid4()),
        provider=provider,
        connection_id=connection_id,
        certname=validated.certname,
        vm_name=validated.name,
        status="queued",
        request_json=json.dumps({**validated.request.to_dict(), "connection": connection_id}),
        requested_by=requested_by,
    )
    async with async_session() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return serialize(row)


async def execute(
    job_id: str,
    validated: ValidatedRequest,
    *,
    factory: SessionFactory,
    guest_options: GuestOptions,
    requested_by: str,
    hooks: Optional[BuildHooks] = None,
    timing: Optional[Timing] = None,
) -> str:
    reporter = DbReporter(job_id)
    await reporter._update(lambda row: setattr(row, "status", "running")
                           if row.status == "queued" else None)
    if hooks is None:
        hooks = app_hooks(requested_by, job_id)
    try:
        status = await run_build(
            validated,
            session_factory=factory,
            reporter=reporter,
            hooks=hooks,
            guest_options=guest_options,
            timing=timing,
        )
        await reporter.finish(status)
        return status
    except BuildCancelled as exc:
        async with async_session() as db:
            row = await db.get(ProvisionJob, job_id)
            created = json.loads(row.result_json or "{}").get("vm_name", "") if row else ""
        note = f"{exc}. {created} was already created; remove it in vCenter if it is not wanted." if created else str(exc)
        await reporter.finish("cancelled", note)
        return "cancelled"
    except BuildError as exc:
        await reporter.finish("failed", str(exc))
        return "failed"
    except Exception as exc:  # noqa: BLE001 — never leave a job stuck in running
        logger.exception("provisioning job %s crashed", job_id)
        await reporter.finish("failed", f"Internal error: {exc.__class__.__name__}")
        return "failed"


async def count_active(username: Optional[str] = None) -> int:
    stmt = select(func.count()).select_from(ProvisionJob).where(ProvisionJob.status.in_(ACTIVE))
    if username is not None:
        stmt = stmt.where(ProvisionJob.requested_by == username)
    async with async_session() as db:
        return int((await db.execute(stmt)).scalar_one())


async def claim(job_id: str, worker: str) -> bool:
    """Atomically move a queued job to running. Safe with several workers."""
    async with async_session() as db:
        result = await db.execute(
            update(ProvisionJob)
            .where(ProvisionJob.id == job_id, ProvisionJob.status == "queued")
            .values(status="running", updated_at=_now())
        )
        await db.commit()
    if result.rowcount != 1:
        return False
    await DbReporter(job_id).set_result(worker=worker)
    return True


async def next_queued(exclude: Optional[set] = None) -> Optional[str]:
    async with async_session() as db:
        rows = (await db.execute(
            select(ProvisionJob.id).where(ProvisionJob.status == "queued")
            .order_by(ProvisionJob.created_at).limit(20)
        )).scalars().all()
    for job_id in rows:
        if not exclude or job_id not in exclude:
            return job_id
    return None


async def touch(job_ids: List[str]) -> None:
    if not job_ids:
        return
    async with async_session() as db:
        await db.execute(update(ProvisionJob).where(ProvisionJob.id.in_(job_ids)).values(updated_at=_now()))
        await db.commit()


async def mark_orphaned(worker: str) -> List[str]:
    """Jobs a previous run of this worker left running: mark them interrupted."""
    async with async_session() as db:
        rows = (await db.execute(
            select(ProvisionJob).where(ProvisionJob.status.in_(("running", "cancelling")))
        )).scalars().all()
        orphaned = []
        for row in rows:
            owner = json.loads(row.result_json or "{}").get("worker", "")
            if owner.split(":")[0] == worker.split(":")[0] and owner != worker:
                row.status = "interrupted"
                row.error = "The provisioner restarted while this build was running"
                row.finished_at = _now()
                orphaned.append(row.id)
        await db.commit()
    return orphaned


async def request_cancel(job_id: str, user: str) -> Optional[Dict[str, Any]]:
    """Queued → cancelled at once; running → cancelling (the pipeline stops at its next check)."""
    async with async_session() as db:
        row = await db.get(ProvisionJob, job_id)
        if row is None:
            return None
        if row.status == "queued":
            row.status = "cancelled"
            row.error = f"Cancelled by {user} before it started"
            row.finished_at = _now()
        elif row.status == "running":
            row.status = "cancelling"
        else:
            raise BuildError(f"A {row.status} build cannot be cancelled")
        row.updated_at = _now()
        await db.commit()
        await db.refresh(row)
        return serialize(row)


def start_inline(job_id: str, validated: ValidatedRequest, **kwargs) -> asyncio.Task:
    task = asyncio.create_task(execute(job_id, validated, **kwargs))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task
