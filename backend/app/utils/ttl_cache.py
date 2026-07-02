"""
Simple process-local TTL cache with optional single-flight locking.

Used by expensive read endpoints (dashboard, metrics, performance) so
repeated UI polls and multi-tab usage do not each hammer PuppetDB/JMX.

Notes:
- Per-process only. With uvicorn --workers N, each worker has its own map
  (still effective: each worker amortizes its own load).
- Values should be JSON-serializable plain data (dicts/lists), not ORM
  instances or open connections.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

T = TypeVar("T")

_store: Dict[str, Any] = {}
_ts: Dict[str, float] = {}
_locks: Dict[str, asyncio.Lock] = {}


def get(key: str, ttl: float) -> Optional[Any]:
    """Return cached value if present and younger than *ttl* seconds."""
    if key in _store and (time.time() - _ts.get(key, 0.0)) < ttl:
        return _store[key]
    return None


def set(key: str, value: Any) -> None:
    _store[key] = value
    _ts[key] = time.time()


def invalidate(prefix: str = "") -> int:
    """Drop keys starting with *prefix* (or all if prefix empty). Returns count."""
    keys = [k for k in list(_store.keys()) if not prefix or k.startswith(prefix)]
    for k in keys:
        _store.pop(k, None)
        _ts.pop(k, None)
        _locks.pop(k, None)
    return len(keys)


async def get_or_set(
    key: str,
    ttl: float,
    factory: Callable[[], Awaitable[T]],
) -> T:
    """Return cached value or compute it once (single-flight under lock)."""
    hit = get(key, ttl)
    if hit is not None:
        return hit  # type: ignore[return-value]

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = get(key, ttl)
        if hit is not None:
            return hit  # type: ignore[return-value]
        value = await factory()
        set(key, value)
        return value
