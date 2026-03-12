"""
HTTP client utilities with proxy support.

Provides helpers for creating httpx clients that respect the application's
proxy configuration. Use these when making outbound API calls to external
services (not for local services like PuppetDB which use NO_PROXY).
"""
import httpx
from typing import Optional, Dict, Any
from ..config import settings


def get_proxy_config() -> Optional[Dict[str, str]]:
    """
    Get proxy configuration for httpx clients.

    Returns a dict suitable for httpx's `proxies` parameter, or None if
    no proxy is configured. The NO_PROXY setting is handled automatically
    by httpx via the environment variables.

    Example:
        async with httpx.AsyncClient(proxies=get_proxy_config()) as client:
            resp = await client.get("https://external-api.com/...")
    """
    proxies = {}

    if settings.http_proxy:
        proxies["http://"] = settings.http_proxy
    if settings.https_proxy:
        proxies["https://"] = settings.https_proxy

    return proxies if proxies else None


def get_proxy_mounts() -> Dict[str, Optional[httpx.AsyncBaseTransport]]:
    """
    Get proxy mounts for httpx clients with more control.

    Returns a dict suitable for httpx's `mounts` parameter. This provides
    more granular control over which requests use proxies.

    Example:
        async with httpx.AsyncClient(mounts=get_proxy_mounts()) as client:
            resp = await client.get("https://external-api.com/...")
    """
    mounts = {}

    if settings.http_proxy:
        mounts["http://"] = httpx.AsyncHTTPTransport(proxy=settings.http_proxy)
    if settings.https_proxy:
        mounts["https://"] = httpx.AsyncHTTPTransport(proxy=settings.https_proxy)

    return mounts


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
    proxy_config = get_proxy_config()

    return httpx.AsyncClient(
        proxies=proxy_config,
        timeout=timeout,
        **kwargs
    )
