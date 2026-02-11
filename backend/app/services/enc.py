"""
Hierarchical External Node Classifier (ENC) service.

Resolution order (lowest → highest priority):
  1. Common (global defaults)
  2. Environment (production, staging, etc.)
  3. Groups (webservers, databases — a node can be in multiple)
  4. Node (per-node overrides)

Deep-merge: class parameters at higher levels override lower,
but classes from lower levels are preserved unless explicitly
overridden.
"""
import logging
from typing import Dict, Any, Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from ..models.enc import EncCommon, EncEnvironment, EncGroup, EncNode

logger = logging.getLogger(__name__)


def deep_merge(base: Dict, override: Dict) -> Dict:
    """Deep-merge two dicts. Override wins for scalar values;
    dicts are merged recursively."""
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class HierarchicalENCService:
    """Service for hierarchical external node classification."""

    # ─── ENC Lookup (the main event) ────────────────────────

    async def classify_node(self, certname: str, db: AsyncSession,
                            node_facts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Resolve final classification for a node by merging all hierarchy layers.
        Returns Puppet ENC-compatible dict: {environment, classes, parameters}
        """
        merged_classes: Dict[str, Any] = {}
        merged_params: Dict[str, Any] = {}
        environment = "production"

        # Layer 1: Common defaults
        common = await self.get_common(db)
        if common:
            merged_classes = deep_merge(merged_classes, common.classes or {})
            merged_params = deep_merge(merged_params, common.parameters or {})

        # Layer 2: Find the node to determine its environment
        node = await self.get_node(db, certname)
        if node:
            environment = node.environment
        
        # Apply environment-level classes/params
        env = await self.get_environment(db, environment)
        if env:
            merged_classes = deep_merge(merged_classes, env.classes or {})
            merged_params = deep_merge(merged_params, env.parameters or {})

        # Layer 3: Groups (ordered by name for deterministic merge)
        if node and node.groups:
            for group in sorted(node.groups, key=lambda g: g.name):
                merged_classes = deep_merge(merged_classes, group.classes or {})
                merged_params = deep_merge(merged_params, group.parameters or {})

        # Layer 4: Node-specific overrides (highest priority)
        if node:
            merged_classes = deep_merge(merged_classes, node.classes or {})
            merged_params = deep_merge(merged_params, node.parameters or {})

        return {
            "environment": environment,
            "classes": merged_classes,
            "parameters": merged_params,
        }

    # ─── Common (Layer 1) ──────────────────────────────────

    async def get_common(self, db: AsyncSession) -> Optional[EncCommon]:
        result = await db.execute(select(EncCommon).where(EncCommon.id == 1))
        return result.scalar_one_or_none()

    async def save_common(self, db: AsyncSession, classes: Dict, parameters: Dict) -> EncCommon:
        common = await self.get_common(db)
        if common:
            common.classes = classes
            common.parameters = parameters
        else:
            common = EncCommon(id=1, classes=classes, parameters=parameters)
            db.add(common)
        await db.flush()
        await db.refresh(common)
        return common

    # ─── Environments (Layer 2) ────────────────────────────

    async def list_environments(self, db: AsyncSession) -> List[EncEnvironment]:
        result = await db.execute(select(EncEnvironment).order_by(EncEnvironment.name))
        return list(result.scalars().all())

    async def get_environment(self, db: AsyncSession, name: str) -> Optional[EncEnvironment]:
        result = await db.execute(select(EncEnvironment).where(EncEnvironment.name == name))
        return result.scalar_one_or_none()

    async def save_environment(self, db: AsyncSession, name: str,
                               description: str = "", classes: Dict = None,
                               parameters: Dict = None) -> EncEnvironment:
        env = await self.get_environment(db, name)
        if env:
            env.description = description
            env.classes = classes or {}
            env.parameters = parameters or {}
        else:
            env = EncEnvironment(name=name, description=description,
                                 classes=classes or {}, parameters=parameters or {})
            db.add(env)
        await db.flush()
        await db.refresh(env)
        return env

    async def delete_environment(self, db: AsyncSession, name: str) -> bool:
        env = await self.get_environment(db, name)
        if not env:
            return False
        await db.delete(env)
        return True

    # ─── Groups (Layer 3) ─────────────────────────────────

    async def list_groups(self, db: AsyncSession) -> List[EncGroup]:
        result = await db.execute(
            select(EncGroup).order_by(EncGroup.environment, EncGroup.name)
        )
        return list(result.scalars().all())

    async def get_group(self, db: AsyncSession, group_id: int) -> Optional[EncGroup]:
        result = await db.execute(select(EncGroup).where(EncGroup.id == group_id))
        return result.scalar_one_or_none()

    async def save_group(self, db: AsyncSession, name: str, environment: str,
                         description: str = "", classes: Dict = None,
                         parameters: Dict = None,
                         group_id: int = None) -> EncGroup:
        if group_id:
            group = await self.get_group(db, group_id)
            if group:
                group.name = name
                group.environment = environment
                group.description = description
                group.classes = classes or {}
                group.parameters = parameters or {}
            else:
                raise ValueError(f"Group {group_id} not found")
        else:
            group = EncGroup(name=name, environment=environment,
                             description=description,
                             classes=classes or {}, parameters=parameters or {})
            db.add(group)
        await db.flush()
        await db.refresh(group)
        return group

    async def delete_group(self, db: AsyncSession, group_id: int) -> bool:
        group = await self.get_group(db, group_id)
        if not group:
            return False
        await db.delete(group)
        return True

    # ─── Nodes (Layer 4) ──────────────────────────────────

    async def list_nodes(self, db: AsyncSession) -> List[EncNode]:
        result = await db.execute(
            select(EncNode)
            .options(selectinload(EncNode.groups))
            .order_by(EncNode.certname)
        )
        return list(result.scalars().all())

    async def get_node(self, db: AsyncSession, certname: str) -> Optional[EncNode]:
        result = await db.execute(
            select(EncNode)
            .options(selectinload(EncNode.groups))
            .where(EncNode.certname == certname)
        )
        return result.scalar_one_or_none()

    async def save_node(self, db: AsyncSession, certname: str, environment: str,
                        classes: Dict = None, parameters: Dict = None,
                        group_ids: List[int] = None) -> EncNode:
        node = await self.get_node(db, certname)
        if node:
            node.environment = environment
            node.classes = classes or {}
            node.parameters = parameters or {}
        else:
            node = EncNode(certname=certname, environment=environment,
                           classes=classes or {}, parameters=parameters or {})
            db.add(node)
            await db.flush()
            # Re-fetch so the groups relationship is loaded for manipulation
            node = await self.get_node(db, certname)

        # Update group memberships
        if group_ids is not None:
            node.groups.clear()
            for gid in group_ids:
                group = await self.get_group(db, gid)
                if group:
                    node.groups.append(group)
        await db.flush()
        # Re-fetch with eagerly-loaded relationships for the response
        return await self.get_node(db, certname)

    async def delete_node(self, db: AsyncSession, certname: str) -> bool:
        node = await self.get_node(db, certname)
        if not node:
            return False
        await db.delete(node)
        return True


# Singleton
enc_service = HierarchicalENCService()
