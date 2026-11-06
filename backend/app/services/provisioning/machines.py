"""
Lifecycle for machines this GUI built (power, snapshot, destroy).

A machine is a provision job whose result carries an ``instance_id``.
Only those are managed here: the GUI never powers off or deletes VMs it did
not create. Destroy also decommissions the node, like Nodes → Purge:
deactivate in OpenVoxDB, clean the CA certificate, remove the ENC node.
Each cleanup step is best-effort and reported; estate server identities
are refused outright.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select

from ...database import async_session
from ...models.provision_job import ProvisionJob
from ...utils.audit import audit_event
from . import config_store
from .jobs import DbReporter
from .providers.base import POWER_ACTIONS, InstanceNotFound, ProviderError

_SNAPSHOT_NAME = re.compile(r"^[A-Za-z0-9 ._:-]{1,80}$")

StepResult = Tuple[bool, str]


class MachineError(RuntimeError):
    """Operator-facing lifecycle failure."""


@dataclass
class DestroyHooks:
    deactivate: Callable[[str], Awaitable[StepResult]]
    ca_clean: Callable[[str], Awaitable[StepResult]]
    enc_delete: Callable[[str], Awaitable[StepResult]]
    is_protected: Callable[[str], bool]


def app_destroy_hooks() -> DestroyHooks:
    async def deactivate(certname: str) -> StepResult:
        from ..puppetdb import puppetdb_service

        if not await puppetdb_service.deactivate_node(certname):
            return False, "OpenVoxDB deactivate command failed"
        gone = await puppetdb_service.wait_until_not_active(certname, timeout_s=20.0)
        return True, "Deactivated in OpenVoxDB" + ("" if gone else " (still listed as active; check command processing)")

    async def ca_clean(certname: str) -> StepResult:
        from .. import certificates_service as cs

        result = await cs.run_ca_command(["clean", "--certname", certname], timeout=60)
        cs.invalidate_cert_list_cache()
        text = f"{result.get('stderr') or ''} {result.get('stdout') or ''}".lower()
        if result.get("returncode") == 0:
            return True, "CA certificate cleaned"
        if any(k in text for k in ("could not find", "no certificates", "not found")):
            return True, "No CA certificate to clean"
        return False, f"CA clean failed: {(result.get('stderr') or result.get('stdout') or '').strip()[:200]}"

    async def enc_delete(certname: str) -> StepResult:
        from ..enc import enc_service

        async with async_session() as db:
            removed = await enc_service.delete_node(db, certname)
            await db.commit()
        return True, "ENC node removed" if removed else "No ENC node to remove"

    def is_protected(certname: str) -> bool:
        from .. import certificates_service as cs

        return cs.is_protected_certname(certname)

    return DestroyHooks(deactivate=deactivate, ca_clean=ca_clean, enc_delete=enc_delete, is_protected=is_protected)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _machine(row: ProvisionJob) -> Optional[Dict[str, Any]]:
    result = json.loads(row.result_json or "{}")
    instance_id = result.get("instance_id") or result.get("vm_moid")
    if not instance_id or result.get("destroyed"):
        return None
    return {
        "job_id": row.id,
        "certname": row.certname,
        "name": row.vm_name or result.get("vm_name") or row.certname,
        "instance_id": instance_id,
        "provider": row.provider,
        "connection_id": row.connection_id,
        "build_status": row.status,
        "guest_ip": result.get("guest_ip", ""),
        "requested_by": row.requested_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "snapshots": result.get("snapshots", []),
        "last_action": result.get("last_action"),
    }


async def list_machines() -> List[Dict[str, Any]]:
    async with async_session() as db:
        rows = (await db.execute(select(ProvisionJob).order_by(ProvisionJob.created_at.desc()))).scalars().all()
    seen: set = set()
    out = []
    for row in rows:
        machine = _machine(row)
        if machine is None or (machine["connection_id"], machine["instance_id"]) in seen:
            continue
        seen.add((machine["connection_id"], machine["instance_id"]))
        out.append(machine)
    return out


async def with_live_state(machines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add provider power / IP. One session per connection."""
    by_conn: Dict[str, List[Dict[str, Any]]] = {}
    for m in machines:
        by_conn.setdefault(m["connection_id"], []).append(m)
    for conn_id, items in by_conn.items():
        try:
            factory, _rec = await config_store.session_factory(conn_id)
        except Exception as exc:  # noqa: BLE001
            for m in items:
                m["live"] = {"error": str(exc)}
            continue

        def _states(factory=factory, items=items):
            session = factory()
            try:
                states = {}
                for m in items:
                    try:
                        st = session.instance_state(m["instance_id"])
                        states[m["instance_id"]] = {"power_state": st.power_state, "ip_address": st.ip_address,
                                                    "tools_status": st.tools_status}
                    except InstanceNotFound:
                        states[m["instance_id"]] = {"power_state": "missing"}
                    except ProviderError as exc:
                        states[m["instance_id"]] = {"error": str(exc)}
                return states
            finally:
                session.close()

        try:
            states = await asyncio.to_thread(_states)
        except ProviderError as exc:
            states = {m["instance_id"]: {"error": str(exc)} for m in items}
        for m in items:
            m["live"] = states.get(m["instance_id"], {})
    return machines


async def _load(job_id: str) -> Tuple[ProvisionJob, Dict[str, Any]]:
    async with async_session() as db:
        row = await db.get(ProvisionJob, job_id)
    machine = _machine(row) if row is not None else None
    if row is None or machine is None:
        raise MachineError("No machine for this build (it was never created, or it was destroyed)")
    return row, machine


async def _in_session(connection_id: str, fn):
    factory, _rec = await config_store.session_factory(connection_id)

    def _run():
        session = factory()
        try:
            return fn(session)
        finally:
            session.close()

    return await asyncio.to_thread(_run)


async def power(job_id: str, action: str, *, user: str) -> Dict[str, Any]:
    if action not in POWER_ACTIONS:
        raise MachineError(f"Unknown power action {action!r}")
    row, m = await _load(job_id)
    state = await _in_session(m["connection_id"], lambda s: s.power(m["instance_id"], action))
    reporter = DbReporter(job_id)
    await reporter.set_result(last_action={"action": f"power {action}", "by": user, "at": _now()})
    await reporter.log(f"[lifecycle] power {action} by {user}: {state.power_state}")
    audit_event("provisioning_power", user=user, targets=row.certname, detail=f"job={job_id} action={action}")
    return {"job_id": job_id, "power_state": state.power_state, "ip_address": state.ip_address}


async def snapshot(job_id: str, name: str, description: str, *, user: str) -> Dict[str, Any]:
    name = (name or "").strip()
    if not _SNAPSHOT_NAME.match(name):
        raise MachineError("Snapshot name: up to 80 letters, digits, spaces and . _ : -")
    row, m = await _load(job_id)
    snap_id = await _in_session(m["connection_id"], lambda s: s.snapshot(m["instance_id"], name, description[:500]))
    reporter = DbReporter(job_id)
    snaps = [*m["snapshots"], {"name": name, "id": snap_id, "by": user, "at": _now()}]
    await reporter.set_result(snapshots=snaps, last_action={"action": f"snapshot {name}", "by": user, "at": _now()})
    await reporter.log(f"[lifecycle] snapshot {name!r} by {user}")
    audit_event("provisioning_snapshot", user=user, targets=row.certname, detail=f"job={job_id} name={name}")
    return {"job_id": job_id, "snapshot": name, "id": snap_id}


async def destroy(
    job_id: str,
    *,
    user: str,
    confirm: str,
    deactivate: bool = True,
    clean_cert: bool = True,
    remove_enc: bool = True,
    hooks: Optional[DestroyHooks] = None,
) -> Dict[str, Any]:
    hooks = hooks or app_destroy_hooks()
    row, m = await _load(job_id)
    certname = row.certname
    if (confirm or "").strip().lower() != certname:
        raise MachineError(f"Type the certname {certname} to confirm")
    if hooks.is_protected(certname):
        raise MachineError(f"Refusing to destroy {certname}: it is an estate server identity")

    steps: Dict[str, Dict[str, Any]] = {}
    try:
        await _in_session(m["connection_id"], lambda s: s.destroy(m["instance_id"]))
        steps["vm"] = {"ok": True, "message": f"{m['name']} destroyed"}
    except InstanceNotFound:
        steps["vm"] = {"ok": True, "message": f"{m['name']} was already gone from the provider"}
    except ProviderError as exc:
        steps["vm"] = {"ok": False, "message": str(exc)}
        await DbReporter(job_id).log(f"[lifecycle] destroy by {user} failed: {exc}")
        audit_event("provisioning_destroy", user=user, targets=certname, detail=f"job={job_id} vm_failed",
                    success=False)
        raise MachineError(f"Destroy failed; nothing else was changed: {exc}") from exc

    for flag, key, fn in ((deactivate, "openvoxdb", hooks.deactivate),
                          (clean_cert, "ca", hooks.ca_clean),
                          (remove_enc, "enc", hooks.enc_delete)):
        if not flag:
            steps[key] = {"ok": True, "message": "skipped"}
            continue
        try:
            ok, message = await fn(certname)
        except Exception as exc:  # noqa: BLE001 — report and continue with the next cleanup
            ok, message = False, f"{exc.__class__.__name__}: {exc}"
        steps[key] = {"ok": ok, "message": message}

    reporter = DbReporter(job_id)
    await reporter.set_result(destroyed={"at": _now(), "by": user, "steps": steps})
    for key, step in steps.items():
        await reporter.log(f"[lifecycle] destroy {key}: {'ok' if step['ok'] else 'FAILED'} — {step['message']}")
    ok_all = all(s["ok"] for s in steps.values())
    audit_event("provisioning_destroy", user=user, targets=certname,
                detail=f"job={job_id} " + " ".join(f"{k}={'ok' if v['ok'] else 'failed'}" for k, v in steps.items()),
                success=ok_all)
    return {"job_id": job_id, "certname": certname, "ok": ok_all, "steps": steps}
