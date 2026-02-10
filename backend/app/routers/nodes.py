"""
Nodes API - View and manage Puppet nodes from PuppetDB.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from ..services.puppetdb import puppetdb_service
from ..models.schemas import NodeSummary, NodeDetail

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("/", response_model=List[NodeSummary])
async def list_nodes(
    environment: Optional[str] = Query(None, description="Filter by environment"),
    status: Optional[str] = Query(None, description="Filter by status"),
):
    """List all nodes with optional filters."""
    try:
        query = None
        conditions = []
        if environment:
            conditions.append(f'["=", "report_environment", "{environment}"]')
        if status:
            conditions.append(f'["=", "latest_report_status", "{status}"]')
        if conditions:
            if len(conditions) == 1:
                query = conditions[0]
            else:
                query = '["and", ' + ', '.join(conditions) + ']'

        nodes = await puppetdb_service.get_nodes(query=query)
        return [NodeSummary(**node) for node in nodes]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}", response_model=NodeDetail)
async def get_node_detail(certname: str):
    """Get detailed information about a specific node."""
    try:
        node = await puppetdb_service.get_node(certname)
        facts_raw = await puppetdb_service.get_node_facts(certname)
        resources = await puppetdb_service.get_node_resources(certname)

        # Build facts dict
        facts = {}
        for f in facts_raw:
            facts[f["name"]] = f["value"]

        # Extract class resources
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
    """Get all facts for a node."""
    try:
        facts = await puppetdb_service.get_node_facts(certname)
        return facts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}/resources")
async def get_node_resources(certname: str):
    """Get all resources for a node."""
    try:
        resources = await puppetdb_service.get_node_resources(certname)
        return resources
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{certname}/reports")
async def get_node_reports(certname: str, limit: int = 20):
    """Get recent reports for a node."""
    try:
        reports = await puppetdb_service.get_reports(
            query=f'["=", "certname", "{certname}"]',
            limit=limit,
        )
        return reports
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
