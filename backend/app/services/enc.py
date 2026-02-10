"""
External Node Classifier (ENC) service.
Resolves node classification by merging group memberships, rules, and
per-node overrides into a single Puppet-compatible classification.
"""
import logging
import json
from typing import Dict, Any, Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from ..models.enc import NodeClassification, NodeGroup, ClassificationRule

logger = logging.getLogger(__name__)


class ENCService:
    """Service for external node classification."""

    async def classify_node(self, certname: str, db: AsyncSession,
                            node_facts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Classify a node for Puppet ENC.
        
        Resolution order:
        1. Explicit per-node classification
        2. Group memberships (manual)
        3. Rule-based group matches (using facts)
        4. Merge all classes and parameters
        
        Returns a dict suitable for Puppet ENC YAML output:
        {
            "environment": "production",
            "classes": {"class1": {"param": "value"}, ...},
            "parameters": {"key": "value", ...}
        }
        """
        environment = "production"
        merged_classes: Dict[str, Any] = {}
        merged_params: Dict[str, Any] = {}

        # 1. Check rule-based classifications (if facts provided)
        if node_facts:
            rules = await self._get_matching_rules(db, node_facts)
            for rule in rules:
                group = rule.group
                if group:
                    merged_classes.update(group.classes or {})
                    merged_params.update(group.parameters or {})
                    environment = group.environment or environment

        # 2. Check group memberships
        node_record = await db.execute(
            select(NodeClassification)
            .options(selectinload(NodeClassification.groups))
            .where(NodeClassification.certname == certname)
        )
        node_class = node_record.scalar_one_or_none()

        if node_class:
            # Apply group classes/params
            for group in node_class.groups:
                merged_classes.update(group.classes or {})
                merged_params.update(group.parameters or {})

            # 3. Per-node overrides (highest priority)
            merged_classes.update(node_class.classes or {})
            merged_params.update(node_class.parameters or {})
            environment = node_class.environment or environment

        return {
            "environment": environment,
            "classes": merged_classes,
            "parameters": merged_params,
        }

    async def _get_matching_rules(self, db: AsyncSession,
                                   facts: Dict[str, Any]) -> List[ClassificationRule]:
        """Find all rules that match the given facts."""
        result = await db.execute(
            select(ClassificationRule)
            .options(selectinload(ClassificationRule.group))
            .where(ClassificationRule.enabled == True)
            .order_by(ClassificationRule.priority.desc())
        )
        rules = result.scalars().all()

        matching = []
        for rule in rules:
            if self._facts_match(facts, rule.fact_match):
                matching.append(rule)
        return matching

    def _facts_match(self, facts: Dict[str, Any],
                      match_criteria: Dict[str, Any]) -> bool:
        """
        Check if node facts match the rule criteria.
        Supports dot-notation for nested facts (e.g. "os.family").
        All criteria must match (AND logic).
        """
        for fact_path, expected_value in match_criteria.items():
            actual = self._resolve_fact_path(facts, fact_path)
            if actual is None:
                return False
            if isinstance(expected_value, list):
                if actual not in expected_value:
                    return False
            elif str(actual) != str(expected_value):
                return False
        return True

    def _resolve_fact_path(self, facts: Dict, path: str) -> Any:
        """Resolve a dot-notation fact path."""
        parts = path.split('.')
        current = facts
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
            if current is None:
                return None
        return current

    # ─── CRUD: Node Groups ──────────────────────────────────

    async def create_group(self, db: AsyncSession, name: str,
                           description: str = "", environment: str = "production",
                           classes: Dict = None, parameters: Dict = None,
                           parent_group_id: int = None,
                           rule: str = None) -> NodeGroup:
        group = NodeGroup(
            name=name, description=description, environment=environment,
            classes=classes or {}, parameters=parameters or {},
            parent_group_id=parent_group_id, rule=rule
        )
        db.add(group)
        await db.flush()
        await db.refresh(group)
        return group

    async def get_groups(self, db: AsyncSession) -> List[NodeGroup]:
        result = await db.execute(select(NodeGroup))
        return result.scalars().all()

    async def get_group(self, db: AsyncSession, group_id: int) -> Optional[NodeGroup]:
        result = await db.execute(
            select(NodeGroup).where(NodeGroup.id == group_id)
        )
        return result.scalar_one_or_none()

    async def update_group(self, db: AsyncSession, group_id: int,
                           **kwargs) -> Optional[NodeGroup]:
        group = await self.get_group(db, group_id)
        if not group:
            return None
        for key, value in kwargs.items():
            if hasattr(group, key) and value is not None:
                setattr(group, key, value)
        await db.flush()
        await db.refresh(group)
        return group

    async def delete_group(self, db: AsyncSession, group_id: int) -> bool:
        group = await self.get_group(db, group_id)
        if not group:
            return False
        await db.delete(group)
        return True

    # ─── CRUD: Node Classifications ─────────────────────────

    async def create_classification(self, db: AsyncSession, certname: str,
                                     environment: str = "production",
                                     classes: Dict = None, parameters: Dict = None,
                                     group_ids: List[int] = None) -> NodeClassification:
        node_class = NodeClassification(
            certname=certname, environment=environment,
            classes=classes or {}, parameters=parameters or {},
            is_pinned=True
        )
        if group_ids:
            for gid in group_ids:
                group = await self.get_group(db, gid)
                if group:
                    node_class.groups.append(group)
        db.add(node_class)
        await db.flush()
        await db.refresh(node_class)
        return node_class

    async def get_classifications(self, db: AsyncSession) -> List[NodeClassification]:
        result = await db.execute(
            select(NodeClassification)
            .options(selectinload(NodeClassification.groups))
        )
        return result.scalars().all()

    async def get_classification(self, db: AsyncSession,
                                  certname: str) -> Optional[NodeClassification]:
        result = await db.execute(
            select(NodeClassification)
            .options(selectinload(NodeClassification.groups))
            .where(NodeClassification.certname == certname)
        )
        return result.scalar_one_or_none()

    async def update_classification(self, db: AsyncSession, certname: str,
                                     **kwargs) -> Optional[NodeClassification]:
        node_class = await self.get_classification(db, certname)
        if not node_class:
            return None
        group_ids = kwargs.pop("group_ids", None)
        for key, value in kwargs.items():
            if hasattr(node_class, key) and value is not None:
                setattr(node_class, key, value)
        if group_ids is not None:
            node_class.groups.clear()
            for gid in group_ids:
                group = await self.get_group(db, gid)
                if group:
                    node_class.groups.append(group)
        await db.flush()
        await db.refresh(node_class)
        return node_class

    async def delete_classification(self, db: AsyncSession, certname: str) -> bool:
        node_class = await self.get_classification(db, certname)
        if not node_class:
            return False
        await db.delete(node_class)
        return True

    # ─── CRUD: Classification Rules ─────────────────────────

    async def create_rule(self, db: AsyncSession, name: str,
                          fact_match: Dict, group_id: int,
                          description: str = "", priority: int = 0,
                          enabled: bool = True) -> ClassificationRule:
        rule = ClassificationRule(
            name=name, description=description, priority=priority,
            fact_match=fact_match, group_id=group_id, enabled=enabled
        )
        db.add(rule)
        await db.flush()
        await db.refresh(rule)
        return rule

    async def get_rules(self, db: AsyncSession) -> List[ClassificationRule]:
        result = await db.execute(
            select(ClassificationRule)
            .options(selectinload(ClassificationRule.group))
            .order_by(ClassificationRule.priority.desc())
        )
        return result.scalars().all()

    async def get_rule(self, db: AsyncSession, rule_id: int) -> Optional[ClassificationRule]:
        result = await db.execute(
            select(ClassificationRule).where(ClassificationRule.id == rule_id)
        )
        return result.scalar_one_or_none()

    async def delete_rule(self, db: AsyncSession, rule_id: int) -> bool:
        rule = await self.get_rule(db, rule_id)
        if not rule:
            return False
        await db.delete(rule)
        return True


# Singleton
enc_service = ENCService()
