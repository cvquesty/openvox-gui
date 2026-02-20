"""
PQL Console API — Execute PuppetDB Puppet Query Language queries.
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..services.puppetdb import puppetdb_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pql", tags=["pql"])


class PQLRequest(BaseModel):
    query: str
    limit: int = 10000


@router.post("/query")
async def execute_pql(request: PQLRequest):
    """Execute a raw PQL query against PuppetDB."""
    try:
        client = await puppetdb_service._get_client()
        params = {"query": request.query, "limit": str(request.limit)}
        resp = await client.get("/pdb/query/v4", params=params)

        if resp.status_code == 400:
            # PuppetDB returned a query error — extract the human-readable message
            puppetdb_error = resp.text.strip()
            if not puppetdb_error:
                puppetdb_error = "Invalid PQL query syntax"
            logger.info(f"PQL query rejected by PuppetDB: {puppetdb_error}")
            raise HTTPException(
                status_code=400,
                detail=f"PuppetDB rejected this query: {puppetdb_error}",
            )

        resp.raise_for_status()
        data = resp.json()
        return {
            "results": data if isinstance(data, list) else [data],
            "count": len(data) if isinstance(data, list) else 1,
            "query": request.query,
        }
    except HTTPException:
        raise  # Re-raise our own HTTPExceptions
    except Exception as e:
        error_msg = str(e)
        # Try to extract a meaningful message from httpx client errors
        if "400" in error_msg or "Bad Request" in error_msg:
            raise HTTPException(
                status_code=400,
                detail="PuppetDB rejected this query. Check the syntax and try again.",
            )
        raise HTTPException(status_code=500, detail=f"Query failed: {error_msg}")


@router.get("/examples")
async def get_pql_examples():
    """Return example PQL queries for the UI."""
    return {
        "examples": [
            {"label": "All nodes", "query": "nodes {}"},
            {"label": "Failed nodes", "query": 'nodes { latest_report_status = "failed" }'},
            {"label": "All facts for a node", "query": 'facts { certname = "NODENAME" }'},
            {"label": "OS distribution across fleet", "query": 'facts { name = "os" }'},
            {"label": "Nodes with specific class", "query": 'resources { type = "Class" and title = "Ntp" }'},
            {"label": "Recent failed reports", "query": 'reports { status = "failed" order by receive_time desc limit 10 }'},
            {"label": "All environments", "query": "environments {}"},
            {"label": "Nodes by oldest report", "query": "nodes { order by report_timestamp limit 10 }"},
            {"label": "Resource event failures", "query": 'events { status = "failure" order by timestamp desc limit 20 }'},
            {"label": "Package resources", "query": 'resources { type = "Package" order by title }'},
            {"label": "File resources on a node", "query": 'resources { type = "File" and certname = "NODENAME" }'},
            {"label": "Nodes with catalog errors", "query": 'nodes { latest_report_status = "failed" order by report_timestamp desc }'},
            {"label": "Service resources", "query": 'resources { type = "Service" order by certname }'},
        ]
    }
