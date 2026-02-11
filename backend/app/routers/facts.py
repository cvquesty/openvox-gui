"""
Facts Explorer API — Browse and query PuppetDB facts across the fleet.
"""
from fastapi import APIRouter, HTTPException
from ..services.puppetdb import puppetdb_service

router = APIRouter(prefix="/api/facts", tags=["facts"])


@router.get("/names")
async def get_fact_names():
    """Return all known fact names from PuppetDB."""
    try:
        names = await puppetdb_service.get_fact_names()
        return {"names": names}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")


@router.get("/values/{fact_name:path}")
async def get_fact_values(fact_name: str):
    """Return certname + value for every node that has the given fact."""
    try:
        facts = await puppetdb_service.get_facts(fact_name=fact_name)
        # Each entry has: certname, name, value, environment
        results = [
            {
                "certname": f.get("certname", ""),
                "value": f.get("value"),
                "environment": f.get("environment", ""),
            }
            for f in facts
        ]
        return {"fact_name": fact_name, "count": len(results), "results": results}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")
