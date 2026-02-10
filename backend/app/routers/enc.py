"""
ENC API — Hierarchical External Node Classifier.

Hierarchy: Common → Environment → Group → Node
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import yaml
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..services.enc import enc_service

router = APIRouter(prefix="/api/enc", tags=["enc"])


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


# ─── Common (Layer 1) ─────────────────────────────────────

@router.get("/common")
async def get_common(db: AsyncSession = Depends(get_db)):
    common = await enc_service.get_common(db)
    return {
        "classes": common.classes if common else {},
        "parameters": common.parameters if common else {},
    }

@router.put("/common")
async def save_common(data: CommonData, db: AsyncSession = Depends(get_db)):
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
async def create_environment(data: EnvironmentData, db: AsyncSession = Depends(get_db)):
    env = await enc_service.save_environment(db, name=data.name, description=data.description,
                                              classes=data.classes, parameters=data.parameters)
    return {"name": env.name, "description": env.description,
            "classes": env.classes, "parameters": env.parameters}

@router.put("/environments/{name}")
async def update_environment(name: str, data: EnvironmentData, db: AsyncSession = Depends(get_db)):
    env = await enc_service.save_environment(db, name=name, description=data.description,
                                              classes=data.classes, parameters=data.parameters)
    return {"name": env.name, "description": env.description,
            "classes": env.classes, "parameters": env.parameters}

@router.delete("/environments/{name}", status_code=204)
async def delete_environment(name: str, db: AsyncSession = Depends(get_db)):
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
async def create_group(data: GroupData, db: AsyncSession = Depends(get_db)):
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
async def update_group(group_id: int, data: GroupData, db: AsyncSession = Depends(get_db)):
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
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    if not await enc_service.delete_group(db, group_id):
        raise HTTPException(status_code=404, detail="Group not found")


# ─── Nodes (Layer 4) ──────────────────────────────────────

@router.get("/nodes")
async def list_nodes(db: AsyncSession = Depends(get_db)):
    nodes = await enc_service.list_nodes(db)
    return [{"certname": n.certname, "environment": n.environment,
             "classes": n.classes or {}, "parameters": n.parameters or {},
             "groups": [g.name for g in n.groups]}
            for n in nodes]

@router.post("/nodes", status_code=201)
async def create_node(data: NodeData, db: AsyncSession = Depends(get_db)):
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
async def update_node(certname: str, data: NodeData, db: AsyncSession = Depends(get_db)):
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
async def delete_node(certname: str, db: AsyncSession = Depends(get_db)):
    if not await enc_service.delete_node(db, certname):
        raise HTTPException(status_code=404, detail="Node not found")
