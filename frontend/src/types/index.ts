// ─── Dashboard ──────────────────────────────────────────────

export interface NodeStatusCount {
  changed: number;
  unchanged: number;
  failed: number;
  unreported: number;
  noop: number;
  total: number;
}

export interface ReportTrend {
  timestamp: string;
  changed: number;
  unchanged: number;
  failed: number;
}

export interface DashboardStats {
  node_status: NodeStatusCount;
  report_trends: ReportTrend[];
  environments: string[];
  total_resources: number;
  avg_run_time: number;
}

export interface ServiceStatus {
  service: string;
  status: string;
  pid?: string;
  since?: string;
  memory?: string;
  error?: string;
}

// ─── Nodes ──────────────────────────────────────────────────

export interface NodeSummary {
  certname: string;
  latest_report_status: string | null;
  report_timestamp: string | null;
  catalog_timestamp: string | null;
  facts_timestamp: string | null;
  report_environment: string | null;
  latest_report_noop: boolean | null;
  latest_report_corrective_change: boolean | null;
  deactivated: string | null;
  expired: string | null;
}

export interface NodeDetail {
  certname: string;
  facts: Record<string, any>;
  latest_report_status: string | null;
  report_timestamp: string | null;
  catalog_timestamp: string | null;
  report_environment: string | null;
  classes: string[];
  resources_count: number;
}

// ─── Reports ────────────────────────────────────────────────

export interface ReportSummary {
  hash: string;
  certname: string;
  status: string | null;
  environment: string | null;
  start_time: string | null;
  end_time: string | null;
  noop: boolean | null;
  puppet_version: string | null;
  configuration_version: string | null;
  corrective_change: boolean | null;
}

// ─── ENC ────────────────────────────────────────────────────

export interface NodeGroup {
  id: number;
  name: string;
  description: string;
  environment: string;
  parent_group_id: number | null;
  classes: Record<string, any>;
  parameters: Record<string, any>;
  rule: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NodeClassification {
  certname: string;
  environment: string;
  classes: Record<string, any>;
  parameters: Record<string, any>;
  is_pinned: boolean;
  groups: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface ClassificationRule {
  id: number;
  name: string;
  description: string;
  priority: number;
  fact_match: Record<string, any>;
  group_id: number;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}
