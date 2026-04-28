/**
 * Centralised API client for the OpenVox GUI backend.
 *
 * Every backend call in the frontend goes through this module. It provides
 * a thin wrapper around the browser's fetch() API that handles:
 *
 *   1. Automatic injection of the JWT bearer token from localStorage into
 *      every request's Authorization header.
 *   2. Automatic session expiry detection — if the backend responds with
 *      HTTP 401, the stored token is cleared and the page is reloaded so
 *      the user sees the login screen.
 *   3. Consistent error handling — non-2xx responses are converted into
 *      thrown Error objects with the status code and response body.
 *   4. Transparent handling of HTTP 204 No Content responses (returned by
 *      DELETE endpoints), which have no response body to parse as JSON.
 *
 * The module is organised into namespaced objects (dashboard, nodes,
 * reports, etc.) that mirror the backend's router structure, making it
 * easy to find the client function for any given API endpoint.
 */
const API_BASE = '/api';

/**
 * Build the standard headers object for an authenticated API request.
 * Includes Content-Type: application/json and, if the user is logged in,
 * the Bearer token read from localStorage.
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('openvox_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Core fetch wrapper used by every API function in this module.
 *
 * Prepends the API_BASE path, injects auth headers, and handles error
 * responses uniformly. If the backend returns 401 (token expired or
 * invalid), the token is cleared from localStorage and the page is
 * force-reloaded so the login screen appears — this is the simplest
 * way to handle session expiry without introducing a complex token
 * refresh flow.
 */
async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: getAuthHeaders(),
    ...options,
  });
  if (response.status === 401) {
    // Token has expired or been revoked. Clear local state and reload
    // the page so the user is presented with the login form.
    localStorage.removeItem('openvox_token');
    window.location.reload();
    throw new Error('Session expired. Please log in again.');
  }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }
  // HTTP 204 No Content has no response body — return an empty object
  // rather than trying to parse undefined JSON.
  if (response.status === 204) return {} as T;
  return response.json();
}

// ─── Dashboard ──────────────────────────────────────────────

export const dashboard = {
  getStats: () => fetchJSON<any>('/dashboard/stats'),
  getNodeStatus: () => fetchJSON<any>('/dashboard/node-status'),
  getReportTrends: () => fetchJSON<any[]>('/dashboard/report-trends'),
  getNodeStatusTrends: () => fetchJSON<any[]>('/dashboard/node-status-trends'),
  getServices: () => fetchJSON<any[]>('/dashboard/services'),
  getActiveSessions: () => fetchJSON<any>('/dashboard/active-sessions'),
};

// ─── Nodes ──────────────────────────────────────────────────

export const nodes = {
  list: (params?: { environment?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.environment) qs.set('environment', params.environment);
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return fetchJSON<any[]>(`/nodes/${query ? '?' + query : ''}`);
  },
  get: (certname: string) => fetchJSON<any>(`/nodes/${certname}`),
  getFacts: (certname: string) => fetchJSON<any[]>(`/nodes/${certname}/facts`),
  searchPackages: (name?: string, version?: string) => {
    const qs = new URLSearchParams();
    if (name) qs.set('name', name);
    if (version) qs.set('version', version);
    const query = qs.toString();
    return fetchJSON<any[]>(`/nodes/packages${query ? '?' + query : ''}`);
  },
  getResources: (certname: string) => fetchJSON<any[]>(`/nodes/${certname}/resources`),
  getReports: (certname: string, limit = 20) =>
    fetchJSON<any[]>(`/nodes/${certname}/reports?limit=${limit}`),
};

// ─── Reports ────────────────────────────────────────────────

export const reports = {
  list: (params?: { certname?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.certname) qs.set('certname', params.certname);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', params.limit.toString());
    const query = qs.toString();
    return fetchJSON<any[]>(`/reports/${query ? '?' + query : ''}`);
  },
  get: (hash: string) => fetchJSON<any>(`/reports/${hash}`),
};

// ─── Deployment ─────────────────────────────────────────────

export const deploy = {
  getEnvironments: () => fetchJSON<any>('/deploy/environments'),
  getRepos: () => fetchJSON<any>('/deploy/repos'),
  getStatus: () => fetchJSON<any>('/deploy/status'),
  getHistory: () => fetchJSON<any>('/deploy/history'),
  run: (environment?: string) =>
    fetchJSON<any>('/deploy/run', {
      method: 'POST',
      body: JSON.stringify({ environment: environment || null }),
    }),
};

// ─── ENC ────────────────────────────────────────────────────

export const enc = {
  // Available classes from OpenVox modules
  getAvailableClasses: (env?: string) =>
    fetchJSON<any>(`/enc/available-classes${env ? '?environment=' + env : ''}`),

  // Hierarchy overview
  getHierarchy: () => fetchJSON<any>('/enc/hierarchy'),

  // Common (Layer 1)
  getCommon: () => fetchJSON<any>('/enc/common'),
  saveCommon: (data: { classes: any; parameters: any }) =>
    fetchJSON<any>('/enc/common', { method: 'PUT', body: JSON.stringify(data) }),

  // Environments (Layer 2)
  listEnvironments: () => fetchJSON<any[]>('/enc/environments'),
  createEnvironment: (data: any) =>
    fetchJSON<any>('/enc/environments', { method: 'POST', body: JSON.stringify(data) }),
  updateEnvironment: (name: string, data: any) =>
    fetchJSON<any>(`/enc/environments/${name}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEnvironment: (name: string) =>
    fetchJSON<void>(`/enc/environments/${name}`, { method: 'DELETE' }),

  // Groups (Layer 3)
  listGroups: () => fetchJSON<any[]>('/enc/groups'),
  createGroup: (data: any) =>
    fetchJSON<any>('/enc/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id: number, data: any) =>
    fetchJSON<any>(`/enc/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id: number) =>
    fetchJSON<void>(`/enc/groups/${id}`, { method: 'DELETE' }),

  // Nodes (Layer 4)
  listNodes: () => fetchJSON<any[]>('/enc/nodes'),
  createNode: (data: any) =>
    fetchJSON<any>('/enc/nodes', { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (certname: string, data: any) =>
    fetchJSON<any>(`/enc/nodes/${certname}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNode: (certname: string) =>
    fetchJSON<void>(`/enc/nodes/${certname}`, { method: 'DELETE' }),

  // Classify (lookup)
  classify: (certname: string) => fetchJSON<any>(`/enc/classify/${certname}`),

  // Bolt inventory generation (3.x)
  getBoltInventory: () => fetchJSON<any>('/enc/inventory/bolt'),
  getBoltInventoryYaml: () =>
    fetch(`${API_BASE}/enc/inventory/bolt/yaml`, { headers: getAuthHeaders() })
      .then((r) => r.text()),
};





// ─── Bolt Orchestration ─────────────────────────────────────

export const bolt = {
  getStatus: () => fetchJSON<any>('/bolt/status'),
  getTasks: () => fetchJSON<any>('/bolt/tasks'),
  getPlans: () => fetchJSON<any>('/bolt/plans'),
  getInventory: () => fetchJSON<any>('/bolt/inventory'),
  getConfig: () => fetchJSON<any>('/bolt/config'),
  saveConfig: (file: string, content: string) =>
    fetchJSON<any>('/bolt/config', {
      method: 'PUT',
      body: JSON.stringify({ file, content }),
    }),
  // Sync inventory from ENC hierarchy (3.x)
  syncInventoryFromEnc: () =>
    fetchJSON<any>('/bolt/inventory/sync', { method: 'POST' }),
  runCommand: (data: { command: string; targets: string; format?: string; run_as?: string }) =>
    fetchJSON<any>('/bolt/run/command', { method: 'POST', body: JSON.stringify(data) }),
  runTask: (data: { task: string; targets: string; params?: any; format?: string; run_as?: string }) =>
    fetchJSON<any>('/bolt/run/task', { method: 'POST', body: JSON.stringify(data) }),
  runPlan: (data: { plan: string; params?: any; format?: string }) =>
    fetchJSON<any>('/bolt/run/plan', { method: 'POST', body: JSON.stringify(data) }),

  // File transfer (upload / download)
  uploadFile: (file: File, targets: string, destination: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targets', targets);
    formData.append('destination', destination);
    const headers: Record<string, string> = {};
    const token = localStorage.getItem('openvox_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Do NOT set Content-Type — browser sets it with boundary for multipart
    return fetch(`${API_BASE}/bolt/file/upload`, {
      method: 'POST', headers, body: formData,
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API Error ${r.status}: ${await r.text()}`);
      return r.json();
    });
  },
  downloadFile: (data: { source: string; destination: string; targets: string }) =>
    fetchJSON<any>('/bolt/file/download', { method: 'POST', body: JSON.stringify(data) }),
  runScript: (file: File, targets: string, args: string = '') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targets', targets);
    formData.append('arguments', args);
    const headers: Record<string, string> = {};
    const token = localStorage.getItem('openvox_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_BASE}/bolt/run/script`, {
      method: 'POST', headers, body: formData,
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API Error ${r.status}: ${await r.text()}`);
      return r.json();
    });
  },
};
// ─── Users ──────────────────────────────────────────────────

export const users = {
  list: () => fetchJSON<any[]>('/auth/users'),
  create: (data: { username: string; password: string; role: string; auth_source?: string }) =>
    fetchJSON<any>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  remove: (username: string) =>
    fetchJSON<any>(`/auth/users/${username}`, { method: 'DELETE' }),
  changePassword: (username: string, newPassword: string) =>
    fetchJSON<any>(`/auth/users/${username}/password`, {
      method: 'PUT',
      body: JSON.stringify({ username, new_password: newPassword }),
    }),
  changeRole: (username: string, role: string) =>
    fetchJSON<any>(`/auth/users/${username}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  changeAuthSource: (username: string, authSource: string) =>
    fetchJSON<any>(`/auth/users/${username}/auth-source`, {
      method: 'PUT',
      body: JSON.stringify({ auth_source: authSource }),
    }),
};

// ─── LDAP Configuration ─────────────────────────────────────

export const ldap = {
  getConfig: () => fetchJSON<any>('/auth/ldap/config'),
  saveConfig: (data: any) =>
    fetchJSON<any>('/auth/ldap/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  testConnection: (data: any) =>
    fetchJSON<any>('/auth/ldap/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getStatus: () => fetchJSON<any>('/auth/status'),
};
// ─── Configuration ──────────────────────────────────────────

export const config = {
  getPuppet: () => fetchJSON<any>('/config/puppet'),
  updatePuppet: (data: { section: string; key: string; value: string }) =>
    fetchJSON<any>('/config/puppet', { method: 'PUT', body: JSON.stringify(data) }),
  getPuppetDB: () => fetchJSON<any>('/config/puppetdb'),
  getHiera: () => fetchJSON<any>('/config/hiera'),
  getEnvironments: () => fetchJSON<any>('/config/environments'),
  getModules: (environment: string) =>
    fetchJSON<any>(`/config/environments/${environment}/modules`),
  getServices: () => fetchJSON<any[]>('/config/services'),
  restartPuppetStack: () =>
    fetchJSON<any>('/config/services/restart-puppet-stack', { method: 'POST' }),
  restartService: (service: string) =>
    fetchJSON<any>('/config/services/restart', {
      method: 'POST',
      body: JSON.stringify({ service, action: 'restart' }),
    }),
  getAppName: () => fetchJSON<any>('/config/app/name'),
  getApp: () => fetchJSON<any>('/config/app'),
  updateApp: (key: string, value: string) =>
    fetchJSON<any>('/config/app', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  testProxy: () =>
    fetchJSON<{ success: boolean; status_code: number; message: string; proxy_used: string }>(
      '/config/proxy-test'
    ),
  // OpenVox lookup
  lookup: (key: string, node?: string, environment?: string) =>
    fetchJSON<any>('/config/lookup', {
      method: 'POST',
      body: JSON.stringify({ key, node: node || null, environment: environment || null }),
    }),
  // Hiera files (read-only)
  getHieraFiles: () => fetchJSON<any>('/config/hiera/files'),
  // Config file browser
  listFiles: () => fetchJSON<any>('/config/files'),
  readFile: (path: string) =>
    fetchJSON<any>('/config/files/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  saveFile: (path: string, content: string) =>
    fetchJSON<any>('/config/files/save', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),
  // SSL configuration
  getSSL: () => fetchJSON<any>('/config/ssl'),
  updateSSL: (data: { ssl_enabled?: boolean; cert_path?: string; key_path?: string; ca_path?: string }) =>
    fetchJSON<any>('/config/ssl', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── PQL Console ────────────────────────────────────────────

export const pql = {
  query: (query: string, limit: number = 10000) =>
    fetchJSON<any>('/pql/query', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    }),
  getExamples: () => fetchJSON<any>('/pql/examples'),
};

// ─── Certificates ───────────────────────────────────────────

export const certificates = {
  list: () => fetchJSON<any>('/certificates/list'),
  caInfo: () => fetchJSON<any>('/certificates/ca-info'),
  sign: (certname: string) =>
    fetchJSON<any>('/certificates/sign', {
      method: 'POST',
      body: JSON.stringify({ certname }),
    }),
  revoke: (certname: string) =>
    fetchJSON<any>('/certificates/revoke', {
      method: 'POST',
      body: JSON.stringify({ certname }),
    }),
  clean: (certname: string) =>
    fetchJSON<any>('/certificates/clean', {
      method: 'POST',
      body: JSON.stringify({ certname }),
    }),
  info: (certname: string) => fetchJSON<any>('/certificates/info/' + certname),
};

// ─── Facts Explorer ─────────────────────────────────────────

export const facts = {
  getNames: (includePaths: boolean = true) =>
    fetchJSON<any>('/facts/names' + (includePaths ? '?include_paths=true' : ''))
      .then((r: any) => r.names || []),
  
  getByName: (factPath: string) =>
    fetchJSON<any>('/facts/values/' + encodeURIComponent(factPath)),
  
  getForNode: (certname: string) =>
    fetchJSON<any[]>('/nodes/' + certname + '/facts'),
  
  getStructure: (factName: string, sampleCount: number = 5) =>
    fetchJSON<any>('/facts/structure/' + encodeURIComponent(factName) + '?sample_count=' + sampleCount),
};

// ─── Resource Explorer ──────────────────────────────────────
// Searches for Puppet resources by type and optional title using a PQL
// query against PuppetDB. The type and title are embedded in the query
// as quoted strings. Results are ordered by certname and capped at 200.

export const resources = {
  search: (type: string, title?: string) => {
    let q = `resources { type = "${type}"`;
    if (title) q += ` and title = "${title}"`;
    q += ' order by certname limit 200 }';
    return pql.query(q, 200);
  },
};

// ─── Execution History ──────────────────────────────────────

export interface ExecutionHistoryEntry {
  id: number;
  execution_type: 'command' | 'task' | 'plan';
  node_name: string;
  command_name?: string;
  task_name?: string;
  plan_name?: string;
  environment?: string;
  parameters?: Record<string, any>;
  result_format?: string;
  status: 'running' | 'success' | 'failure' | 'queued';
  executed_at: string;
  executed_by: string;
  duration_ms?: number;
  error_message?: string;
  result_preview?: string;
}

export interface ExecutionStats {
  period_days: number;
  total_executions: number;
  successful: number;
  failed: number;
  running: number;
  by_type: {
    command: number;
    task: number;
    plan: number;
  };
  top_nodes: Array<{ node: string; count: number }>;
  avg_duration_ms: number;
}

// ─── Installer / Package Mirror ─────────────────────────────

export interface InstallerInfo {
  pkg_repo_url: string;
  puppet_server: string;
  puppet_port: number;
  pkg_repo_dir: string;
  default_version: string;
  install_url_linux: string;
  install_url_win: string;
  linux_command: string;
  windows_command: string;
  last_sync_utc?: string | null;
  last_sync_result?: string | null;
  sync_in_progress: boolean;
  total_bytes: number;
  platforms: Array<{
    platform: string;
    present: boolean;
    bytes: number;
    packages: number;
  }>;
}

export interface InstallerSyncResult {
  success: boolean;
  exit_code: number;
  output: string[];
  triggered_by: string;
}

export interface InstallerDiskInfo {
  path: string;
  total: number;
  used: number;
  free: number;
  used_pct: number;
}

export interface UpstreamRelease {
  id: string;
  label: string;
  openvox_versions: string[];
  arches?: string[];
}

export interface UpstreamFamily {
  id: string;
  label: string;
  repo_type: string;
  releases: UpstreamRelease[];
}

export interface UpstreamInfo {
  families: UpstreamFamily[];
  openvox_versions: string[];
  cached_at?: string | null;
}

export interface MirrorSelections {
  openvox_versions: string[];
  distributions: string[];
}

export interface SelectionUpdateResult {
  success: boolean;
  added: string[];
  removed: string[];
  message: string;
}

export const installer = {
  getInfo: () => fetchJSON<InstallerInfo>('/installer/info'),
  triggerSync: () =>
    fetchJSON<InstallerSyncResult>('/installer/sync', { method: 'POST' }),
  getLog: (lines: number = 200) =>
    fetchJSON<{ path: string; exists: boolean; lines: string[] }>(
      `/installer/log?lines=${lines}`
    ),
  getDiskInfo: () => fetchJSON<InstallerDiskInfo>('/installer/diskinfo'),
  listFiles: (prefix: string = '') =>
    fetchJSON<{
      prefix: string;
      exists: boolean;
      entries: Array<{
        name: string;
        type: 'file' | 'dir';
        bytes: number;
        mtime_utc: string;
      }>;
    }>(`/installer/files${prefix ? '?prefix=' + encodeURIComponent(prefix) : ''}`),
  getUpstream: () => fetchJSON<UpstreamInfo>('/installer/upstream'),
  getSelections: () => fetchJSON<MirrorSelections>('/installer/mirror-selections'),
  saveSelections: (selections: MirrorSelections) =>
    fetchJSON<SelectionUpdateResult>('/installer/mirror-selections', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selections),
    }),
};

export const executionHistory = {
  getHistory: (params?: {
    days?: number;
    execution_type?: string;
    node_name?: string;
    status?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', params.days.toString());
    if (params?.execution_type) qs.set('execution_type', params.execution_type);
    if (params?.node_name) qs.set('node_name', params.node_name);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', params.limit.toString());
    const query = qs.toString();
    return fetchJSON<ExecutionHistoryEntry[]>(`/execution-history/${query ? '?' + query : ''}`);
  },
  
  getStats: (days: number = 14) =>
    fetchJSON<ExecutionStats>(`/execution-history/stats?days=${days}`),
  
  deleteEntry: (id: number) =>
    fetchJSON<any>(`/execution-history/${id}`, { method: 'DELETE' }),
  
  cleanupOld: (days: number = 90) =>
    fetchJSON<any>(`/execution-history/cleanup/old?days=${days}`, { method: 'DELETE' }),
};

