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
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from ..database import get_db
from ..services.puppetdb import puppetdb_service
from ..services.enc import enc_service
from ..models.schemas import NodeSummary, NodeDetail
from ..dependencies import require_role
from ..utils.validation import validate_pql_value as _validate_pql_value_raw

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


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
):
    """List all nodes with optional environment and status filters.

    Both filter parameters are validated against a strict character
    allowlist before being interpolated into the PuppetDB PQL query to
    guard against injection.
    """
    try:
        # Use the canonical fleet (all signed certs from the CA) as the source
        # of truth. This normalizes every "total nodes" / "X nodes" count in the
        # UI (Dashboard, Nodes page, etc.) to the number of trusted signed
        # certificates (the "absolutely 92" in the user's report).
        # Previously only active PDB nodes were shown, causing the 5 "lost"
        # nodes (signed certs with no active PDB record) to be invisible on
        # the dashboard and causing count mismatches vs. Certs / reality.
        fleet = await puppetdb_service.get_fleet_nodes()

        # Apply environment / status filters *after* building the fleet (in
        # Python). Synthetic (never-reported) nodes have no environment or
        # status; they are only included when no filter is active, or when
        # status explicitly matches "unreported".
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

        # Fleet construction + the Set logic inside get_fleet_nodes already
        # guarantees uniqueness and proper casing from the CA list.
        # Still do a final defensive dedup + sort for belt-and-suspenders.
        seen: set[str] = set()
        unique = []
        for node in nodes:
            cn = node.get("certname", "").strip().lower()
            if cn and cn not in seen:
                seen.add(cn)
                unique.append(node)

        unique.sort(key=lambda n: (n.get("certname") or "").lower())
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


@router.get("/{certname}", response_model=NodeDetail)
async def get_node_detail(certname: str):
    """Get detailed information about a specific node.

    Fetches the node record, all facts, and all resources from PuppetDB,
    then assembles them into a single NodeDetail response. The list of
    applied Puppet classes is derived from resources of type "Class",
    excluding the synthetic "main" and "Settings" classes that Puppet
    always includes.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        node = await puppetdb_service.get_node(certname)
        facts_raw = await puppetdb_service.get_node_facts(certname)
        resources = await puppetdb_service.get_node_resources(certname)

        # Build a flat dictionary of fact_name → fact_value from the list
        # of individual fact objects returned by PuppetDB.
        facts = {}
        for f in facts_raw:
            facts[f["name"]] = f["value"]

        # Extract the list of applied Puppet classes from the resource
        # catalogue. Puppet represents every applied class as a resource
        # of type "Class". We exclude "main" (the default top-level scope)
        # and "Settings" (internal Puppet configuration class) because
        # they are not meaningful user-facing classifications.
        classes = [
            r["title"] for r in resources
            if r.get("type") == "Class" and r["title"] not in ("main", "Settings")
        ]

        return NodeDetail(
            certname=certname,
            facts=facts,
            latest_report_status=node.get("latest_report_status"),
            report_timestamp=node.get("report_timestamp"),
            catalog_timestamp=node.get("catalog_timestamp"),
            report_environment=node.get("report_environment"),
            classes=classes,
            resources_count=len(resources),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}/reports")
async def get_node_reports(certname: str, limit: int = 20):
    """Get the most recent Puppet run reports for a specific node.

    Returns up to `limit` reports ordered by receive time (newest first).
    The certname is validated before being interpolated into the PQL
    query string to prevent injection.
    """
    certname = validate_pql_value(certname, "certname")
    try:
        reports = await puppetdb_service.get_reports(
            query=f'["=", "certname", "{certname}"]',
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

    # 1a. PuppetDB command API
    results["puppetdb_api_deactivate"] = await puppetdb_service.deactivate_node(certname)

    # 1b. CLI deactivate (requires sudoers: puppet node deactivate *)
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
    return payload
