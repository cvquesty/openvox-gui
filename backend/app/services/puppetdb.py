"""
PuppetDB API client service.
Communicates with PuppetDB over its HTTPS API using Puppet SSL certs.
"""
import httpx
import ssl
import logging
from typing import Any, Dict, List, Optional
from ..config import settings

logger = logging.getLogger(__name__)


class PuppetDBService:
    """Async client for PuppetDB v4 API."""

    def __init__(self):
        self.base_url = f"https://{settings.puppetdb_host}:{settings.puppetdb_port}"
        self._client: Optional[httpx.AsyncClient] = None

    def _create_ssl_context(self) -> ssl.SSLContext:
        ctx = ssl.create_default_context(cafile=settings.puppet_ssl_ca)
        ctx.load_cert_chain(
            certfile=settings.puppet_ssl_cert,
            keyfile=settings.puppet_ssl_key,
        )
        return ctx

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                verify=self._create_ssl_context(),
                timeout=30.0,
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _query(self, endpoint: str, query: Optional[str] = None,
                     params: Optional[Dict] = None) -> Any:
        """Execute a PuppetDB query."""
        client = await self._get_client()
        url = f"/pdb/query/v4/{endpoint}"
        request_params = params or {}
        if query:
            request_params["query"] = query
        try:
            resp = await client.get(url, params=request_params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"PuppetDB HTTP error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"PuppetDB connection error: {e}")
            raise

    # ─── Nodes ──────────────────────────────────────────────

    async def get_nodes(self, query: Optional[str] = None) -> List[Dict]:
        """Get all nodes from PuppetDB."""
        return await self._query("nodes", query=query)

    async def get_node(self, certname: str) -> Dict:
        """Get a single node by certname."""
        result = await self._query(f"nodes/{certname}")
        return result

    async def get_node_facts(self, certname: str) -> List[Dict]:
        """Get all facts for a node."""
        return await self._query(f"nodes/{certname}/facts")

    async def get_node_resources(self, certname: str) -> List[Dict]:
        """Get all resources for a node."""
        return await self._query(f"nodes/{certname}/resources")

    # ─── Reports ────────────────────────────────────────────

    async def get_reports(self, query: Optional[str] = None,
                          limit: int = 50, offset: int = 0,
                          order_by: str = "receive_time",
                          order_dir: str = "desc") -> List[Dict]:
        """Get reports from PuppetDB."""
        params = {
            "limit": str(limit),
            "offset": str(offset),
            "order_by": f'[{{"field": "{order_by}", "order": "{order_dir}"}}]',
        }
        return await self._query("reports", query=query, params=params)

    async def get_report(self, report_hash: str) -> Dict:
        """Get a single report by hash."""
        results = await self._query(
            "reports",
            query=f'["=", "hash", "{report_hash}"]'
        )
        if results:
            return results[0]
        return {}

    async def get_report_events(self, report_hash: str) -> List[Dict]:
        """Get events for a specific report."""
        return await self._query(
            "events",
            query=f'["=", "report", "{report_hash}"]'
        )

    async def get_report_logs(self, report_hash: str) -> List[Dict]:
        """Get logs for a specific report."""
        return await self._query(
            "reports",
            query=f'["=", "hash", "{report_hash}"]'
        )

    # ─── Facts ──────────────────────────────────────────────

    async def get_facts(self, fact_name: Optional[str] = None,
                        query: Optional[str] = None) -> List[Dict]:
        """Get facts, optionally filtered by name."""
        endpoint = f"facts/{fact_name}" if fact_name else "facts"
        return await self._query(endpoint, query=query)

    async def get_fact_names(self) -> List[str]:
        """Get all known fact names."""
        return await self._query("fact-names")

    # ─── Environments ───────────────────────────────────────

    async def get_environments(self) -> List[Dict]:
        """Get all environments from PuppetDB."""
        return await self._query("environments")

    # ─── Metrics / Dashboard ────────────────────────────────

    async def get_node_status_counts(self) -> Dict[str, int]:
        """Get node status distribution."""
        nodes = await self.get_nodes()
        counts = {"changed": 0, "unchanged": 0, "failed": 0,
                  "unreported": 0, "noop": 0, "total": len(nodes)}
        for node in nodes:
            status = node.get("latest_report_status")
            if node.get("latest_report_noop"):
                counts["noop"] += 1
            elif status in counts:
                counts[status] += 1
            elif status is None:
                counts["unreported"] += 1
            else:
                counts["unchanged"] += 1
        return counts

    async def get_report_trends(self, hours: int = 24) -> List[Dict]:
        """Get report status trends over time."""
        import json
        query = f'[">" , "receive_time", "{{0}} hours ago"]'.format(hours)
        # Use the actual PQL for time-based queries
        reports = await self._query(
            "reports",
            params={
                "limit": "500",
                "order_by": '[{"field": "receive_time", "order": "asc"}]'
            }
        )
        # Bucket by hour
        from collections import defaultdict
        buckets = defaultdict(lambda: {"changed": 0, "unchanged": 0, "failed": 0})
        for report in reports:
            ts = report.get("receive_time", "")[:13]  # YYYY-MM-DDTHH
            status = report.get("status", "unchanged")
            if status in buckets[ts]:
                buckets[ts][status] += 1

        return [
            {"timestamp": k, "changed": v["changed"],
             "unchanged": v["unchanged"], "failed": v["failed"]}
            for k, v in sorted(buckets.items())
        ][-48:]  # Last 48 data points

    async def get_node_status_trends(self) -> List[Dict]:
        """Get node status trends over time (bucketed by hour from reports)."""
        from collections import defaultdict
        reports = await self._query(
            "reports",
            params={
                "limit": "500",
                "order_by": '[{"field": "receive_time", "order": "asc"}]'
            }
        )
        # For each time bucket, count unique nodes per status
        buckets = defaultdict(lambda: {"unchanged": set(), "changed": set(), "failed": set(), "noop": set()})
        for report in reports:
            ts = report.get("receive_time", "")[:13]  # YYYY-MM-DDTHH
            certname = report.get("certname", "")
            status = report.get("status", "unchanged")
            noop = report.get("noop", False)
            if noop:
                buckets[ts]["noop"].add(certname)
            elif status in buckets[ts]:
                buckets[ts][status].add(certname)

        return [
            {
                "timestamp": k,
                "unchanged": len(v["unchanged"]),
                "changed": len(v["changed"]),
                "failed": len(v["failed"]),
                "noop": len(v["noop"]),
            }
            for k, v in sorted(buckets.items())
        ][-48:]

    async def get_aggregate_event_counts(self) -> Dict:
        """Get aggregate event counts."""
        try:
            result = await self._query(
                "aggregate-event-counts",
                params={"summarize_by": "certname"}
            )
            return result
        except Exception:
            return {}

    async def get_server_time(self) -> Optional[str]:
        """Get PuppetDB server time."""
        try:
            result = await self._query("server-time")
            return result.get("server_time")
        except Exception:
            return None


# Singleton
puppetdb_service = PuppetDBService()
