"""
PQL Console API — Execute PuppetDB Puppet Query Language queries.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..services.puppetdb import puppetdb_service

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
        resp.raise_for_status()
        data = resp.json()
        return {
            "results": data if isinstance(data, list) else [data],
            "count": len(data) if isinstance(data, list) else 1,
            "query": request.query,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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
            {"label": "Fact names", "query": "fact-names {}"},
            {"label": "Nodes unreported >2h", "query": 'nodes { report_timestamp < "2 hours ago" }'},
            {"label": "Resource event failures", "query": 'events { status = "failure" order by timestamp desc limit 20 }'},
            {"label": "Package resources", "query": 'resources { type = "Package" order by title }'},
            {"label": "File resources on a node", "query": 'resources { type = "File" and certname = "NODENAME" }'},
        ]
    }
