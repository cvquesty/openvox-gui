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
from typing import Dict, Any, Optional, List, Set
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from ..models.enc import EncCommon, EncEnvironment, EncGroup, EncNode
from .enc_merge import deep_merge  # re-exported for callers / tests


def filter_enc_names_to_live(
    enc_names: List[str], live_names: List[str],
) -> List[str]:
    """Keep ENC environment names that still exist on the compilers.

    If discovery returned nothing, leave the ENC list alone (do not
    wipe the UI because compilers were unreachable).
    """
    if not live_names:
        return list(enc_names)
    live = set(live_names)
    return [n for n in enc_names if n in live]

logger = logging.getLogger(__name__)


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
        if await self.environment_in_use(db, name):
            return False
        await db.delete(env)
        return True

    async def environment_in_use(self, db: AsyncSession, name: str) -> bool:
        g = await db.execute(
            select(EncGroup.id).where(EncGroup.environment == name).limit(1)
        )
        if g.scalar_one_or_none() is not None:
            return True
        n = await db.execute(
            select(EncNode.certname).where(EncNode.environment == name).limit(1)
        )
        return n.scalar_one_or_none() is not None

    async def sync_with_live_environments(
        self, db: AsyncSession, live_names: List[str],
    ) -> Dict[str, List[str]]:
        """Create ENC rows for live r10k envs; drop unused pruned ones."""
        created: List[str] = []
        pruned: List[str] = []
        kept_in_use: List[str] = []
        if not live_names:
            return {
                "live": [],
                "created": created,
                "pruned": pruned,
                "kept_in_use": kept_in_use,
            }
        live_set: Set[str] = {str(n) for n in live_names if n}
        existing = {e.name: e for e in await self.list_environments(db)}
        for name in sorted(live_set):
            if name not in existing:
                await self.save_environment(db, name=name)
                created.append(name)
        for name in list(existing):
            if name in live_set:
                continue
            if await self.environment_in_use(db, name):
                kept_in_use.append(name)
                continue
            await db.delete(existing[name])
            pruned.append(name)
        await db.flush()
        return {
            "live": sorted(live_set),
            "created": created,
            "pruned": pruned,
            "kept_in_use": kept_in_use,
        }

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
        """Raw ENC nodes from SQLite (no filtering).

        Most consumers should prefer get_reconciled_classified_nodes()
        (now returns the full persistent set of classified nodes)
        which applies fleet reality checks (no auto-prune).
        Stale nodes form a purge queue for explicit human purge.
        """
        result = await db.execute(
            select(EncNode)
            .options(selectinload(EncNode.groups))
            .order_by(EncNode.certname)
        )
        return list(result.scalars().all())

    async def get_reconciled_classified_nodes(self, db: AsyncSession) -> List[EncNode]:
        """Return all nodes known to the ENC (the persistent classification store).

        Nodes remain classified until explicitly deleted or purged via the
        /purge-stale workflow. A normal `puppet agent -t` run on the OpenVox
        server (or any transient change in the live fleet snapshot) will not
        cause them to be hidden from the ENC views or automatically removed.

        Use get_stale_nodes() + explicit purge for nodes that have left the
        live fleet.
        """
        return await self.list_nodes(db)

    async def get_stale_nodes(self, db: AsyncSession) -> List[str]:
        """Return certnames present in ENC but not on the current live fleet.

        These are candidates for the purge queue. Review and explicitly purge
        (force required for >5). A normal puppet run should not move nodes here
        in a way that auto-hides them from the ENC list.
        """
        from ..services.puppetdb import puppetdb_service

        raw_nodes = await self.list_nodes(db)
        try:
            live = await puppetdb_service.get_live_nodes()
            live_set = {
                str(n.get("certname", "")).strip().lower()
                for n in live
                if n.get("certname")
            }
            stale = [
                node.certname
                for node in raw_nodes
                if node.certname.strip().lower() not in live_set
            ]
            return stale
        except Exception as e:
            logger.warning("Failed to compute stale nodes: %s", e)
            return []

    async def reconcile(self, db: AsyncSession) -> dict:
        """Return a summary of current ENC state vs live fleet (no auto-purge).

        Reports stale nodes for human review. Purging is always explicit.
        A simple puppet run on the server must not trigger automatic removal
        of classifications.
        """
        before = await self.list_nodes(db)
        before_count = len(before)

        reconciled = await self.get_reconciled_classified_nodes(db)
        after_count = len(reconciled)

        stale = await self.get_stale_nodes(db)

        return {
            "before": before_count,
            "after": after_count,
            "stale_to_purge": stale,
            "stale_count": len(stale),
        }

    async def reseed_from_live_fleet(self, db: AsyncSession) -> dict:
        """Add current live fleet nodes to ENC if missing (no destructive prune).

        This is the safe "re-seed" path after a bad prune wiped classifications
        but the fleet is now healthy. It will not delete existing rows.
        """
        from ..services.puppetdb import puppetdb_service

        live = await puppetdb_service.get_live_nodes()
        live_set = {str(n.get("certname", "")).strip() for n in live if n.get("certname")}

        existing = {n.certname for n in await self.list_nodes(db)}
        added = []

        # Use a default environment if none set; operator can fix via UI
        default_env = "production"
        try:
            envs = await db.execute(select(EncEnvironment))
            first_env = envs.scalars().first()
            if first_env:
                default_env = first_env.name
        except Exception:
            pass

        for cn in live_set:
            if cn not in existing:
                node = EncNode(certname=cn, environment=default_env, classes={}, parameters={})
                db.add(node)
                added.append(cn)

        if added:
            await db.commit()
            logger.info("Re-seeded %d nodes from live fleet: %s", len(added), added[:10])

        return {"added": added, "total_live": len(live_set)}

    async def get_stale_nodes(self, db: AsyncSession) -> List[str]:
        """Return certnames present in ENC but not on the current live fleet.

        These are candidates for the purge queue. Review and explicitly purge
        (force required for >5). A normal puppet run should not move nodes here
        in a way that auto-hides them from the ENC list.
        """
        from ..services.puppetdb import puppetdb_service

        raw_nodes = await self.list_nodes(db)
        try:
            live = await puppetdb_service.get_live_nodes()
            live_set = {
                str(n.get("certname", "")).strip().lower()
                for n in live
                if n.get("certname")
            }
            stale = [
                node.certname
                for node in raw_nodes
                if node.certname.strip().lower() not in live_set
            ]
            return stale
        except Exception as e:
            logger.warning("Failed to compute stale nodes: %s", e)
            return []

    async def purge_stale_nodes(self, db: AsyncSession, force: bool = False) -> dict:
        """Explicit purge of the purge queue (stale nodes).

        Guard rail: force=true required if >5 nodes.
        Always snapshots DB first for failback.
        """
        stale = await self.get_stale_nodes(db)
        if not stale:
            return {"purged": 0, "certnames": []}

        if len(stale) > 5 and not force:
            return {
                "purged": 0,
                "would_purge": len(stale),
                "requires_force": True,
                "certnames": stale,
                "message": f"Refusing to purge {len(stale)} nodes without force=True. Review /stale first.",
            }

        # Snapshot before
        try:
            from pathlib import Path
            from datetime import datetime
            import shutil
            from ..config import settings

            backup_root = Path(settings.data_dir) / "backups"
            backup_root.mkdir(parents=True, exist_ok=True)
            ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            db_path = Path(settings.database_url.replace("sqlite+aiosqlite:///", ""))
            if db_path.exists():
                backup_file = backup_root / f"pre-purge-{ts}.db"
                shutil.copy2(db_path, backup_file)
                logger.warning("Pre-purge snapshot saved to %s", backup_file)
        except Exception as be:
            logger.error("Pre-purge snapshot failed: %s", be)

        purged = 0
        for cn in stale:
            if await self.delete_node(db, cn):
                purged += 1
        if purged:
            await db.commit()
            logger.info("Explicit purge of %s nodes: %s", purged, stale[:10])

        return {"purged": purged, "certnames": stale}

    async def purge_stale_nodes(self, db: AsyncSession, force: bool = False) -> dict:
        """Explicitly purge stale nodes (those in ENC but not on live fleet).

        Guard rail: requires force=True if >5 nodes to purge at once.
        Always takes a backup snapshot first.
        This is the only way to actually delete from the purge queue.
        """
        stale = await self.get_stale_nodes(db)
        if not stale:
            return {"purged": 0, "certnames": []}

        if len(stale) > 5 and not force:
            return {
                "purged": 0,
                "would_purge": len(stale),
                "requires_force": True,
                "certnames": stale,
                "message": f"Refusing to purge {len(stale)} nodes without force=True. Review the purge queue and call with force.",
            }

        # Snapshot before purge (failback)
        try:
            from pathlib import Path
            from datetime import datetime
            import shutil
            from ..config import settings

            backup_root = Path(settings.data_dir) / "backups"
            backup_root.mkdir(parents=True, exist_ok=True)
            ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            db_path = Path(settings.database_url.replace("sqlite+aiosqlite:///", ""))
            if db_path.exists():
                backup_file = backup_root / f"pre-purge-{ts}.db"
                shutil.copy2(db_path, backup_file)
                logger.warning("Pre-purge snapshot saved to %s", backup_file)
        except Exception as be:
            logger.error("Failed to snapshot before explicit purge: %s", be)

        purged_count = 0
        for cn in stale:
            if await self.delete_node(db, cn):
                purged_count += 1
        if purged_count:
            await db.commit()
            logger.info("Explicit purge of %s stale node(s): %s", purged_count, stale[:10])

        return {"purged": purged_count, "certnames": stale}

    async def get_node(self, db: AsyncSession, certname: str) -> Optional[EncNode]:
        certname = (certname or "").strip()
        result = await db.execute(
            select(EncNode)
            .options(selectinload(EncNode.groups))
            .where(EncNode.certname == certname)
        )
        return result.scalar_one_or_none()

    async def save_node(self, db: AsyncSession, certname: str, environment: str,
                        classes: Dict = None, parameters: Dict = None,
                        group_ids: List[int] = None) -> EncNode:
        from sqlalchemy.exc import IntegrityError

        certname = (certname or "").strip()
        node = await self.get_node(db, certname)
        if node:
            node.environment = environment
            node.classes = classes or {}
            node.parameters = parameters or {}
        else:
            node = EncNode(certname=certname, environment=environment,
                           classes=classes or {}, parameters=parameters or {})
            db.add(node)
            try:
                await db.flush()
            except IntegrityError:
                # Duplicate certname (UI POST /nodes while the row exists).
                # PostgreSQL aborts the txn; roll back and update the row.
                await db.rollback()
                node = await self.get_node(db, certname)
                if node is None:
                    raise
                node.environment = environment
                node.classes = classes or {}
                node.parameters = parameters or {}
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


async def sync_enc_environments_from_compilers() -> Dict[str, List[str]]:
    """After r10k: ENC environments match compiler codedirs."""
    from .puppetserver import puppetserver_service
    from ..database import async_session

    puppetserver_service.invalidate_environment_cache()
    live = await puppetserver_service.fetch_environments()
    async with async_session() as db:
        result = await enc_service.sync_with_live_environments(db, live or [])
        await db.commit()
        return result
