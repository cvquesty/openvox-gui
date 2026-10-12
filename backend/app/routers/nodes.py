"""
Nodes API — View and manage Puppet nodes sourced from PuppetDB.

Provides endpoints for listing nodes with optional environment and status
filters, fetching detailed information about individual nodes (including
facts, resources, classes, and recent reports), and proxying queries to
PuppetDB's v4 API.

Security note: all filter values are validated against strict allowlists
or character patterns before being interpolated into PQL query strings
to prevent PQL injection attacks.
"""
import logging
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from ..database import get_db
from ..services.puppetdb import puppetdb_service
from ..services.enc import enc_service
from ..models.schemas import NodeSummary, NodeDetail
from ..models.execution_history import ExecutionHistory
from ..dependencies import require_role
from ..utils.validation import validate_pql_value as _validate_pql_value_raw
from ..services.dismissed_nodes import dismiss_node, undismiss_node

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


def _parse_ts(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except Exception:
        return None


async def apply_live_run_status(nodes: List[dict], db: AsyncSession) -> None:
    """If Bolt recorded a newer successful puppet agent run, do not keep Failed.

    PDB latest_report can stay failed when the compiler never stored this
    run's report. Execution history is the live run we just showed as green.
    """
    if not nodes:
        return
    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        result = await db.execute(
            select(ExecutionHistory)
            .where(ExecutionHistory.status == "success")
            .where(ExecutionHistory.command_name.ilike("%puppet agent%"))
            .where(ExecutionHistory.executed_at >= cutoff)
            .order_by(desc(ExecutionHistory.executed_at))
        )
        rows = list(result.scalars().all())
    except Exception as e:
        logger.warning("live-run status lookup failed: %s", e)
        return

    latest_ok: dict[str, datetime] = {}
    short_hits: dict[str, list] = {}
    for row in rows:
        # node_name may be a single certname or a comma list / "all"
        for part in str(row.node_name or "").split(","):
            key = part.strip().lower()
            if not key or key in ("all", "ungrouped"):
                continue
            if not row.executed_at:
                continue
            ts = row.executed_at
            if getattr(ts, "tzinfo", None):
                ts = ts.replace(tzinfo=None)
            if key not in latest_ok or ts > latest_ok[key]:
                latest_ok[key] = ts
            short_hits.setdefault(key.split(".")[0], []).append((key, ts))

    if not latest_ok:
        return

    for node in nodes:
        if "pdb_latest_report_status" not in node:
            node["pdb_latest_report_status"] = node.get("latest_report_status")
        key = str(node.get("certname") or "").strip().lower()
        live_at = latest_ok.get(key)
        if not live_at:
            # Same host, other spelling (ovca1.pdxc-it… vs ovca1.pdxc-it.example.com)
            for hk, ts in latest_ok.items():
                if key == hk or (key.startswith(hk + ".") and hk.count(".") >= 1):
                    live_at = ts
                    break
        if not live_at:
            # Short name only if it maps to exactly one certname (not both sites)
            hits = short_hits.get(key.split(".")[0]) or []
            fqdns = {h[0] for h in hits}
            if len(fqdns) == 1:
                live_at = max(h[1] for h in hits)
        if not live_at:
            continue
        report_at = _parse_ts(node.get("report_timestamp"))
        report_status = (node.get("latest_report_status") or "").lower()
        # executed_at is run *start*. Report receive_time is after apply.
        # Same-run window (5 min): a failed row that landed during the
        # Bolt run we already marked success is that run, not a later
        # scheduled failure. A failed report newer than that window wins.
        same_run_window = timedelta(minutes=5)
        if report_at is None or live_at > report_at:
            node["report_timestamp"] = (
                live_at.replace(microsecond=0).isoformat() + "Z"
            )
        stale_failed = report_status == "failed" and (
            report_at is None or live_at + same_run_window >= report_at
        )
        if stale_failed:
            node["node_index_status"] = node.get("node_index_status") or report_status
            node["latest_report_status"] = "unchanged"
            node["status_source"] = "live_run"
            logger.info(
                "live run newer than failed PDB report certname=%s report_at=%s live_at=%s",
                node.get("certname"),
                report_at,
                live_at,
            )


def validate_pql_value(value: str, field_name: str) -> str:
    """HTTP-facing wrapper: central charset check, 400 on failure (srdevarch1 HP2)."""
    try:
        return _validate_pql_value_raw(value, field_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/", response_model=List[NodeSummary])
async def list_nodes(
    environment: Optional[str] = Query(None, description="Filter by environment"),
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
):
    """List all nodes with optional environment and status filters.

    Both filter parameters are validated against a strict character
    allowlist before being interpolated into the PuppetDB PQL query to
    guard against injection.
    """
    try:
        # Live fleet = active PuppetDB (get_live_nodes). DNS RR names only
        # are hidden. ovcompilers.* stay visible. ENC purge is separate.
        fleet = await puppetdb_service.get_live_nodes()

        # Apply environment / status filters after fetch (Python), so we never
        # rely on PQL operator quirks for deactivated filtering.
        if environment or status:
            if environment:
                environment = validate_pql_value(environment, "environment")
            if status:
                status = validate_pql_value(status, "status")

            env_l = environment.lower() if environment else None
            status_l = status.lower() if status else None

            filtered = []
            for n in fleet:
                if env_l:
                    if (n.get("report_environment") or "").lower() != env_l:
                        continue
                if status_l:
                    st = (n.get("latest_report_status") or "").lower()
                    if not st:
                        st = "unreported"
                    if st != status_l:
                        # allow "unreported" to be selected via status filter
                        if not (status_l in ("unreported", "none", "") and st == "unreported"):
                            continue
                filtered.append(n)
            nodes = filtered
        else:
            nodes = fleet

        # get_nodes() already dedups; final defensive dedup + sort.
        seen: set[str] = set()
        unique = []
        for node in nodes:
            cn = node.get("certname", "").strip().lower()
            if cn and cn not in seen:
                seen.add(cn)
                unique.append(node)

        unique.sort(key=lambda n: (n.get("certname") or "").lower())

        # Enrich every node with its ENC classification (environment, groups, etc.)
        # so that Overview | Nodes and Classification (ENC) consult the *exact same*
        # source of truth for the current set of nodes and their classification.
        # No duplicate references to ENC data in the frontend for the node list.
        try:
            classified = await enc_service.get_reconciled_classified_nodes(db)
            enc_map: dict = {n.certname.lower(): n for n in classified}
            for node in unique:
                key = (node.get("certname") or "").lower()
                enc_n = enc_map.get(key)
                if enc_n:
                    node["enc_environment"] = enc_n.environment
                    node["enc_groups"] = [g.name for g in getattr(enc_n, "groups", [])]
                    node["enc_classes"] = getattr(enc_n, "classes", {}) or {}
                    node["enc_parameters"] = getattr(enc_n, "parameters", {}) or {}
        except Exception as e:
            logger.warning(f"Failed to enrich node list with ENC classification: {e}")

        await apply_live_run_status(unique, db)
        return [NodeSummary(**node) for node in unique]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/packages")
async def search_packages(
    name: str = None,
    version: str = None,
    limit: int = 200,
):
    """Search for installed packages across the entire fleet.

    Uses a two-tier query strategy:

    1. PRIMARY: Queries the 'installed_packages' custom structured fact
       which contains ALL installed system packages (RPM/DEB), collected
       by the external fact in profiles/facts.d/installed_packages. This
       covers every package on the system, not just Puppet-managed ones.

    2. FALLBACK: If the custom fact isn't deployed yet, falls back to
       querying Puppet Package resources from the catalog. This only
       finds packages explicitly managed in Puppet manifests.

    IMPORTANT: This route MUST be defined before /{certname} to prevent
    FastAPI from matching 'packages' as a certname path parameter.

    Args:
        name:    Package name to search for (e.g., 'openssl', 'httpd').
                 Supports partial matching against the custom fact.
        version: Optional version filter (partial match).
        limit:   Maximum number of results (default 200).
    """
    try:
        if not name:
            return []

        search_name = name.strip().lower()

        # ── Strategy 1: Query the installed_packages custom fact ──────
        # This fact contains a JSON array of ALL installed packages on
        # each node, collected by the external fact script. We fetch the
        # fact for all nodes and filter client-side for the search term.
        try:
            fact_results = await puppetdb_service.get_facts(
                fact_name="installed_packages"
            )

            if fact_results and len(fact_results) > 0:
                packages = []
                for fact in fact_results:
                    certname = fact.get("certname", "")
                    pkg_list = fact.get("value", [])
                    if not isinstance(pkg_list, list):
                        continue
                    for pkg in pkg_list:
                        if not isinstance(pkg, dict):
                            continue
                        pkg_name = pkg.get("name", "")
                        pkg_version = pkg.get("version", "")
                        pkg_arch = pkg.get("arch", "")
                        # Partial match on package name
                        if search_name in pkg_name.lower():
                            # Apply version filter if specified
                            if version and version not in pkg_version:
                                continue
                            packages.append({
                                "certname": certname,
                                "package_name": pkg_name,
                                "version": pkg_version,
                                "provider": pkg_arch,
                            })

                if packages:
                    # Sort by certname, then package name, and limit results
                    packages.sort(key=lambda p: (p["certname"], p["package_name"]))
                    return packages[:limit]
        except Exception as e:
            logger.debug(f"Custom fact query failed (falling back to resources): {e}")

        # ── Strategy 2: Fallback to Puppet Package resources ──────────
        # Only finds packages explicitly managed in Puppet manifests.
        safe_name = validate_pql_value(name, "package name")
        pql = f'resources {{ type = "Package" and title = "{safe_name}" order by certname limit {limit} }}'
        result = await puppetdb_service._query("", params={"query": pql})
        if not isinstance(result, list):
            return []

        packages = []
        for r in result:
            params = r.get("parameters", {})
            packages.append({
                "certname": r.get("certname", ""),
                "package_name": r.get("title", ""),
                "version": params.get("ensure", "present"),
                "provider": params.get("provider", ""),
            })

        if version:
            packages = [p for p in packages if version in p.get("version", "")]

        return packages
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}/run-status")
async def get_node_run_status(certname: str, db: AsyncSession = Depends(get_db)):
    """Explain the badge: newest report vs live Bolt run."""
    certname = validate_pql_value(certname, "certname")
    try:
        node = await puppetdb_service.get_node(certname)
    except Exception as e:
        node = {"error": str(e)}
    if isinstance(node, dict) and "error" not in node:
        await apply_live_run_status([node], db)
    newest = await puppetdb_service.get_newest_report_for_certname(certname)
    return {
        "certname": certname,
        "display_status": (node or {}).get("latest_report_status")
        or (newest or {}).get("status"),
        "status_source": (node or {}).get("status_source"),
        "node_index_status": (node or {}).get("node_index_status")
        or (node or {}).get("latest_report_status"),
        "newest_report": newest,
        "note": (
            "Badge is the newest report document for this certname by "
            "receive_time (not the latest_report? flag). A newer successful "
            "GUI/Bolt puppet agent run overrides a stale failed row when the "
            "compiler did not store this run. cached_catalog_status=on_failure "
            "is a real failed report."
        ),
    }


@router.get("/{certname}/health-glance")
async def get_node_health_glance(certname: str):
    """At-a-glance host health for Node Detail (facts + optional estate history).

    Investigation helper only — not used by fleet list or dashboard.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        from ..services.node_health_glance import build_health_glance

        return await build_health_glance(certname)
    except Exception as e:
        logger.exception("health-glance failed for %s", certname)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{certname}/health-glance/sample")
async def sample_node_health_glance(
    certname: str,
    _user: str = Depends(require_role("admin", "operator")),
):
    """One-shot live OS sample via local /proc or Bolt (operator+).

    Serving-estate hosts also append to the Host Health ring. Agent nodes
    are sampled once and not retained fleet-wide.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        from ..services.node_health_glance import live_sample, build_health_glance

        sample_out = await live_sample(certname)
        glance = await build_health_glance(certname)
        glance["live"] = sample_out
        return glance
    except Exception as e:
        logger.exception("health-glance sample failed for %s", certname)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}", response_model=NodeDetail)
async def get_node_detail(certname: str, db: AsyncSession = Depends(get_db)):
    """Get detailed information about a specific node.

    Parallel PuppetDB fetches: node record, facts, class titles only, and
    resource count. Avoids downloading the full catalog just to list applied
    classes (large fleets / fat catalogs were making Node Detail feel slow).
    """
    import asyncio

    certname = validate_pql_value(certname, "certname")
    try:
        node = await puppetdb_service.get_node(certname)
        await apply_live_run_status([node], db)

        facts_raw, classes, resources_count = await asyncio.gather(
            puppetdb_service.get_node_facts(certname),
            puppetdb_service.get_node_applied_classes(certname),
            puppetdb_service.get_node_resource_count(certname),
        )

        enc_classes: list = []
        try:
            classified = await enc_service.classify_node(certname, db)
            enc_classes = sorted(
                (classified.get("classes") or {}).keys()
            )
        except Exception as e:
            logger.warning("ENC classes for %s: %s", certname, e)

        facts = {}
        for f in facts_raw or []:
            if isinstance(f, dict) and "name" in f:
                facts[f["name"]] = f.get("value")

        return NodeDetail(
            certname=certname,
            facts=facts,
            latest_report_status=node.get("latest_report_status"),
            report_timestamp=node.get("report_timestamp"),
            catalog_timestamp=node.get("catalog_timestamp"),
            report_environment=node.get("report_environment"),
            classes=list(classes or []),
            enc_classes=enc_classes,
            resources_count=int(resources_count or 0),
            status_source=node.get("status_source"),
            node_index_status=node.get("node_index_status"),
            latest_report_hash=node.get("latest_report_hash"),
            cached_catalog_status=node.get("cached_catalog_status"),
            report_producer=node.get("report_producer"),
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail=f"Node '{certname}' was not found in PuppetDB.",
            )
        logger.error("PuppetDB error loading node %s: %s", certname, e.response.status_code)
        raise HTTPException(
            status_code=502,
            detail="PuppetDB returned an error while loading this node.",
        )
    except Exception:
        logger.exception("Failed to load node %s", certname)
        raise HTTPException(
            status_code=502,
            detail="Could not load this node from PuppetDB.",
        )


@router.get("/{certname}/facts")
async def get_node_facts(certname: str):
    """Get every fact recorded for a specific node in PuppetDB.

    Returns the raw list of fact objects, each containing a name, value,
    and environment.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        facts = await puppetdb_service.get_node_facts(certname)
        return facts
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error("PuppetDB error loading facts for %s: %s", certname, e.response.status_code)
        raise HTTPException(
            status_code=502,
            detail="PuppetDB returned an error while loading facts.",
        )
    except Exception:
        logger.exception("Failed to load facts for %s", certname)
        raise HTTPException(
            status_code=502,
            detail="Could not load facts from PuppetDB.",
        )


@router.get("/{certname}/resources")
async def get_node_resources(certname: str):
    """Get every managed resource for a specific node in PuppetDB.

    Returns the full list of Puppet resources (packages, files, services,
    etc.) from the node's most recent catalogue.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        resources = await puppetdb_service.get_node_resources(certname)
        return resources
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error("PuppetDB error loading resources for %s: %s", certname, e.response.status_code)
        raise HTTPException(
            status_code=502,
            detail="PuppetDB returned an error while loading resources.",
        )
    except Exception:
        logger.exception("Failed to load resources for %s", certname)
        raise HTTPException(
            status_code=502,
            detail="Could not load resources from PuppetDB.",
        )


@router.get("/{certname}/reports")
async def get_node_reports(certname: str, limit: int = 20):
    """Get the most recent Puppet run reports for a specific node.

    Returns up to `limit` reports ordered by receive time (newest first).
    The certname is validated before being interpolated into the PQL
    query string to prevent injection.
    """
    certname = validate_pql_value(certname, "certname")
    # The node page renders status, time, environment, and version only.
    limit = max(1, min(int(limit or 20), 100))
    query = f'["=", "certname", "{certname}"]'
    try:
        try:
            reports = await puppetdb_service.get_reports_lean(
                query=query,
                limit=limit,
                fields=puppetdb_service._SUMMARY_REPORT_FIELDS,
            )
        except Exception as lean_err:
            logger.warning(
                "node report list lean extract failed (%s); falling back to full reports",
                lean_err,
            )
            reports = await puppetdb_service.get_reports(
                query=query,
                limit=limit,
            )
        return reports
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _remove_from_enc(certname: str, db: AsyncSession) -> bool:
    """
    Remove a node from ENC SQLite (and legacy classification tables if present).
    Returns True if the certname is gone from ENC afterward (deleted or never there).
    """
    from sqlalchemy import text

    try:
        deleted = await enc_service.delete_node(db, certname)
        if deleted:
            logger.info(f"Removed node '{certname}' from ENC (enc_nodes)")
        # Legacy table (migration compatibility) — best effort
        try:
            await db.execute(
                text("DELETE FROM node_classifications WHERE certname = :cn"),
                {"cn": certname},
            )
        except Exception:
            pass
        await db.commit()
        # Confirm absence
        still = await enc_service.get_node(db, certname)
        return still is None
    except Exception as e:
        logger.warning(f"Could not remove '{certname}' from ENC: {e}")
        try:
            await db.rollback()
        except Exception:
            pass
        return False


async def _sudo_ok(cmd: list, timeout: int = 60) -> tuple[bool, str]:
    """Run privileged command; return (success, stderr_or_stdout_hint)."""
    from ..utils.sudo import run_sudo

    try:
        r = await run_sudo(cmd, timeout=timeout)
        ok = r.get("returncode") == 0
        hint = (r.get("stderr") or r.get("stdout") or "").strip()
        return ok, hint
    except Exception as e:
        return False, str(e)


@router.post("/{certname}/deactivate")
async def deactivate_node(
    certname: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(require_role("admin", "operator")),
):
    """Deactivate a node in PuppetDB and remove it from the ENC."""
    certname = validate_pql_value(certname, "certname")

    results = {}
    results["puppetdb"] = await puppetdb_service.deactivate_node(certname)
    results["puppet_node_deactivate_cli"] = False
    if not results["puppetdb"]:
        cli_ok, cli_err = await _sudo_ok(
            ["sudo", "/opt/puppetlabs/bin/puppet", "node", "deactivate", certname],
            timeout=30,
        )
        results["puppet_node_deactivate_cli"] = cli_ok
        if not cli_ok and cli_err:
            logger.warning("puppet node deactivate: %s", cli_err)
    results["enc"] = await _remove_from_enc(certname, db)

    if not results["puppetdb"] and not results["puppet_node_deactivate_cli"]:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deactivate node '{certname}' from PuppetDB",
        )
    return {"status": "success", "message": f"Node '{certname}' deactivated", "details": results}


@router.post("/{certname}/purge")
async def purge_node(
    certname: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(require_role("admin", "operator")),
):
    """
    Fully decommission a node — no half-removed ghosts in PDB, CA, or ENC.

    Steps (best-effort all run; details reported per step):
      1. Deactivate in PuppetDB (command API + `puppet node deactivate`)
      2. Wait until the node is no longer *active* in PuppetDB (so Node Health /
         fleet lists stop showing it as STALE)
      3. `puppetserver ca clean --certname` — remove signed cert from CA
      4. `puppet node clean` — clear master-side node/facts/report caches
      5. Delete ENC SQLite row(s) for the certname (already-absent = success)

    Deactivated PDB records may linger until PuppetDB GC (node-purge-ttl) but
    are excluded from active inventory. CA + ENC removal is immediate.
    """
    certname = validate_pql_value(certname, "certname")
    results: dict = {}
    errors: dict = {}

    # 1a. PuppetDB command API (preferred — works on a dedicated console)
    results["puppetdb_api_deactivate"] = await puppetdb_service.deactivate_node(certname)

    # 1b. CLI only if the API failed (co-located lab fallback)
    results["puppet_node_deactivate"] = False
    if not results["puppetdb_api_deactivate"]:
        ok, err = await _sudo_ok(
            ["sudo", "/opt/puppetlabs/bin/puppet", "node", "deactivate", certname],
            timeout=45,
        )
        results["puppet_node_deactivate"] = ok
        if not ok:
            errors["puppet_node_deactivate"] = err or "failed"
            logger.warning("puppet node deactivate '%s': %s", certname, err)

    # 2. Verify no longer active (filters Node Health / get_nodes)
    verified = await puppetdb_service.wait_until_not_active(certname, timeout_s=20.0)
    results["puppetdb_not_active"] = verified
    if not verified:
        errors["puppetdb_not_active"] = (
            "Node still appears active in PuppetDB after deactivate — "
            "check PDB connectivity and node-ttl / command processing"
        )
        logger.warning("Purge: '%s' still active in PuppetDB after deactivate", certname)

    # 3. CA clean (requires sudoers: puppetserver ca clean --certname *)
    ok, err = await _sudo_ok(
        ["sudo", "/opt/puppetlabs/bin/puppetserver", "ca", "clean", "--certname", certname],
        timeout=60,
    )
    results["ca_clean"] = ok
    if not ok:
        # "No certificates to clean" / not found is acceptable for already-cleaned
        low = (err or "").lower()
        if "could not find" in low or "no certificates" in low or "not found" in low:
            results["ca_clean"] = True
            results["ca_clean_already_absent"] = True
        else:
            errors["ca_clean"] = err or "failed"
            logger.warning("CA clean '%s': %s", certname, err)

    # 4. Master-side clean (cached facts / reports on server)
    ok, err = await _sudo_ok(
        ["sudo", "/opt/puppetlabs/bin/puppet", "node", "clean", certname],
        timeout=45,
    )
    results["puppet_node_clean"] = ok
    if not ok:
        low = (err or "").lower()
        if "could not find" in low or "not found" in low or "no such" in low:
            results["puppet_node_clean"] = True
            results["puppet_node_clean_already_absent"] = True
        else:
            errors["puppet_node_clean"] = err or "failed"
            logger.warning("puppet node clean '%s': %s", certname, err)

    # 5. ENC SQLite — must not leave classification ghosts
    results["enc_removed"] = await _remove_from_enc(certname, db)
    if not results["enc_removed"]:
        errors["enc_removed"] = "Failed to remove certname from ENC SQLite"

    # Critical path for "no vestiges" in the GUI: not active in PDB + ENC gone + CA gone
    critical_ok = (
        results.get("puppetdb_not_active")
        and results.get("enc_removed")
        and results.get("ca_clean")
    )
    # At least one deactivate path should have succeeded (or node already gone)
    if not results.get("puppetdb_api_deactivate") and not results.get("puppet_node_deactivate"):
        if results.get("puppetdb_not_active"):
            results["deactivate_already_inactive"] = True
        else:
            critical_ok = False

    status = "success" if critical_ok and not errors else ("partial" if critical_ok else "failed")
    if critical_ok and errors:
        status = "partial"

    message = {
        "success": f"Node '{certname}' fully purged (PuppetDB inactive, CA cleaned, ENC removed)",
        "partial": f"Node '{certname}' mostly purged — review details for failed steps",
        "failed": f"Node '{certname}' purge incomplete — node may still appear in the UI",
    }[status]

    payload = {
        "status": status,
        "message": message,
        "details": results,
    }
    if errors:
        payload["errors"] = errors

    if status == "failed":
        raise HTTPException(status_code=500, detail=payload)
    try:
        await dismiss_node(db, certname, dismissed_by=str(_user), reason="purged")
        results["dismissed"] = True
    except Exception as e:
        logger.warning("purge dismiss '%s': %s", certname, e)
    return payload


@router.post("/{certname}/dismiss")
async def dismiss_ghost_node(
    certname: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(require_role("admin", "operator")),
):
    """Hide a ghost/unclassified certname from GUI fleet lists.

    Always records the dismiss so Unclassified / Nodes drop the name even
    if PuppetDB deactivate or CA clean cannot run. Best-effort PDB
    deactivate and ENC delete still run.
    """
    certname = validate_pql_value(certname, "certname")
    stored = await dismiss_node(db, certname, dismissed_by=str(_user), reason="ghost")
    enc_ok = await _remove_from_enc(certname, db)
    pdb_ok = await puppetdb_service.deactivate_node(certname)
    return {
        "status": "success",
        "message": (
            f"'{stored}' removed from GUI fleet lists. "
            "It will stay hidden until restored."
        ),
        "details": {
            "dismissed": True,
            "enc_removed": enc_ok,
            "puppetdb_deactivate": pdb_ok,
        },
    }


@router.delete("/{certname}/dismiss")
async def restore_dismissed_node(
    certname: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(require_role("admin", "operator")),
):
    """Undo a dismiss so the certname can reappear if still in PuppetDB."""
    certname = validate_pql_value(certname, "certname")
    if not await undismiss_node(db, certname):
        raise HTTPException(status_code=404, detail=f"'{certname}' is not dismissed")
    return {"status": "success", "message": f"'{certname}' restored to fleet lists"}
