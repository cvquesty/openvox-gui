"""
Pydantic schemas for API request/response models.
"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime


# ─── Dashboard ──────────────────────────────────────────────

class NodeStatusCount(BaseModel):
    changed: int = 0
    unchanged: int = 0
    failed: int = 0
    unreported: int = 0
    noop: int = 0
    total: int = 0


class ReportTrend(BaseModel):
    timestamp: str
    changed: int = 0
    unchanged: int = 0
    failed: int = 0


class DashboardStats(BaseModel):
    node_status: NodeStatusCount
    report_trends: List[ReportTrend] = []
    environments: List[str] = []
    total_resources: int = 0
    avg_run_time: float = 0.0


# ─── Nodes ──────────────────────────────────────────────────

class NodeSummary(BaseModel):
    certname: str
    latest_report_status: Optional[str] = None
    report_timestamp: Optional[str] = None
    catalog_timestamp: Optional[str] = None
    facts_timestamp: Optional[str] = None
    report_environment: Optional[str] = None
    latest_report_noop: Optional[bool] = None
    latest_report_corrective_change: Optional[bool] = None
    deactivated: Optional[str] = None
    expired: Optional[str] = None


class NodeFact(BaseModel):
    name: str
    value: Any


class NodeDetail(BaseModel):
    certname: str
    facts: Dict[str, Any] = {}
    latest_report_status: Optional[str] = None
    report_timestamp: Optional[str] = None
    catalog_timestamp: Optional[str] = None
    report_environment: Optional[str] = None
    classes: List[str] = []
    resources_count: int = 0


# ─── Reports ───────────────────────────────────────────────

class EventSummary(BaseModel):
    successes: int = 0
    failures: int = 0
    noops: int = 0
    skips: int = 0


class ReportSummary(BaseModel):
    hash: str
    certname: str
    status: Optional[str] = None
    environment: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    noop: Optional[bool] = None
    puppet_version: Optional[str] = None
    configuration_version: Optional[str] = None
    corrective_change: Optional[bool] = None


class ReportDetail(BaseModel):
    hash: str
    certname: str
    status: Optional[str] = None
    environment: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    noop: Optional[bool] = None
    puppet_version: Optional[str] = None
    logs: List[Dict[str, Any]] = []
    metrics: Dict[str, Any] = {}
    resource_events: List[Dict[str, Any]] = []


# ─── Environments ──────────────────────────────────────────

class EnvironmentInfo(BaseModel):
    name: str
    modules: List[str] = []
    node_count: int = 0


# ─── ENC ────────────────────────────────────────────────────

class ClassificationRequest(BaseModel):
    certname: str


class ClassificationResponse(BaseModel):
    environment: Optional[str] = "production"
    classes: Dict[str, Any] = {}
    parameters: Dict[str, Any] = {}


class NodeGroupCreate(BaseModel):
    name: str
    description: str = ""
    environment: str = "production"
    parent_group_id: Optional[int] = None
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    rule: Optional[str] = None


class NodeGroupResponse(BaseModel):
    id: int
    name: str
    description: str
    environment: str
    parent_group_id: Optional[int]
    classes: Dict[str, Any]
    parameters: Dict[str, Any]
    rule: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class NodeClassificationCreate(BaseModel):
    certname: str
    environment: str = "production"
    classes: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    group_ids: List[int] = Field(default_factory=list)


class NodeClassificationResponse(BaseModel):
    certname: str
    environment: str
    classes: Dict[str, Any]
    parameters: Dict[str, Any]
    is_pinned: bool
    groups: List[str] = []
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ClassificationRuleCreate(BaseModel):
    name: str
    description: str = ""
    priority: int = 0
    fact_match: Dict[str, Any]
    group_id: int
    enabled: bool = True


class ClassificationRuleResponse(BaseModel):
    id: int
    name: str
    description: str
    priority: int
    fact_match: Dict[str, Any]
    group_id: int
    enabled: bool
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ─── Configuration ─────────────────────────────────────────

class PuppetServerConfig(BaseModel):
    puppet_conf: Dict[str, Any] = {}
    environments: List[str] = []
    ca_enabled: bool = True
    server_version: Optional[str] = None


class PuppetDBConfig(BaseModel):
    jetty_config: Dict[str, str] = {}
    database_config: Dict[str, str] = {}
    node_ttl: Optional[str] = None
    report_ttl: Optional[str] = None
    gc_interval: Optional[str] = None


class AppConfig(BaseModel):
    app_name: str
    puppet_server_host: str
    puppet_server_port: int
    puppetdb_host: str
    puppetdb_port: int
    auth_backend: str
    debug: bool
