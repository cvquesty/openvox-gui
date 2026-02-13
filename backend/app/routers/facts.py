"""
Facts Explorer API — Browse and query PuppetDB facts across the fleet.
Supports nested fact queries like "os.family" to access structured fact data.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Any, Dict, List
from ..services.puppetdb import puppetdb_service

router = APIRouter(prefix="/api/facts", tags=["facts"])


def get_nested_value(obj: Any, path: str) -> Any:
    """
    Get a nested value from an object using dot notation.
    e.g., get_nested_value({"os": {"family": "RedHat"}}, "os.family") -> "RedHat"
    """
    if not path:
        return obj
    
    keys = path.split('.')
    current = obj
    
    for key in keys:
        if isinstance(current, dict):
            # Try both the key directly and as an integer for array indices
            if key in current:
                current = current[key]
            elif key.isdigit() and isinstance(current, (list, tuple)):
                try:
                    idx = int(key)
                    current = current[idx] if idx < len(current) else None
                except (ValueError, IndexError):
                    return None
            else:
                return None
        elif isinstance(current, (list, tuple)) and key.isdigit():
            try:
                idx = int(key)
                current = current[idx] if idx < len(current) else None
            except (ValueError, IndexError):
                return None
        else:
            return None
    
    return current


@router.get("/names")
async def get_fact_names(include_paths: bool = Query(False, description="Include nested fact paths")):
    """
    Return all known fact names from PuppetDB.
    If include_paths=true, also returns common nested paths for structured facts.
    """
    try:
        names = await puppetdb_service.get_fact_names()
        
        if not include_paths:
            return {"names": names}
        
        # For structured facts, we can add common nested paths
        # These are well-known nested facts in Puppet
        enhanced_names = list(names)
        
        # Add common nested paths for known structured facts
        structured_facts = {
            "os": ["os.family", "os.name", "os.release.full", "os.release.major", "os.release.minor"],
            "memory": ["memory.system.total", "memory.system.used", "memory.system.available", "memory.swap.total"],
            "processors": ["processors.count", "processors.models", "processors.cores", "processors.threads"],
            "networking": ["networking.hostname", "networking.domain", "networking.fqdn", "networking.ip", "networking.ip6"],
            "system_uptime": ["system_uptime.days", "system_uptime.hours", "system_uptime.seconds", "system_uptime.uptime"],
            "disks": ["disks.sda.size", "disks.sda.model"],
            "partitions": ["partitions./dev/sda1.size", "partitions./dev/sda1.filesystem"],
        }
        
        for base_fact in names:
            if base_fact in structured_facts:
                enhanced_names.extend(structured_facts[base_fact])
        
        # Remove duplicates and sort
        enhanced_names = sorted(list(set(enhanced_names)))
        
        return {"names": enhanced_names, "total": len(enhanced_names)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")


@router.get("/values/{fact_path:path}")
async def get_fact_values(fact_path: str):
    """
    Return certname + value for every node that has the given fact.
    Supports nested facts using dot notation (e.g., "os.family").
    """
    try:
        # Split the path to get base fact and nested path
        parts = fact_path.split('.')
        base_fact = parts[0]
        nested_path = '.'.join(parts[1:]) if len(parts) > 1 else None
        
        # Get the base fact from PuppetDB
        facts = await puppetdb_service.get_facts(fact_name=base_fact)
        
        results = []
        for f in facts:
            value = f.get("value")
            
            # If we have a nested path, extract the nested value
            if nested_path:
                value = get_nested_value(value, nested_path)
                # Skip nodes that don't have this nested value
                if value is None:
                    continue
            
            results.append({
                "certname": f.get("certname", ""),
                "value": value,
                "environment": f.get("environment", ""),
            })
        
        return {
            "fact_path": fact_path,
            "base_fact": base_fact,
            "nested_path": nested_path,
            "count": len(results),
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")


@router.get("/structure/{fact_name}")
async def get_fact_structure(fact_name: str, sample_count: int = Query(5, ge=1, le=20)):
    """
    Get the structure of a fact by sampling values from several nodes.
    Useful for understanding what nested paths are available.
    """
    try:
        facts = await puppetdb_service.get_facts(fact_name=fact_name)
        
        if not facts:
            raise HTTPException(status_code=404, detail=f"Fact '{fact_name}' not found")
        
        # Sample up to sample_count different structures
        structures = []
        seen_structures = set()
        
        for f in facts[:sample_count * 3]:  # Check more to find variety
            value = f.get("value")
            if value is None:
                continue
            
            # Create a structure signature to identify unique structures
            structure_sig = str(type(value).__name__)
            if isinstance(value, dict):
                structure_sig += ":" + ",".join(sorted(value.keys()))
            
            if structure_sig not in seen_structures:
                seen_structures.add(structure_sig)
                structures.append({
                    "certname": f.get("certname", ""),
                    "value": value,
                    "type": type(value).__name__
                })
                
                if len(structures) >= sample_count:
                    break
        
        # Analyze common paths if it's a dict
        paths = []
        if structures and isinstance(structures[0]["value"], dict):
            def extract_paths(obj, prefix=""):
                if isinstance(obj, dict):
                    for key, val in obj.items():
                        current_path = f"{prefix}.{key}" if prefix else key
                        paths.append(current_path)
                        if isinstance(val, dict):
                            extract_paths(val, current_path)
            
            extract_paths(structures[0]["value"], fact_name)
        
        return {
            "fact_name": fact_name,
            "sample_count": len(structures),
            "samples": structures,
            "available_paths": sorted(paths) if paths else None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")
