"""
Provisioner worker: runs queued builds outside the uvicorn request workers.

Run as the ``openvox-gui-provisioner`` systemd service::

    python -m app.services.provisioning.worker

It claims queued ``provision_jobs`` rows with an atomic
``queued → running`` update (several consoles may each run a worker),
runs up to ``OPENVOX_GUI_PROVISIONING_MAX_PARALLEL`` builds at once,
touches running rows so they are not reported as interrupted, and writes
a heartbeat (``gui_kv`` ``provisioning.worker``) that the Provisioning
page reads to warn when no worker is alive. A restart marks this host's
previously running builds as ``interrupted``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy import select

from ...config import settings
from ...database import async_session, init_db
from ...models.gui_kv import GuiKv
from ...models.provision_job import ProvisionJob
from . import bootstrap, config_store, jobs
from .netspec import NetSpecError
from .provision import BuildHooks, ProvisionRequest, Timing, validate_request
from .providers import get_provider
from .providers.base import ProviderError

logger = logging.getLogger("openvox_gui.provisioner")

HEARTBEAT_KEY = "provisioning.worker"
HEARTBEAT_STALE_S = 90


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


async def write_heartbeat(worker: str, running: list) -> None:
    payload = json.dumps({"worker": worker, "at": datetime.now(timezone.utc).isoformat(),
                          "running": running, "max_parallel": settings.provisioning_max_parallel})
    async with async_session() as db:
        row = await db.get(GuiKv, HEARTBEAT_KEY)
        if row is None:
            row = GuiKv(key=HEARTBEAT_KEY, value_json=payload, node_count=0)
            db.add(row)
        row.value_json = payload
        row.node_count = len(running)
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()


async def read_heartbeat() -> Dict:
    """Last heartbeat and whether it is fresh (any worker on any console)."""
    async with async_session() as db:
        row = (await db.execute(select(GuiKv).where(GuiKv.key == HEARTBEAT_KEY))).scalar_one_or_none()
    if row is None:
        return {"alive": False}
    try:
        data = json.loads(row.value_json or "{}")
        at = datetime.fromisoformat(data["at"])
    except (ValueError, KeyError):
        return {"alive": False}
    age = (datetime.now(timezone.utc) - at).total_seconds()
    return {**data, "alive": age < HEARTBEAT_STALE_S, "age_s": int(age)}


async def run_claimed(job_id: str, *, hooks: Optional[BuildHooks] = None, timing: Optional[Timing] = None) -> str:
    """Rebuild a claimed job's request and options from the DB and run it."""
    async with async_session() as db:
        row = await db.get(ProvisionJob, job_id)
    if row is None:
        return "missing"
    reporter = jobs.DbReporter(job_id)
    try:
        cfg = await config_store.load_settings()
        request = ProvisionRequest.from_dict(json.loads(row.request_json or "{}"))
        rec = await config_store.get_connection(row.connection_id)
        validated = validate_request(request, get_provider(rec.info.provider), cfg.default_domain)
        factory, _rec = await config_store.session_factory(rec.info.id)
        options = await bootstrap.guest_options(cfg, request.bootstrap_agent, request.bootstrap_profile)
        if options.bootstrap:
            options.bootstrap.validate()
    except (NetSpecError, ProviderError) as exc:
        await reporter.finish("failed", str(exc))
        return "failed"
    return await jobs.execute(job_id, validated, factory=factory, guest_options=options,
                              requested_by=row.requested_by, hooks=hooks, timing=timing)


async def run_forever(poll_s: float = 2.0, heartbeat_s: float = 15.0) -> None:
    await init_db()
    worker = worker_id()
    orphaned = await jobs.mark_orphaned(worker)
    if orphaned:
        logger.warning("marked %d builds interrupted after restart: %s", len(orphaned), ", ".join(orphaned))
    running: Dict[str, asyncio.Task] = {}
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover — non-POSIX
            pass

    async def heartbeat() -> None:
        while not stop.is_set():
            try:
                await write_heartbeat(worker, sorted(running))
                await jobs.touch(sorted(running))
            except Exception:  # noqa: BLE001 — a DB blip must not kill the worker
                logger.warning("provisioner heartbeat failed", exc_info=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=heartbeat_s)
            except asyncio.TimeoutError:
                pass

    beat = asyncio.create_task(heartbeat())
    logger.info("provisioner %s started (max_parallel=%s)", worker, settings.provisioning_max_parallel)
    while not stop.is_set():
        for job_id, task in list(running.items()):
            if task.done():
                running.pop(job_id)
        try:
            while len(running) < max(1, settings.provisioning_max_parallel):
                job_id = await jobs.next_queued(exclude=set(running))
                if job_id is None or not await jobs.claim(job_id, worker):
                    break
                logger.info("claimed build %s", job_id)
                running[job_id] = asyncio.create_task(run_claimed(job_id))
        except Exception:  # noqa: BLE001
            logger.warning("provisioner claim loop failed", exc_info=True)
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll_s)
        except asyncio.TimeoutError:
            pass
    logger.info("provisioner stopping; %d build(s) still running will show as interrupted", len(running))
    beat.cancel()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
