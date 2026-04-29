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
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from ..database import get_db
from ..services.puppetdb import puppetdb_service
from ..services.enc import enc_service
from ..models.schemas import NodeSummary, NodeDetail
from ..dependencies import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nodes", tags=["nodes"])

# Strict pattern for identifiers that may be interpolated into PQL queries.
# Puppet certnames, environment names, and report statuses should only ever
# contain alphanumeric characters, hyphens, underscores, and dots.
_SAFE_PQL_VALUE = re.compile(r'^[a-zA-Z0-9._-]+$')

def _validate_pql_value(value: str, field_name: str) -> str:
    """Validate that a value is safe to interpolate into a PQL query string.

    PQL queries are built via string interpolation, so any user-supplied
    value that gets embedded in a query must be sanitised first. This
    function rejects anything that contains characters outside the strict
    allowlist (alphanumeric, dots, hyphens, underscores) to prevent PQL
    injection — for example, an attacker injecting extra clauses via a
    crafted environment name like: production"] or 1=1 --
    """
    if not _SAFE_PQL_VALUE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains disallowed characters",
        )
    return value


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
        query = None
        conditions = []
        if environment:
            environment = _validate_pql_value(environment, "environment")
            conditions.append(f'["=", "report_environment", "{environment}"]')
        if status:
            status = _validate_pql_value(status, "status")
            conditions.append(f'["=", "latest_report_status", "{status}"]')
        if conditions:
            if len(conditions) == 1:
                query = conditions[0]
            else:
                query = '["and", ' + ', '.join(conditions) + ']'

        nodes = await puppetdb_service.get_nodes(query=query)
        # Deduplicate by certname (case-insensitive, stripped).
        # PuppetDB should enforce uniqueness but stale/reactivated
        # nodes or case mismatches can produce duplicates.
        seen: set[str] = set()
        unique = []
        for node in nodes:
            cn = node.get("certname", "").strip().lower()
            if cn and cn not in seen:
                seen.add(cn)
                unique.append(node)
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
        safe_name = _validate_pql_value(name, "package name")
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
    certname = _validate_pql_value(certname, "certname")
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
    certname = _validate_pql_value(certname, "certname")
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
    certname = _validate_pql_value(certname, "certname")
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
    certname = _validate_pql_value(certname, "certname")
    try:
        reports = await puppetdb_service.get_reports(
            query=f'["=", "certname", "{certname}"]',
            limit=limit,
        )
        return reports
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _remove_from_enc(certname: str, db: AsyncSession):
    """Remove a node from the ENC SQLite database if it exists."""
    try:
        deleted = await enc_service.delete_node(db, certname)
        if deleted:
            await db.commit()
            logger.info(f"Removed node '{certname}' from ENC")
        return deleted
    except Exception as e:
        logger.warning(f"Could not remove '{certname}' from ENC: {e}")
        return False


@router.post("/{certname}/deactivate")
async def deactivate_node(
    certname: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(require_role("admin", "operator")),
):
    """Deactivate a node in PuppetDB and remove it from the ENC."""
    certname = _validate_pql_value(certname, "certname")

    results = {}
    results["puppetdb"] = await puppetdb_service.deactivate_node(certname)
    results["enc"] = await _remove_from_enc(certname, db)

    if not results["puppetdb"]:
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
    """Completely remove a node from everywhere: PuppetDB, ENC, and CA.

    This is the single operation that administrators should use when
    decommissioning a node. It removes the node from:
      1. PuppetDB (puppet node deactivate)
      2. ENC SQLite database (classification data)
      3. Puppet CA (puppetserver ca clean)

    Any individual step that fails is logged but does not prevent the
    other steps from running. The response includes the result of each
    step so the administrator can see exactly what succeeded.
    """
    from ..utils.sudo import run_sudo

    certname = _validate_pql_value(certname, "certname")
    results = {}

    # 1. Deactivate from PuppetDB
    results["puppetdb_deactivated"] = await puppetdb_service.deactivate_node(certname)

    # 2. Remove from ENC SQLite
    results["enc_removed"] = await _remove_from_enc(certname, db)

    # 3. Clean certificate from CA
    ca_result = await run_sudo(
        ["sudo", "/opt/puppetlabs/bin/puppetserver", "ca", "clean", "--certname", certname],
        timeout=30,
    )
    results["ca_cleaned"] = ca_result["returncode"] == 0
    if not results["ca_cleaned"]:
        logger.warning(f"CA clean for '{certname}': {ca_result['stderr']}")

    all_ok = all(results.values())
    return {
        "status": "success" if all_ok else "partial",
        "message": f"Node '{certname}' purged" if all_ok else f"Node '{certname}' partially purged — check details",
        "details": results,
    }
