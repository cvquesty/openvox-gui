"""
HTTP client utilities with proxy support.

Provides helpers for creating httpx clients that respect the application's
proxy configuration. Use these when making outbound API calls to external
services (not for local services like PuppetDB which use NO_PROXY).
"""
import httpx
from typing import Optional, Dict, Any
from ..config import settings


def get_proxy_url() -> Optional[str]:
    """
    Get the proxy URL from settings.

    Returns the HTTPS proxy if set, otherwise the HTTP proxy, or None.
    httpx 0.28+ uses a single ``proxy`` parameter (not ``proxies``).

    Example:
        async with httpx.AsyncClient(proxy=get_proxy_url()) as client:
            resp = await client.get("https://external-api.com/...")
    """
    return settings.https_proxy or settings.http_proxy or None


def should_bypass_proxy(url: str) -> bool:
    """
    Check if a URL should bypass the proxy based on NO_PROXY settings.

    This is a helper for manual proxy bypass checking. httpx handles this
    automatically for environment variables, but this can be useful for
    custom proxy logic.
    """
    if not settings.no_proxy:
        return False

    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = parsed.hostname or ""

    no_proxy_hosts = [h.strip().lower() for h in settings.no_proxy.split(",")]

    # Check direct match or suffix match (e.g., .example.com)
    host_lower = host.lower()
    for np in no_proxy_hosts:
        if not np:
            continue
        if host_lower == np:
            return True
        if np.startswith(".") and host_lower.endswith(np):
            return True
        if host_lower.endswith("." + np):
            return True

    return False


async def create_external_client(
    timeout: float = 30.0,
    **kwargs: Any
) -> httpx.AsyncClient:
    """
    Create an httpx AsyncClient configured with proxy settings.

    Use this for making requests to external services that may require
    proxy access. For internal services (PuppetDB, PuppetServer), use
    direct connections without proxy.

    Args:
        timeout: Request timeout in seconds (default 30)
        **kwargs: Additional arguments passed to httpx.AsyncClient

    Returns:
        Configured httpx.AsyncClient instance

    Example:
        async with create_external_client() as client:
            resp = await client.get("https://api.example.com/data")
            data = resp.json()
    """
    return httpx.AsyncClient(
        proxy=get_proxy_url(),
        timeout=timeout,
        **kwargs
    )
