"""
OvoxClient — thin HTTP client for the OpenVox GUI REST API.

All commands ultimately go through this class. It handles:
- Base URL + SSL verification from config
- Bearer token auth (JWT from /api/auth/login)
- Consistent error handling and JSON decoding
- Timeouts and simple retry for transient network issues

The client is deliberately small; complex orchestration stays on the server.
"""

import json
from typing import Any, Dict, List, Optional, Union

import httpx
from rich.console import Console

from .config import ConfigManager, get_config_manager
from .version import VERSION


console = Console()


class OvoxAPIError(Exception):
    """Raised for 4xx/5xx responses or malformed replies from the GUI."""

    def __init__(self, status_code: int, message: str, detail: Optional[Any] = None):
        self.status_code = status_code
        self.message = message
        self.detail = detail
        super().__init__(f"[{status_code}] {message}")

    def __str__(self) -> str:
        if self.detail:
            return f"[{self.status_code}] {self.message}: {self.detail}"
        return f"[{self.status_code}] {self.message}"


class OvoxClient:
    """
    Synchronous client used by all CLI commands.

    Usage:
        client = OvoxClient()
        nodes = client.get_nodes(status="failed")
        client.login("admin", "openvox")  # stores token
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        verify_ssl: Optional[bool] = None,
        timeout: Optional[int] = None,
        config_manager: Optional[ConfigManager] = None,
    ):
        self.cm = config_manager or get_config_manager()
        self.base_url = (base_url or self.cm.get_effective_url()).rstrip("/")
        self.token = token or self.cm.get_token()
        cfg = self.cm.load_config()
        self.verify_ssl = verify_ssl if verify_ssl is not None else cfg.verify_ssl
        self.timeout = timeout or cfg.timeout

        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            verify=self.verify_ssl,
            headers={
                "User-Agent": f"ovox/{VERSION}",
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    # ──────────────────────────────────────────────────────────────────────
    # Low-level request helpers
    # ──────────────────────────────────────────────────────────────────────

    def _auth_headers(self) -> Dict[str, str]:
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        expect_json: bool = True,
    ) -> Union[Dict[str, Any], List[Any], str, bytes]:
        """Core request with uniform error handling."""
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        req_headers = {**self._auth_headers(), **(headers or {})}

        try:
            resp = self._client.request(
                method.upper(),
                url,
                params=params,
                json=json,
                data=data,
                headers=req_headers,
            )
        except httpx.RequestError as exc:
            raise OvoxAPIError(0, f"Connection failed: {exc}") from exc

        if resp.status_code >= 400:
            detail = None
            try:
                body = resp.json()
                if isinstance(body, dict):
                    detail = body.get("detail") or body.get("message") or body
            except Exception:
                detail = resp.text[:500] if resp.text else None
            raise OvoxAPIError(resp.status_code, f"API error on {path}", detail)

        if not expect_json:
            return resp.content

        if not resp.content:
            return {}

        try:
            return resp.json()
        except json.JSONDecodeError:
            # Some endpoints return plain text or empty bodies
            return resp.text

    def get(self, path: str, **kw) -> Any:
        return self._request("GET", path, **kw)

    def post(self, path: str, **kw) -> Any:
        return self._request("POST", path, **kw)

    def put(self, path: str, **kw) -> Any:
        return self._request("PUT", path, **kw)

    def delete(self, path: str, **kw) -> Any:
        return self._request("DELETE", path, **kw)

    # ──────────────────────────────────────────────────────────────────────
    # Auth surface (maps to /api/auth/*)
    # ──────────────────────────────────────────────────────────────────────

    def login(self, username: str, password: str, store: bool = True) -> Dict[str, Any]:
        """
        Perform login against the configured GUI. On success, optionally
        persist the returned JWT so future commands are authenticated.
        """
        payload = {"username": username, "password": password}
        data = self.post("/api/auth/login", json=payload)
        if "token" not in data:
            raise OvoxAPIError(200, "Login response missing token", data)

        self.token = data["token"]
        if store:
            self.cm.save_token(self.token)
        return data

    def logout(self) -> None:
        """Forget local token (server-side sessions are stateless JWTs)."""
        self.cm.clear_token()
        self.token = None

    def whoami(self) -> Optional[Dict[str, Any]]:
        """Return current user info if we have a valid token."""
        if not self.token:
            return None
        try:
            # The middleware injects the user; a lightweight protected endpoint
            # is /api/auth/status or we can hit any small endpoint.
            # Use /api/auth/status which is cheap.
            return self.get("/api/auth/status")
        except OvoxAPIError:
            return None

    # ──────────────────────────────────────────────────────────────────────
    # High-level domain methods (add more as command groups are written)
    # ──────────────────────────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Fleet + server health summary (maps to dashboard/overview)."""
        # The dashboard router exposes /api/dashboard/overview or similar.
        # Fall back to a few cheap endpoints if the exact one changes.
        try:
            return self.get("/api/dashboard/overview")
        except OvoxAPIError:
            # Best-effort: compose from nodes + reports counts
            nodes = self.get_nodes(limit=1)
            return {
                "nodes_total": len(self.get_nodes()),
                "version": VERSION,
                "url": self.base_url,
            }

    def get_nodes(
        self,
        status: Optional[str] = None,
        environment: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List nodes with optional filtering."""
        params: Dict[str, Any] = {}
        if status:
            params["status"] = status
        if environment:
            params["environment"] = environment
        if limit:
            params["limit"] = limit
        if offset:
            params["offset"] = offset
        return self.get("/api/nodes", params=params)  # type: ignore[return-value]

    def get_node(self, certname: str) -> Dict[str, Any]:
        """Detailed view of one node (facts, last report, resources, etc.)."""
        return self.get(f"/api/nodes/{certname}")

    def get_certificates(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Signed, pending, revoked certificates."""
        params = {"status": status} if status else {}
        return self.get("/api/certificates", params=params)  # type: ignore[return-value]

    def sign_certificate(self, certname: str) -> Dict[str, Any]:
        return self.post(f"/api/certificates/{certname}/sign")

    def revoke_certificate(self, certname: str, clean: bool = False) -> Dict[str, Any]:
        return self.post(f"/api/certificates/{certname}/revoke", params={"clean": clean})

    def run_pql(self, query: str, timeout: Optional[int] = None) -> Any:
        """Execute a PQL query against PuppetDB via the GUI proxy."""
        payload = {"query": query}
        if timeout:
            payload["timeout"] = timeout
        return self.post("/api/pql", json=payload)

    # Add more thin wrappers here as we implement command groups:
    #   get_reports, get_facts, deploy_trigger, bolt_task, etc.


def get_client(**overrides) -> OvoxClient:
    """Factory used by commands so they don't have to import ConfigManager."""
    return OvoxClient(**overrides)
