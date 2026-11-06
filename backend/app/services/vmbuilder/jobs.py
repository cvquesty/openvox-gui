"""
VM build jobs: persistence and the in-process runner.

A build runs as an asyncio task in the uvicorn worker that accepted it.
Progress is written to ``vm_build_jobs`` after every step so any worker
(or console behind the VIP) can show it. A job whose row stops updating
for ``STALE_AFTER`` is reported as ``interrupted`` (worker restart).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from ...database import async_session
from ...models.vm_build_job import VmBuildJob
from ...utils.audit import audit_event
from .guestinfo import GuestOptions
from .provision import STEPS, BuildError, BuildHooks, ClientFactory, Timing, ValidatedRequest, run_build

logger = logging.getLogger(__name__)

ACTIVE = ("queued", "running")
STALE_AFTER = timedelta(hours=2)
_LOG_LIMIT = 64 * 1024

_tasks: set[asyncio.Task] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def serialize(job: VmBuildJob) -> Dict[str, Any]:
    status = job.status
    updated = _aware(job.updated_at)
    if status in ACTIVE and updated is not None and _now() - updated > STALE_AFTER:
        status = "interrupted"
    steps = json.loads(job.steps_json or "{}")
    return {
        "id": job.id,
        "certname": job.certname,
        "vm_name": job.vm_name,
        "status": status,
        "steps": [{"name": s, **steps.get(s, {"state": "pending"})} for s in STEPS],
        "request": json.loads(job.request_json or "{}"),
        "result": json.loads(job.result_json or "{}"),
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
            select(VmBuildJob).order_by(VmBuildJob.created_at.desc()).limit(limit)
        )).scalars().all()
    return [serialize(r) for r in rows]


async def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    async with async_session() as db:
        row = await db.get(VmBuildJob, job_id)
    return serialize(row) if row is not None else None


async def active_job_for(certname: str) -> Optional[Dict[str, Any]]:
    async with async_session() as db:
        rows = (await db.execute(
            select(VmBuildJob).where(VmBuildJob.certname == certname, VmBuildJob.status.in_(ACTIVE))
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
            row = await db.get(VmBuildJob, self.job_id)
            if row is None:
                return
            mutate(row)
            row.updated_at = _now()
            await db.commit()

    def _append(self, row: VmBuildJob, line: str) -> None:
        text = (row.log or "") + f"{_now().strftime('%Y-%m-%dT%H:%M:%SZ')} {line}\n"
        row.log = text[-_LOG_LIMIT:]

    async def step(self, name: str, state: str, message: str = "") -> None:
        def mutate(row: VmBuildJob) -> None:
            steps = json.loads(row.steps_json or "{}")
            steps[name] = {"state": state, "message": message, "at": _now().isoformat()}
            row.steps_json = json.dumps(steps)
            self._append(row, f"[{name}] {state}{': ' + message if message else ''}")

        await self._update(mutate)

    async def log(self, message: str) -> None:
        await self._update(lambda row: self._append(row, message))

    async def set_result(self, **fields) -> None:
        def mutate(row: VmBuildJob) -> None:
            result = json.loads(row.result_json or "{}")
            result.update(fields)
            row.result_json = json.dumps(result)
            if fields.get("vm_name"):
                row.vm_name = fields["vm_name"]

        await self._update(mutate)

    async def finish(self, status: str, error: str = "") -> None:
        def mutate(row: VmBuildJob) -> None:
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
        for key, value in (("signed", "signed"), ("requested", "requested")):
            if any((c.get("name") or "").lower() == certname for c in listing.get(key) or []):
                return value
        return None

    async def sign(certname: str) -> str:
        from .. import certificates_service as cs

        if cs.is_protected_certname(certname):
            raise BuildError(f"Refusing to sign {certname}: it is an estate server identity")
        result = await cs.run_ca_command(["sign", "--certname", certname], timeout=120)
        ok = result.get("returncode") == 0
        audit_event("cert_sign", user=requested_by, targets=certname,
                    detail=f"vmbuilder job {job_id}", rc=result.get("returncode"), success=ok)
        cs.invalidate_cert_list_cache()
        if not ok:
            detail = (result.get("stderr") or result.get("stdout") or "").strip()[:300]
            raise BuildError(f"CA sign failed for {certname}: {detail or 'no output'}")
        via = result.get("via") or ""
        return f"Signed certificate for {certname}{f' ({via})' if via else ''}"

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
        audit_event("vmbuilder_classify", user=requested_by, targets=certname,
                    detail=f"environment={environment} groups={group_ids}")

    return BuildHooks(cert_state=cert_state, sign_certificate=sign,
                      node_in_fleet=node_in_fleet, classify_node=classify)


async def create_job(validated: ValidatedRequest, *, requested_by: str) -> Dict[str, Any]:
    row = VmBuildJob(
        id=str(uuid.uuid4()),
        certname=validated.certname,
        vm_name=validated.vm_name,
        status="queued",
        request_json=json.dumps(asdict(validated.request)),
        requested_by=requested_by,
    )
    async with async_session() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return serialize(row)


async def _run(
    job_id: str,
    validated: ValidatedRequest,
    factory: ClientFactory,
    guest_options: GuestOptions,
    template_prefix: str,
    hooks: BuildHooks,
    timing: Optional[Timing],
) -> None:
    reporter = DbReporter(job_id)
    await reporter._update(lambda row: setattr(row, "status", "running"))
    try:
        status = await run_build(
            validated,
            client_factory=factory,
            reporter=reporter,
            hooks=hooks,
            guest_options=guest_options,
            template_prefix=template_prefix,
            timing=timing,
        )
        await reporter.finish(status)
    except BuildError as exc:
        await reporter.finish("failed", str(exc))
    except Exception as exc:  # noqa: BLE001 — never leave a job stuck in running
        logger.exception("vmbuilder job %s crashed", job_id)
        await reporter.finish("failed", f"Internal error: {exc.__class__.__name__}")


def start_job(
    job_id: str,
    validated: ValidatedRequest,
    *,
    factory: ClientFactory,
    guest_options: GuestOptions,
    template_prefix: str,
    requested_by: str,
    hooks: Optional[BuildHooks] = None,
    timing: Optional[Timing] = None,
) -> asyncio.Task:
    task = asyncio.create_task(_run(
        job_id, validated, factory, guest_options, template_prefix,
        hooks or app_hooks(requested_by, job_id), timing,
    ))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task
