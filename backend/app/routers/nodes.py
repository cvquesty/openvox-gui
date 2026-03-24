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
import re
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from ..services.puppetdb import puppetdb_service
from ..models.schemas import NodeSummary, NodeDetail

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
        return [NodeSummary(**node) for node in nodes]
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

    Queries PuppetDB's resource catalog for Package resources to find
    which nodes have a specific package. This uses the universally
    available 'resources' endpoint (not the PE-only 'packages' endpoint)
    so it works with all PuppetDB versions including open-source.

    The query searches for resources of type 'Package' with a matching
    title (package name). Results include the certname, package title,
    and the 'ensure' parameter which indicates the installed version.

    IMPORTANT: This route MUST be defined before /{certname} to prevent
    FastAPI from matching 'packages' as a certname path parameter.

    Args:
        name:    Package name to search for (e.g., 'openssl', 'httpd').
        version: Optional version/ensure filter (exact match).
        limit:   Maximum number of results (default 200).
    """
    try:
        if not name:
            return []

        name = _validate_pql_value(name, "package name")

        # Query Package resources by title (package name) across all nodes.
        # The 'ensure' parameter contains the installed version.
        pql = f'resources {{ type = "Package" and title = "{name}" order by certname limit {limit} }}'

        result = await puppetdb_service._query("", params={"query": pql})
        if not isinstance(result, list):
            return []

        # Transform resource results into a package-friendly format
        packages = []
        for r in result:
            params = r.get("parameters", {})
            packages.append({
                "certname": r.get("certname", ""),
                "package_name": r.get("title", ""),
                "version": params.get("ensure", "present"),
                "provider": params.get("provider", ""),
            })

        # Apply version filter if specified (post-query since 'ensure'
        # is inside the parameters JSON, not a top-level PQL field)
        if version:
            version = _validate_pql_value(version, "version")
            packages = [p for p in packages if version in p["version"]]

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
