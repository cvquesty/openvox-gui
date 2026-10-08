/**
 * Centralised API client for the OpenVox GUI backend.
 *
 * Every backend call in the frontend goes through this module. It provides
 * a thin wrapper around the browser's fetch() API that handles:
 *
 *   1. Cookie-based session auth (httpOnly openvox_token; same-origin).
 *   2. Session expiry via sessionGate — 401 probes /api/auth/me once and
 *      notifies AuthContext (no full-page reload storm behind VIP).
 *   3. Consistent error handling — non-2xx → thrown Error with detail.
 *   4. HTTP 204 No Content → empty object (DELETE endpoints).
 *
 * The module is organised into namespaced objects (dashboard, nodes,
 * reports, etc.) that mirror the backend's router structure.
 */
import { handleUnauthorized } from '../utils/sessionGate';

const API_BASE = '/api';

/**
 * Build the standard headers object for an authenticated API request.
 * Cookie is sent automatically for same-origin requests.
 */
function getAuthHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

/**
 * Core fetch wrapper used by every API function in this module.
 *
 * On 401: single-flight session gate (probe /auth/me). Does **not**
 * call window.location.reload() — that caused VIP multi-console thrash.
 */
async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options || {};
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      credentials: 'same-origin',
      headers: { ...getAuthHeaders(), ...(extraHeaders as Record<string, string> | undefined) },
      ...rest,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError') throw e;
    const msg = String(err?.message || e);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        'Could not reach the GUI API (proxy timeout or the server was busy discovering classes). Try again.',
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }
  if (response.status === 401) {
    await handleUnauthorized();
    throw new Error('Session expired. Please log in again.');
  }
  if (!response.ok) {
    const error = await response.text();
    let detail = error;
    try {
      const parsed = JSON.parse(error);
      if (typeof parsed?.detail === 'string') {
        detail = parsed.detail;
      } else if (parsed?.detail != null) {
        detail = JSON.stringify(parsed.detail);
      }
    } catch {
      // Apache/plain-text bodies stay as-is
    }
    throw new Error(`API Error ${response.status}: ${detail}`);
  }
  // HTTP 204 No Content has no response body — return an empty object
  // rather than trying to parse undefined JSON.
  if (response.status === 204) return {} as T;
  return response.json();
}

// ─── Dashboard ──────────────────────────────────────────────


// ─── Auth (session cookie; used by AuthContext — srdevarch1 MP3) ───

export const auth = {
  /** Session probe — does NOT invoke session gate on 401 (AuthContext handles it). */
  me: async () => {
    const response = await fetch(`${API_BASE}/auth/me`, {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    return response.json();
  },
  status: async () => {
    const response = await fetch(`${API_BASE}/auth/status`, {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    return response.json() as Promise<{
      auth_required?: boolean;
      auth_backend?: string;
      access_mode?: 'direct' | 'vip';
      session_ttl_seconds?: number;
      session_min_seconds?: number;
      vip_poll_floor_ms?: number;
      request_host?: string;
      vip_hosts_configured?: string[];
    }>;
  },
  /**
   * Login must NOT go through fetchJSON's 401 → "Session expired" mapping.
   * Failed credentials are a normal 401 with a useful detail string.
   */
  login: async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAuthHeaders(),
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const error = await response.text();
      let detail = error || `Login failed (${response.status})`;
      try {
        const parsed = JSON.parse(error);
        if (typeof parsed?.detail === 'string') detail = parsed.detail;
        else if (parsed?.detail != null) detail = JSON.stringify(parsed.detail);
      } catch {
        /* plain text */
      }
      throw new Error(detail);
    }
    return response.json() as Promise<{
      user: { username: string; role: string; auth_source?: string };
      token?: string;
    }>;
  },
  logout: () =>
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    }).then(() => undefined),
};

export const dashboard = {
  getData: () => fetchJSON<any>('/dashboard/data'),
  getStats: () => fetchJSON<any>('/dashboard/stats'),
  getNodeStatus: () => fetchJSON<any>('/dashboard/node-status'),
  getReportTrends: () => fetchJSON<any[]>('/dashboard/report-trends'),
  getNodeStatusTrends: () => fetchJSON<any[]>('/dashboard/node-status-trends'),
  // getServices removed: use config.getServices which points to the authoritative /api/config/services
  // (legacy /dashboard/services retained only in backend for extreme backward compat)
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
  deactivate: (certname: string) =>
    fetchJSON<any>(`/nodes/${certname}/deactivate`, { method: 'POST' }),
  purge: (certname: string) =>
    fetchJSON<any>(`/nodes/${encodeURIComponent(certname)}/purge`, { method: 'POST' }),
  dismiss: (certname: string) =>
    fetchJSON<any>(`/nodes/${encodeURIComponent(certname)}/dismiss`, { method: 'POST' }),
  undismiss: (certname: string) =>
    fetchJSON<any>(`/nodes/${encodeURIComponent(certname)}/dismiss`, { method: 'DELETE' }),
  getReports: (certname: string, limit = 20) =>
    fetchJSON<any[]>(`/nodes/${certname}/reports?limit=${limit}`),
  /** Node Detail only — at-a-glance facts + estate Host Health */
  getHealthGlance: (certname: string) =>
    fetchJSON<any>(`/nodes/${encodeURIComponent(certname)}/health-glance`),
  /** One-shot live /proc sample (operator+); not fleet-wide collection */
  sampleHealthGlance: (certname: string) =>
    fetchJSON<any>(`/nodes/${encodeURIComponent(certname)}/health-glance/sample`, {
      method: 'POST',
    }),
};

// ─── Reports ────────────────────────────────────────────────

export const reports = {
  list: (params?: { certname?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.certname) qs.set('certname', params.certname);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', params.limit.toString());
    const query = qs.toString();
    // Prefer no trailing slash before ? (same pattern as execution-history);
    // backend registers both "" and "/" collection paths.
    return fetchJSON<any[]>(query ? `/reports?${query}` : '/reports');
  },
  get: (hash: string) => fetchJSON<any>(`/reports/${hash}`),
  // Live Inventory report (Logs | Reports | Inventory)
  inventory: () => fetchJSON<any[]>('/reports/inventory'),

  // Executive Summary (Fleet Health) Report recipients + config
  listExecutiveRecipients: () => fetchJSON<any[]>('/reports/executive-summary/recipients'),
  addExecutiveRecipient: (email: string) =>
    fetchJSON<any>('/reports/executive-summary/recipients', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  deleteExecutiveRecipient: (id: number) =>
    fetchJSON<any>(`/reports/executive-summary/recipients/${id}`, {
      method: 'DELETE',
    }),
  getExecutiveConfig: () => fetchJSON<any>('/reports/executive-summary/config'),
  updateExecutiveConfig: (data: any) =>
    fetchJSON<any>('/reports/executive-summary/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  sendExecutiveReport: (emails?: string[], fromEmail?: string) =>
    fetchJSON<any>('/reports/executive-summary/send', {
      method: 'POST',
      body: JSON.stringify({ emails: emails || undefined, from_email: fromEmail || undefined }),
    }),
};

// ─── Deployment ─────────────────────────────────────────────

export const deploy = {
  getEnvironments: () => fetchJSON<any>('/deploy/environments'),
  getRepos: () => fetchJSON<any>('/deploy/repos'),
  getStatus: () => fetchJSON<any>('/deploy/status'),
  getHistory: () => fetchJSON<any>('/deploy/history'),
  run: (environment?: string) =>
    fetchJSON<import('../types').DeployRunResult>('/deploy/run', {
      method: 'POST',
      body: JSON.stringify({ environment: environment || null }),
    }),
  /** Clustered: stage code on all deploy targets */
  stage: (environment?: string) =>
    fetchJSON<any>('/deploy/stage', {
      method: 'POST',
      body: JSON.stringify({ environment: environment || null }),
    }),
  /** Clustered: activate staged code on all deploy targets */
  activate: (environment?: string) =>
    fetchJSON<any>('/deploy/activate', {
      method: 'POST',
      body: JSON.stringify({ environment: environment || null }),
    }),
};

// ─── ENC ────────────────────────────────────────────────────

export const enc = {
  // Available classes from OpenVox modules
  getAvailableClasses: (env?: string, signal?: AbortSignal) =>
    fetchJSON<any>(
      `/enc/available-classes${env ? `?environment=${encodeURIComponent(env)}` : ''}`,
      signal ? { signal } : undefined,
    ),

  // Hierarchy overview
  getHierarchy: () => fetchJSON<any>('/enc/hierarchy'),

  // Common (Layer 1)
  getCommon: () => fetchJSON<any>('/enc/common'),
  saveCommon: (data: { classes: any; parameters: any }) =>
    fetchJSON<any>('/enc/common', { method: 'PUT', body: JSON.stringify(data) }),

  // Environments (Layer 2)
  listEnvironments: () => fetchJSON<any[]>('/enc/environments'),
  syncEnvironments: () =>
    fetchJSON<{
      live: string[];
      created: string[];
      pruned: string[];
      kept_in_use: string[];
    }>('/enc/environments/sync', { method: 'POST' }),
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

  // Reconciliation (normalization between SQLite classification and live fleet)
  reconcile: () =>
    fetchJSON<any>('/enc/reconcile', { method: 'POST' }),

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
    fetchJSON<import('../types').BoltRunResult>('/bolt/run/command', { method: 'POST', body: JSON.stringify(data) }),
  runTask: (data: { task: string; targets: string; params?: any; format?: string; run_as?: string }) =>
    fetchJSON<import('../types').BoltRunResult>('/bolt/run/task', { method: 'POST', body: JSON.stringify(data) }),
  runPlan: (data: { plan: string; params?: any; format?: string }) =>
    fetchJSON<import('../types').BoltRunResult>('/bolt/run/plan', { method: 'POST', body: JSON.stringify(data) }),

  // File transfer (upload / download)
  uploadFile: (file: File, targets: string, destination: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targets', targets);
    formData.append('destination', destination);
    const headers: Record<string, string> = {};
    // Cookie-based auth preferred; no localStorage token sent here.
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
    // Cookie-based auth preferred; no localStorage token sent here.
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
  getServices: () => fetchJSON<any>('/config/services'),
  restartPuppetStack: () =>
    fetchJSON<any>('/config/services/restart-puppet-stack', { method: 'POST' }),
  restartService: (service: string) =>
    fetchJSON<any>('/config/services/restart', {
      method: 'POST',
      body: JSON.stringify({ service, action: 'restart' }),
    }),
  getCluster: () => fetchJSON<any>('/config/cluster'),
  getClusterHealth: () => fetchJSON<any>('/config/cluster/health'),
  updateCluster: (data: {
    deployment_mode: string;
    compilers: string[];
    puppetdb_nodes: string[];
    ca_nodes?: string[];
    ca_vips?: string[];
    infra_vips?: string[];
    dns_rr_vips?: string[];
    fleet_exclude?: string[];
    code_deploy_targets: string[];
    consoles?: string[];
    vip_hosts?: string[];
    database_backend?: string;
    enc_api_urls?: string[];
    database_url?: string;
    shared_secret_key?: string;
    staging_codedir?: string;
    live_codedir?: string;
    seed_infrastructure_groups?: boolean;
  }) =>
    fetchJSON<any>('/config/cluster', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getClusterSecrets: () => fetchJSON<any>('/config/cluster/secrets'),
  upsertClusterSecret: (data: { name: string; value: string; description?: string }) =>
    fetchJSON<any>('/config/cluster/secrets', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteClusterSecret: (name: string) =>
    fetchJSON<any>(`/config/cluster/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
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
  /**
   * Trusted facts = Puppet certificate extension requests (pp_role, etc.)
   * baked into signed PEMs. See GET /api/certificates/trusted-facts.
   */
  trustedFacts: (opts?: {
    certname?: string;
    key?: string;
    value?: string;
    only_with_extensions?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (opts?.certname) params.set('certname', opts.certname);
    if (opts?.key) params.set('key', opts.key);
    if (opts?.value) params.set('value', opts.value);
    if (opts?.only_with_extensions === false) params.set('only_with_extensions', 'false');
    const qs = params.toString();
    return fetchJSON<any>('/certificates/trusted-facts' + (qs ? `?${qs}` : ''));
  },
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
  reject: (certname: string) =>
    fetchJSON<any>('/certificates/reject', {
      method: 'POST',
      body: JSON.stringify({ certname }),
    }),
  info: (certname: string) => fetchJSON<any>('/certificates/info/' + certname),
  audit: () => fetchJSON<any>('/certificates/audit'),
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

// ─── SSL Certificate Wizard ─────────────────────────────────

function sslUpload(url: string, files: Record<string, File | null>, fields?: Record<string, string>) {
  const formData = new FormData();
  for (const [key, file] of Object.entries(files)) {
    if (file) formData.append(key, file);
  }
  if (fields) {
    for (const [key, val] of Object.entries(fields)) {
      formData.append(key, val);
    }
  }
  // Rely on httpOnly cookie for auth; do not set Content-Type (boundary).
  return fetch(`${API_BASE}${url}`, {
    method: 'POST', body: formData, credentials: 'same-origin',
  }).then(async (r) => {
    if (r.status === 401) {
      await handleUnauthorized();
      throw new Error('Session expired');
    }
    if (!r.ok) throw new Error(`API Error ${r.status}: ${await r.text()}`);
    return r.json();
  });
}

export const ssl = {
  getStatus: () => fetchJSON<any>('/ssl/status'),
  validate: (certFile: File, keyFile: File, chainFile?: File | null) =>
    sslUpload('/ssl/validate', { cert_file: certFile, key_file: keyFile, chain_file: chainFile || null }),
  applyWebCert: (certFile: File, keyFile: File, chainFile?: File | null) =>
    sslUpload('/ssl/apply-web-cert', { cert_file: certFile, key_file: keyFile, chain_file: chainFile || null }),
  applyPuppetCerts: () =>
    fetchJSON<any>('/ssl/apply-puppet-certs', { method: 'POST' }),
  letsencrypt: {
    getStatus: () => fetchJSON<any>('/ssl/letsencrypt/status'),
    renew: () => fetchJSON<any>('/ssl/letsencrypt/renew', { method: 'POST' }),
    signal: () => fetchJSON<any>('/ssl/letsencrypt/signal', { method: 'POST' }),
  },
  puppetCA: {
    getStatus: () => fetchJSON<any>('/ssl/puppet-ca/status'),
    generateCSR: (keyType: string = 'rsa') =>
      sslUpload('/ssl/puppet-ca/generate-csr', {}, { key_type: keyType }),
    getPending: () => fetchJSON<any>('/ssl/puppet-ca/pending'),
    importCA: (certBundle: File, crlChain: File, keyFile?: File | null) =>
      sslUpload('/ssl/puppet-ca/import', { cert_bundle: certBundle, crl_chain: crlChain, key_file: keyFile || null }),
  },
};

// ─── Performance Metrics ────────────────────────────────────

export const performance = {
  getOverview: (hours: number = 48, scopeQs?: string) => {
    const qs = new URLSearchParams();
    qs.set('hours', String(hours));
    if (scopeQs) {
      const extra = new URLSearchParams(scopeQs);
      extra.forEach((v, k) => qs.set(k, v));
    }
    return fetchJSON<any>(`/performance/overview?${qs.toString()}`);
  },
  getNode: (certname: string) => fetchJSON<any>(`/performance/node/${certname}`),
};

// ─── Metrics / Visualization ────────────────────────────────

export const metrics = {
  scopes: () => fetchJSON<any>('/insights/scopes'),
  compliance: (hours: number = 24, scopeQs?: string) => {
    const qs = new URLSearchParams();
    qs.set('hours', String(hours));
    if (scopeQs) {
      const extra = new URLSearchParams(scopeQs);
      extra.forEach((v, k) => qs.set(k, v));
    }
    return fetchJSON<any>(`/insights/compliance?${qs.toString()}`);
  },
  events: (params?: { limit?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', params.limit.toString());
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return fetchJSON<any>(`/insights/events${query ? '?' + query : ''}`);
  },
  factDistribution: (factPath: string) =>
    fetchJSON<any>(`/insights/fact-distribution/${encodeURIComponent(factPath)}`),
  factOverview: () => fetchJSON<any>('/insights/fact-overview'),
  catalog: (certname: string) =>
    fetchJSON<any>(`/insights/catalog/${certname}`),
  puppetdbHealth: () => fetchJSON<any>('/insights/puppetdb-health'),
  puppetdbPerformance: () => fetchJSON<any>('/insights/puppetdb-performance'),
  heatmap: () => fetchJSON<any>('/insights/heatmap'),

  // OpenVox Server Health and OpenVoxDB Health (in Metrics section)
  puppetserverHealth: () => fetchJSON<any>('/insights/puppetserver-health'),
  puppetserverPerformance: () => fetchJSON<any>('/insights/puppetserver-performance'),
  puppetserverMetricsList: () => fetchJSON<any>('/insights/puppetserver-metrics-list'),
  puppetserverMetric: (name: string) => fetchJSON<any>(`/insights/puppetserver-metric?name=${encodeURIComponent(name)}`),
  environments: () => fetchJSON<any>('/insights/environments'),
  classCoverage: (limit: number = 50) =>
    fetchJSON<any>(`/insights/class-coverage?limit=${limit}`),

  // Node Health (agent disabled/enabled status + live checks)
  nodeHealth: () => fetchJSON<any>('/insights/node-health'),
  nodeHealthCheck: (data: { targets: string; run_as?: string }) =>
    fetchJSON<any>('/insights/node-health/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Host Health — OpenVox serving estate only (sysstat/pidstat//proc; not agents)
  hostHealth: (refresh: boolean = true, includeRemote: boolean = true) =>
    fetchJSON<any>(
      `/insights/host-health?refresh=${refresh ? 'true' : 'false'}&include_remote=${includeRemote ? 'true' : 'false'}`
    ),
  hostHealthTargets: () => fetchJSON<any>('/insights/host-health/targets'),
  hostHealthCollect: (includeRemote: boolean = true) =>
    fetchJSON<any>(`/insights/host-health/collect?include_remote=${includeRemote ? 'true' : 'false'}`, {
      method: 'POST',
    }),
};

// ─── Log Viewer ─────────────────────────────────────────────

export const logs = {
  getSources: () => fetchJSON<any>('/logs/sources'),
  get: (source: string, params?: { lines?: number; since?: string; grep?: string; host?: string }) => {
    const qs = new URLSearchParams();
    if (params?.lines) qs.set('lines', params.lines.toString());
    if (params?.since) qs.set('since', params.since);
    if (params?.grep) qs.set('grep', params.grep);
    if (params?.host) qs.set('host', params.host);
    const query = qs.toString();
    return fetchJSON<any>(`/logs/${source}${query ? '?' + query : ''}`);
  },
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
  started?: boolean;
  in_progress?: boolean;
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

export type MirrorTransport = 'https' | 'rsync' | 'rsync_fallback';

export interface MirrorSelections {
  openvox_versions: string[];
  distributions: string[];
  /** How this site pulls upstream packages. Default https (works through HTTP proxy). */
  transport?: MirrorTransport;
}

export interface SelectionUpdateResult {
  success: boolean;
  added: string[];
  removed: string[];
  message: string;
}

export const installer = {
  getInfo: (full: boolean = false) =>
    fetchJSON<InstallerInfo>(`/installer/info${full ? '?full=true' : ''}`),
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
  saveSelections: (selections: MirrorSelections, opts?: { applySync?: boolean }) =>
    fetchJSON<SelectionUpdateResult>(
      `/installer/mirror-selections${opts?.applySync === false ? '?apply_sync=false' : ''}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selections),
      },
    ),
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
    // No slash before ? — `/execution-history/?days=` can 500/404 on some proxies
    return fetchJSON<ExecutionHistoryEntry[]>(
      query ? `/execution-history?${query}` : '/execution-history',
    );
  },

  getStats: (days: number = 14) =>
    fetchJSON<ExecutionStats>(`/execution-history/stats?days=${days}`),

  deleteEntry: (id: number) =>
    fetchJSON<any>(`/execution-history/${id}`, { method: 'DELETE' }),

  cleanupOld: (days: number = 90) =>
    fetchJSON<any>(`/execution-history/cleanup/old?days=${days}`, { method: 'DELETE' }),
};

