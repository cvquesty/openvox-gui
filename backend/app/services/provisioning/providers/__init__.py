"""Provider registry. Add a provider by registering it here (bare metal: issue #173)."""
from __future__ import annotations

from typing import Dict, List

from .base import Provider, ProviderError
from .vmware import VmwareProvider

PROVIDERS: Dict[str, Provider] = {
    "vmware": VmwareProvider(),
}


def get_provider(kind: str) -> Provider:
    provider = PROVIDERS.get((kind or "").strip().lower())
    if provider is None:
        raise ProviderError(f"Unknown provider {kind!r}. Available: {', '.join(sorted(PROVIDERS))}")
    return provider


def provider_catalog() -> List[Dict[str, str]]:
    return [{"kind": p.kind, "label": p.label} for p in PROVIDERS.values()]
