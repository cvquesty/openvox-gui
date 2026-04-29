"""
ENC API — Hierarchical External Node Classifier.

Hierarchy: Common → Environment → Group → Node
"""
import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import yaml

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..services.enc import enc_service
from ..services.puppetdb import puppetdb_service
from ..dependencies import require_role

router = APIRouter(prefix="/api/enc", tags=["enc"])

# All ENC mutating endpoints (3.3.5-26): admin or operator. Operators
# commonly assign nodes to groups / promote nodes to environments;
# admins do everything operators do plus group/environment lifecycle.
_ENC_WRITE = require_role("admin", "operator")


# ─── Pydantic models ───────────────────────────────────────

class CommonData(BaseModel):
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)

class CommonResponse(CommonData):
    updated_at: Optional[str] = None

class EnvironmentData(BaseModel):
    name: str
    description: str = ""
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)

class EnvironmentResponse(EnvironmentData):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class GroupData(BaseModel):
    name: str
    environment: str
    description: str = ""
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)

class GroupResponse(GroupData):
    id: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class NodeData(BaseModel):
    certname: str
    environment: str
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    group_ids: List[int] = Field(default_factory=list)

class NodeResponse(BaseModel):
    certname: str
    environment: str
    classes: Dict[str, Any]
    parameters: Dict[str, Any]
    groups: List[str] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ClassifyResponse(BaseModel):
    environment: str
    classes: Dict[str, Any]
    parameters: Dict[str, Any]

class HierarchyOverview(BaseModel):
    common: Optional[CommonResponse] = None
    environments: List[EnvironmentResponse] = []
    groups: List[GroupResponse] = []
    nodes: List[NodeResponse] = []


# ─── ENC Classify Endpoint (called by Puppet) ──────────────

@router.get("/classify/{certname}", response_model=ClassifyResponse)
async def classify_node(certname: str, db: AsyncSession = Depends(get_db)):
    """Classify a node — primary ENC endpoint. Returns merged classification."""
    result = await enc_service.classify_node(certname, db)
    return ClassifyResponse(**result)

@router.get("/classify/{certname}/yaml", response_class=PlainTextResponse)
async def classify_node_yaml(certname: str, db: AsyncSession = Depends(get_db)):
    """Classify a node — returns YAML for Puppet ENC script."""
    result = await enc_service.classify_node(certname, db)
    return yaml.dump(result, default_flow_style=False)


# ─── Hierarchy Overview ────────────────────────────────────

@router.get("/hierarchy")
async def get_hierarchy(db: AsyncSession = Depends(get_db)):
    """Get the full hierarchy overview for the UI."""
    common = await enc_service.get_common(db)
    envs = await enc_service.list_environments(db)
    groups = await enc_service.list_groups(db)
    nodes = await enc_service.list_nodes(db)

    # Filter ENC nodes against PuppetDB — only include active nodes
    try:
        active = await puppetdb_service.get_nodes()
        active_certnames = {n.get("certname", "").strip().lower() for n in active}
        nodes = [n for n in nodes if n.certname.strip().lower() in active_certnames]
    except Exception as e:
        logger.warning(f"Could not filter hierarchy nodes against PuppetDB: {e}")

    return {
        "common": {
            "classes": common.classes if common else {},
            "parameters": common.parameters if common else {},
            "updated_at": str(common.updated_at) if common and common.updated_at else None,
        },
        "environments": [
            {"name": e.name, "description": e.description,
             "classes": e.classes or {}, "parameters": e.parameters or {},
             "created_at": str(e.created_at) if e.created_at else None,
             "updated_at": str(e.updated_at) if e.updated_at else None}
            for e in envs
        ],
        "groups": [
            {"id": g.id, "name": g.name, "environment": g.environment,
             "description": g.description,
             "classes": g.classes or {}, "parameters": g.parameters or {},
             "created_at": str(g.created_at) if g.created_at else None,
             "updated_at": str(g.updated_at) if g.updated_at else None}
            for g in groups
        ],
        "nodes": [
            {"certname": n.certname, "environment": n.environment,
             "classes": n.classes or {}, "parameters": n.parameters or {},
             "groups": [g.name for g in n.groups],
             "created_at": str(n.created_at) if n.created_at else None,
             "updated_at": str(n.updated_at) if n.updated_at else None}
            for n in nodes
        ],
    }


# ─── Available Classes (from filesystem) ───────────────────

@router.get("/available-classes")
async def get_available_classes(environment: str = "production"):
    """
    Discover available Puppet classes from the environment's modules.
    Returns categorized classes: roles, profiles, and module classes.
    """
    from pathlib import Path
    codedir = Path("/etc/puppetlabs/code/environments") / environment

    def discover_classes(modules_dir: Path) -> list:
        """Walk module manifests to build class names."""
        classes = []
        if not modules_dir.exists():
            return classes
        for module_dir in sorted(modules_dir.iterdir()):
            if not module_dir.is_dir():
                continue
            manifests = module_dir / "manifests"
            if not manifests.exists():
                continue
            module_name = module_dir.name
            for pp_file in sorted(manifests.rglob("*.pp")):
                rel = pp_file.relative_to(manifests)
                parts = list(rel.parts)
                # Remove .pp extension from last part
                parts[-1] = parts[-1].rsplit(".", 1)[0]
                if parts == ["init"]:
                    classes.append(module_name)
                else:
                    classes.append(f"{module_name}::{('::'.join(parts))}")
        return classes

    all_classes = []
    # modules/ directory (r10k deployed)
    all_classes.extend(discover_classes(codedir / "modules"))
    # site-modules/ directory (site-specific)
    all_classes.extend(discover_classes(codedir / "site-modules"))
    # site/ directory (alternative layout)
    all_classes.extend(discover_classes(codedir / "site"))

    # Categorize
    roles = sorted([c for c in all_classes if c.startswith("roles::")])
    profiles = sorted([c for c in all_classes if c.startswith("profiles::")])
    modules = sorted([c for c in all_classes if not c.startswith("roles::") and not c.startswith("profiles::")])

    return {
        "roles": roles,
        "profiles": profiles,
        "modules": modules,
        "all": sorted(set(all_classes)),
    }

# ─── Common (Layer 1) ─────────────────────────────────────

@router.get("/common")
async def get_common(db: AsyncSession = Depends(get_db)):
    common = await enc_service.get_common(db)
    return {
        "classes": common.classes if common else {},
        "parameters": common.parameters if common else {},
    }

@router.put("/common")
async def save_common(data: CommonData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    common = await enc_service.save_common(db, classes=data.classes, parameters=data.parameters)
    return {"classes": common.classes, "parameters": common.parameters}


# ─── Environments (Layer 2) ────────────────────────────────

@router.get("/environments")
async def list_environments(db: AsyncSession = Depends(get_db)):
    envs = await enc_service.list_environments(db)
    return [{"name": e.name, "description": e.description,
             "classes": e.classes or {}, "parameters": e.parameters or {}}
            for e in envs]

@router.post("/environments", status_code=201)
async def create_environment(data: EnvironmentData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    env = await enc_service.save_environment(db, name=data.name, description=data.description,
                                              classes=data.classes, parameters=data.parameters)
    return {"name": env.name, "description": env.description,
            "classes": env.classes, "parameters": env.parameters}

@router.put("/environments/{name}")
async def update_environment(name: str, data: EnvironmentData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    env = await enc_service.save_environment(db, name=name, description=data.description,
                                              classes=data.classes, parameters=data.parameters)
    return {"name": env.name, "description": env.description,
            "classes": env.classes, "parameters": env.parameters}

@router.delete("/environments/{name}", status_code=204)
async def delete_environment(name: str, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    if not await enc_service.delete_environment(db, name):
        raise HTTPException(status_code=404, detail="Environment not found")


# ─── Groups (Layer 3) ─────────────────────────────────────

@router.get("/groups")
async def list_groups(db: AsyncSession = Depends(get_db)):
    groups = await enc_service.list_groups(db)
    return [{"id": g.id, "name": g.name, "environment": g.environment,
             "description": g.description,
             "classes": g.classes or {}, "parameters": g.parameters or {}}
            for g in groups]

@router.post("/groups", status_code=201)
async def create_group(data: GroupData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    try:
        group = await enc_service.save_group(db, name=data.name,
                                              environment=data.environment,
                                              description=data.description,
                                              classes=data.classes,
                                              parameters=data.parameters)
        return {"id": group.id, "name": group.name, "environment": group.environment,
                "description": group.description,
                "classes": group.classes, "parameters": group.parameters}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/groups/{group_id}")
async def update_group(group_id: int, data: GroupData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    try:
        group = await enc_service.save_group(db, name=data.name,
                                              environment=data.environment,
                                              description=data.description,
                                              classes=data.classes,
                                              parameters=data.parameters,
                                              group_id=group_id)
        return {"id": group.id, "name": group.name, "environment": group.environment,
                "description": group.description,
                "classes": group.classes, "parameters": group.parameters}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    if not await enc_service.delete_group(db, group_id):
        raise HTTPException(status_code=404, detail="Group not found")


# ─── Nodes (Layer 4) ──────────────────────────────────────

@router.get("/nodes")
async def list_nodes(db: AsyncSession = Depends(get_db)):
    nodes = await enc_service.list_nodes(db)

    # Filter against PuppetDB — only return nodes that actually exist
    try:
        active = await puppetdb_service.get_nodes()
        active_certnames = {n.get("certname", "").strip().lower() for n in active}
        nodes = [n for n in nodes if n.certname.strip().lower() in active_certnames]
    except Exception as e:
        logger.warning(f"Could not filter ENC nodes against PuppetDB: {e}")

    return [{"certname": n.certname, "environment": n.environment,
             "classes": n.classes or {}, "parameters": n.parameters or {},
             "groups": [g.name for g in n.groups]}
            for n in nodes]

async def _validate_certname_in_puppetdb(certname: str):
    """Reject certnames that don't exist as active nodes in PuppetDB.

    PuppetDB is the single source of truth for node existence. The ENC
    only stores classification metadata — it must not create entries
    for nodes that Puppet doesn't know about.
    """
    try:
        active_nodes = await puppetdb_service.get_nodes()
        active_certnames = {n.get("certname", "").strip().lower() for n in active_nodes}
        if certname.strip().lower() not in active_certnames:
            raise HTTPException(
                status_code=400,
                detail=f"Node '{certname}' does not exist in PuppetDB. "
                       f"Only active PuppetDB nodes can be classified.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Could not validate certname against PuppetDB: {e}")


@router.post("/nodes", status_code=201)
async def create_node(data: NodeData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    await _validate_certname_in_puppetdb(data.certname)
    try:
        node = await enc_service.save_node(db, certname=data.certname,
                                            environment=data.environment,
                                            classes=data.classes,
                                            parameters=data.parameters,
                                            group_ids=data.group_ids)
        return {"certname": node.certname, "environment": node.environment,
                "classes": node.classes, "parameters": node.parameters,
                "groups": [g.name for g in node.groups]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/nodes/{certname}")
async def update_node(certname: str, data: NodeData, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    await _validate_certname_in_puppetdb(certname)
    try:
        node = await enc_service.save_node(db, certname=certname,
                                            environment=data.environment,
                                            classes=data.classes,
                                            parameters=data.parameters,
                                            group_ids=data.group_ids)
        return {"certname": node.certname, "environment": node.environment,
                "classes": node.classes, "parameters": node.parameters,
                "groups": [g.name for g in node.groups]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/nodes/{certname}", status_code=204)
async def delete_node(certname: str, db: AsyncSession = Depends(get_db), _user: str = Depends(_ENC_WRITE)):
    if not await enc_service.delete_node(db, certname):
        raise HTTPException(status_code=404, detail="Node not found")


# ─── Bolt Inventory Generation (3.x feature) ─────────────

@router.get("/inventory/bolt")
async def get_bolt_inventory(db: AsyncSession = Depends(get_db)):
    """
    Generate a Bolt-compatible inventory from the ENC hierarchy.

    Returns a version 2 Bolt inventory structure where:
    - Each ENC group becomes a Bolt group with its member nodes as targets
    - Ungrouped classified nodes go into an 'ungrouped' group
    - PuppetDB plugin config is included for dynamic node discovery

    This endpoint powers the Orchestration page's group-based target
    selection and can also be written to disk as inventory.yaml.
    """
    from ..config import settings

    groups = await enc_service.list_groups(db)
    nodes = await enc_service.list_nodes(db)

    # Build group → members mapping from node memberships
    group_members: dict = {}
    ungrouped = []

    for node in nodes:
        node_groups = [g.name for g in node.groups]
        if not node_groups:
            ungrouped.append(node.certname)
        for gname in node_groups:
            group_members.setdefault(gname, []).append(node.certname)

    # Build Bolt inventory groups
    bolt_groups = []
    for group in groups:
        bolt_group = {
            "name": group.name,
            "targets": group_members.get(group.name, []),
            "config": {
                "transport": "ssh",
                "ssh": {"host-key-check": False},
            },
        }
        if group.description:
            bolt_group["description"] = group.description
        bolt_groups.append(bolt_group)

    # Add ungrouped nodes
    if ungrouped:
        bolt_groups.append({
            "name": "ungrouped",
            "targets": ungrouped,
            "config": {
                "transport": "ssh",
                "ssh": {"host-key-check": False},
            },
        })

    # Add a PuppetDB-backed dynamic group for auto-discovery
    bolt_groups.append({
        "name": "puppetdb-all",
        "description": "All nodes known to PuppetDB (auto-discovered)",
        "targets": [{
            "_plugin": "puppetdb",
            "query": "inventory[certname] {}",
            "target_mapping": {
                "name": "certname",
                "config": {
                    "ssh": {
                        "host": "facts.networking.fqdn",
                    },
                },
            },
        }],
    })

    inventory = {
        "version": 2,
        "config": {
            "transport": "ssh",
            "ssh": {"host-key-check": False},
            "puppetdb": {
                "server_urls": [f"https://{settings.puppetdb_host}:{settings.puppetdb_port}"],
                "cacert": settings.puppet_ssl_ca,
                "cert": settings.puppet_ssl_cert,
                "key": settings.puppet_ssl_key,
            },
        },
        "groups": bolt_groups,
    }

    return inventory


@router.get("/inventory/bolt/yaml", response_class=PlainTextResponse)
async def get_bolt_inventory_yaml(db: AsyncSession = Depends(get_db)):
    """Return the Bolt inventory as deployable YAML."""
    inventory = await get_bolt_inventory(db)
    return yaml.dump(inventory, default_flow_style=False, sort_keys=False)
