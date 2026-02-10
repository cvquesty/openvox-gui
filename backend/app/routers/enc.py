"""
ENC API - External Node Classifier management.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from typing import List
import yaml
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..services.enc import enc_service
from ..services.puppetdb import puppetdb_service
from ..models.schemas import (
    ClassificationResponse, NodeGroupCreate, NodeGroupResponse,
    NodeClassificationCreate, NodeClassificationResponse,
    ClassificationRuleCreate, ClassificationRuleResponse,
)

router = APIRouter(prefix="/api/enc", tags=["enc"])


# ─── ENC Endpoint (called by Puppet) ───────────────────────

@router.get("/classify/{certname}", response_model=ClassificationResponse)
async def classify_node(certname: str, db: AsyncSession = Depends(get_db)):
    """
    Classify a node - primary ENC endpoint.
    Returns JSON classification data.
    """
    try:
        # Fetch facts from PuppetDB for rule matching
        facts_raw = await puppetdb_service.get_node_facts(certname)
        facts = {f["name"]: f["value"] for f in facts_raw}
    except Exception:
        facts = None

    result = await enc_service.classify_node(certname, db, node_facts=facts)
    return ClassificationResponse(**result)


@router.get("/classify/{certname}/yaml", response_class=PlainTextResponse)
async def classify_node_yaml(certname: str, db: AsyncSession = Depends(get_db)):
    """
    Classify a node - returns YAML format for Puppet ENC script.
    """
    try:
        facts_raw = await puppetdb_service.get_node_facts(certname)
        facts = {f["name"]: f["value"] for f in facts_raw}
    except Exception:
        facts = None

    result = await enc_service.classify_node(certname, db, node_facts=facts)
    return yaml.dump(result, default_flow_style=False)


# ─── Node Groups ───────────────────────────────────────────

@router.get("/groups", response_model=List[NodeGroupResponse])
async def list_groups(db: AsyncSession = Depends(get_db)):
    """List all node groups."""
    groups = await enc_service.get_groups(db)
    return [NodeGroupResponse.model_validate(g) for g in groups]


@router.post("/groups", response_model=NodeGroupResponse, status_code=201)
async def create_group(data: NodeGroupCreate, db: AsyncSession = Depends(get_db)):
    """Create a new node group."""
    try:
        group = await enc_service.create_group(
            db, name=data.name, description=data.description,
            environment=data.environment, classes=data.classes,
            parameters=data.parameters, parent_group_id=data.parent_group_id,
            rule=data.rule
        )
        return NodeGroupResponse.model_validate(group)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/groups/{group_id}", response_model=NodeGroupResponse)
async def get_group(group_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific node group."""
    group = await enc_service.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return NodeGroupResponse.model_validate(group)


@router.put("/groups/{group_id}", response_model=NodeGroupResponse)
async def update_group(group_id: int, data: NodeGroupCreate,
                       db: AsyncSession = Depends(get_db)):
    """Update a node group."""
    group = await enc_service.update_group(
        db, group_id, name=data.name, description=data.description,
        environment=data.environment, classes=data.classes,
        parameters=data.parameters, rule=data.rule
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return NodeGroupResponse.model_validate(group)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a node group."""
    deleted = await enc_service.delete_group(db, group_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Group not found")


# ─── Node Classifications ──────────────────────────────────

@router.get("/classifications", response_model=List[NodeClassificationResponse])
async def list_classifications(db: AsyncSession = Depends(get_db)):
    """List all node classifications."""
    classifications = await enc_service.get_classifications(db)
    result = []
    for c in classifications:
        resp = NodeClassificationResponse(
            certname=c.certname, environment=c.environment,
            classes=c.classes or {}, parameters=c.parameters or {},
            is_pinned=c.is_pinned,
            groups=[g.name for g in c.groups],
            created_at=c.created_at, updated_at=c.updated_at,
        )
        result.append(resp)
    return result


@router.post("/classifications", response_model=NodeClassificationResponse, status_code=201)
async def create_classification(data: NodeClassificationCreate,
                                 db: AsyncSession = Depends(get_db)):
    """Create a node classification."""
    try:
        node_class = await enc_service.create_classification(
            db, certname=data.certname, environment=data.environment,
            classes=data.classes, parameters=data.parameters,
            group_ids=data.group_ids
        )
        return NodeClassificationResponse(
            certname=node_class.certname, environment=node_class.environment,
            classes=node_class.classes or {}, parameters=node_class.parameters or {},
            is_pinned=node_class.is_pinned,
            groups=[g.name for g in node_class.groups],
            created_at=node_class.created_at, updated_at=node_class.updated_at,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/classifications/{certname}", response_model=NodeClassificationResponse)
async def get_classification(certname: str, db: AsyncSession = Depends(get_db)):
    """Get classification for a specific node."""
    node_class = await enc_service.get_classification(db, certname)
    if not node_class:
        raise HTTPException(status_code=404, detail="Classification not found")
    return NodeClassificationResponse(
        certname=node_class.certname, environment=node_class.environment,
        classes=node_class.classes or {}, parameters=node_class.parameters or {},
        is_pinned=node_class.is_pinned,
        groups=[g.name for g in node_class.groups],
        created_at=node_class.created_at, updated_at=node_class.updated_at,
    )


@router.delete("/classifications/{certname}", status_code=204)
async def delete_classification(certname: str, db: AsyncSession = Depends(get_db)):
    """Delete a node classification."""
    deleted = await enc_service.delete_classification(db, certname)
    if not deleted:
        raise HTTPException(status_code=404, detail="Classification not found")


# ─── Classification Rules ──────────────────────────────────

@router.get("/rules", response_model=List[ClassificationRuleResponse])
async def list_rules(db: AsyncSession = Depends(get_db)):
    """List all classification rules."""
    rules = await enc_service.get_rules(db)
    return [ClassificationRuleResponse.model_validate(r) for r in rules]


@router.post("/rules", response_model=ClassificationRuleResponse, status_code=201)
async def create_rule(data: ClassificationRuleCreate, db: AsyncSession = Depends(get_db)):
    """Create a classification rule."""
    try:
        rule = await enc_service.create_rule(
            db, name=data.name, fact_match=data.fact_match,
            group_id=data.group_id, description=data.description,
            priority=data.priority, enabled=data.enabled
        )
        return ClassificationRuleResponse.model_validate(rule)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a classification rule."""
    deleted = await enc_service.delete_rule(db, rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Rule not found")
