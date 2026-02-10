/**
 * API client for the OpenVox GUI backend.
 */
const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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
  run: (environment?: string) =>
    fetchJSON<any>('/deploy/run', {
      method: 'POST',
      body: JSON.stringify({ environment: environment || null }),
    }),
};

// ─── ENC ────────────────────────────────────────────────────

export const enc = {
  // Groups
  listGroups: () => fetchJSON<any[]>('/enc/groups'),
  createGroup: (data: any) =>
    fetchJSON<any>('/enc/groups', { method: 'POST', body: JSON.stringify(data) }),
  getGroup: (id: number) => fetchJSON<any>(`/enc/groups/${id}`),
  updateGroup: (id: number, data: any) =>
    fetchJSON<any>(`/enc/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id: number) =>
    fetchJSON<void>(`/enc/groups/${id}`, { method: 'DELETE' }),

  // Classifications
  listClassifications: () => fetchJSON<any[]>('/enc/classifications'),
  createClassification: (data: any) =>
    fetchJSON<any>('/enc/classifications', { method: 'POST', body: JSON.stringify(data) }),
  getClassification: (certname: string) =>
    fetchJSON<any>(`/enc/classifications/${certname}`),
  deleteClassification: (certname: string) =>
    fetchJSON<void>(`/enc/classifications/${certname}`, { method: 'DELETE' }),

  // Rules
  listRules: () => fetchJSON<any[]>('/enc/rules'),
  createRule: (data: any) =>
    fetchJSON<any>('/enc/rules', { method: 'POST', body: JSON.stringify(data) }),
  deleteRule: (id: number) =>
    fetchJSON<void>(`/enc/rules/${id}`, { method: 'DELETE' }),

  // Classify
  classify: (certname: string) => fetchJSON<any>(`/enc/classify/${certname}`),
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
};
