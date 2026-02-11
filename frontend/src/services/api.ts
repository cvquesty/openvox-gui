/**
 * API client for the OpenVox GUI backend.
 */
const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('openvox_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: getAuthHeaders(),
    ...options,
  });
  if (response.status === 401) {
    // Token expired or invalid — clear it and reload to show login
    localStorage.removeItem('openvox_token');
    window.location.reload();
    throw new Error('Session expired. Please log in again.');
  }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }
  if (response.status === 204) return {} as T;
  return response.json();
}

// ─── Dashboard ──────────────────────────────────────────────

export const dashboard = {
  getStats: () => fetchJSON<any>('/dashboard/stats'),
  getNodeStatus: () => fetchJSON<any>('/dashboard/node-status'),
  getReportTrends: () => fetchJSON<any[]>('/dashboard/report-trends'),
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
  // Available classes from Puppet modules
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
};





// ─── Bolt Orchestration ─────────────────────────────────────

export const bolt = {
  getStatus: () => fetchJSON<any>('/bolt/status'),
  getTasks: () => fetchJSON<any>('/bolt/tasks'),
  getPlans: () => fetchJSON<any>('/bolt/plans'),
  getInventory: () => fetchJSON<any>('/bolt/inventory'),
  getConfig: () => fetchJSON<any>('/bolt/config'),
  runCommand: (data: { command: string; targets: string; run_as?: string }) =>
    fetchJSON<any>('/bolt/run/command', { method: 'POST', body: JSON.stringify(data) }),
  runTask: (data: { task: string; targets: string; params?: any; run_as?: string }) =>
    fetchJSON<any>('/bolt/run/task', { method: 'POST', body: JSON.stringify(data) }),
  runPlan: (data: { plan: string; params?: any }) =>
    fetchJSON<any>('/bolt/run/plan', { method: 'POST', body: JSON.stringify(data) }),
};
// ─── Users ──────────────────────────────────────────────────

export const users = {
  list: () => fetchJSON<any[]>('/auth/users'),
  create: (data: { username: string; password: string; role: string }) =>
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
  restartService: (service: string) =>
    fetchJSON<any>('/config/services/restart', {
      method: 'POST',
      body: JSON.stringify({ service, action: 'restart' }),
    }),
  getApp: () => fetchJSON<any>('/config/app'),
  updateApp: (key: string, value: string) =>
    fetchJSON<any>('/config/app', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  // Puppet lookup
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
};

// ─── PQL Console ────────────────────────────────────────────

export const pql = {
  query: (query: string, limit: number = 100) =>
    fetchJSON<any>('/pql/query', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    }),
  getExamples: () => fetchJSON<any>('/pql/examples'),
};

// ─── Certificates ───────────────────────────────────────────

export const certificates = {
  list: () => fetchJSON<any>('/certificates/list'),
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
  getNames: () => fetchJSON<string[]>('/nodes/').then(() =>
    pql.query('fact-names {}').then((r: any) => r.results || [])
  ),
  getByName: (name: string) =>
    pql.query('facts { name =  + name +  }'),
  getForNode: (certname: string) =>
    fetchJSON<any[]>('/nodes/' + certname + '/facts'),
};

// ─── Resource Explorer ──────────────────────────────────────

export const resources = {
  search: (type: string, title?: string) => {
    let q = 'resources { type =  + type + ';
    if (title) q += ' and title =  + title + ';
    q += ' order by certname limit 200 }';
    return pql.query(q, 200);
  },
};

// ─── Performance ────────────────────────────────────────────

export const performance = {
  getOverview: (hours?: number) =>
    fetchJSON<any>('/performance/overview' + (hours ? '?hours=' + hours : '')),
  getNode: (certname: string) =>
    fetchJSON<any>('/performance/node/' + certname),
};

