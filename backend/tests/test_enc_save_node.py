"""ENC save_node upserts when certname already exists."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.database import Base, async_session, engine
from app.models.enc import EncEnvironment, EncNode
from app.services.enc import enc_service


async def _reset_schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_save_node_updates_existing_certname():
    await _reset_schema()

    async with async_session() as db:
        db.add(EncEnvironment(name="production", description=""))
        db.add(EncEnvironment(name="feature_refactor_base_linux", description=""))
        await db.flush()
        db.add(
            EncNode(
                certname="connector-xcorp-pdxc.pdxc-it.twitter.biz",
                environment="production",
                classes={},
                parameters={},
            )
        )
        await db.commit()

    async with async_session() as db:
        node = await enc_service.save_node(
            db,
            certname="connector-xcorp-pdxc.pdxc-it.twitter.biz",
            environment="feature_refactor_base_linux",
            classes={"profiles::kea": {}},
            parameters={},
        )
        await db.commit()
        assert node is not None
        assert node.environment == "feature_refactor_base_linux"
        assert "profiles::kea" in (node.classes or {})


@pytest.mark.asyncio
async def test_save_node_recovers_from_unique_violation():
    """If get_node misses, INSERT UniqueViolation must become an update."""
    await _reset_schema()

    cert = "already-there.example.com"
    async with async_session() as db:
        db.add(EncEnvironment(name="production", description=""))
        db.add(EncEnvironment(name="staging", description=""))
        await db.flush()
        db.add(EncNode(certname=cert, environment="production", classes={}, parameters={}))
        await db.commit()

    orig = enc_service.get_node

    async def miss_then_find(db, certname):
        if not getattr(miss_then_find, "called", False):
            miss_then_find.called = True
            return None
        return await orig(db, certname)

    enc_service.get_node = miss_then_find  # type: ignore[method-assign]
    try:
        async with async_session() as db:
            node = await enc_service.save_node(
                db,
                certname=cert,
                environment="staging",
                classes={"profiles::linux": {}},
                parameters={},
            )
            await db.commit()
            assert node is not None
            assert node.environment == "staging"
            assert "profiles::linux" in (node.classes or {})
    except IntegrityError:
        pytest.fail("save_node must not raise IntegrityError on duplicate certname")
    finally:
        enc_service.get_node = orig  # type: ignore[method-assign]
