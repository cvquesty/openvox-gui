/**
 * Prefetch lazy route chunks so the first click is not a spinner + download.
 *
 * Import paths must match App.tsx so Vite emits the same chunks.
 */

export type RouteLoader = {
  id: string;
  match: (path: string) => boolean;
  load: () => Promise<unknown>;
};

export const ROUTE_LOADERS: RouteLoader[] = [
  { id: 'dashboard', match: (p) => p === '/' || p === '', load: () => import('../pages/Dashboard') },
  { id: 'nodes', match: (p) => p === '/nodes', load: () => import('../pages/Nodes') },
  { id: 'node-detail', match: (p) => p.startsWith('/nodes/'), load: () => import('../pages/NodeDetail') },
  { id: 'reports', match: (p) => p === '/reports', load: () => import('../pages/Reports') },
  { id: 'report-detail', match: (p) => p.startsWith('/reports/'), load: () => import('../pages/ReportDetail') },
  { id: 'enc', match: (p) => p === '/enc' || p.startsWith('/enc/'), load: () => import('../pages/NodeClassifier') },
  { id: 'deployment', match: (p) => p.startsWith('/deployment'), load: () => import('../pages/CodeDeployment') },
  { id: 'orchestration', match: (p) => p.startsWith('/orchestration'), load: () => import('../pages/Orchestration') },
  { id: 'pql', match: (p) => p.startsWith('/pql'), load: () => import('../pages/PQLConsole') },
  { id: 'facts', match: (p) => p === '/facts' || p.startsWith('/facts/'), load: () => import('../pages/FactExplorer') },
  { id: 'resources', match: (p) => p.startsWith('/resources'), load: () => import('../pages/ResourceExplorer') },
  { id: 'packages', match: (p) => p.startsWith('/packages'), load: () => import('../pages/Packages') },
  { id: 'hiera', match: (p) => p.startsWith('/data/hiera'), load: () => import('../pages/DataHiera') },
  { id: 'lookup', match: (p) => p.startsWith('/data/lookup'), load: () => import('../pages/DataLookup') },
  { id: 'certificates', match: (p) => p.startsWith('/certificates'), load: () => import('../pages/Certificates') },
  { id: 'installer', match: (p) => p.startsWith('/installer'), load: () => import('../pages/Installer') },
  { id: 'logs', match: (p) => p.startsWith('/logs'), load: () => import('../pages/Logs') },
  { id: 'inventory', match: (p) => p.startsWith('/inventory'), load: () => import('../pages/Inventory') },
  { id: 'cert-audit', match: (p) => p.startsWith('/cert-audit'), load: () => import('../pages/CertAudit') },
  { id: 'insights-monitor', match: (p) => p === '/insights' || p === '/insights/' || p.startsWith('/insights/monitor'), load: () => import('../pages/MonitoringDashboard') },
  { id: 'insights-all', match: (p) => p.startsWith('/insights/all'), load: () => import('../pages/InsightsHub') },
  { id: 'insights-compliance', match: (p) => p.startsWith('/insights/compliance'), load: () => import('../pages/MetricsCompliance') },
  { id: 'insights-performance', match: (p) => p.startsWith('/insights/performance'), load: () => import('../pages/MetricsPerformance') },
  { id: 'insights-timeline', match: (p) => p.startsWith('/insights/timeline'), load: () => import('../pages/MetricsTimeline') },
  { id: 'insights-facts', match: (p) => p.startsWith('/insights/facts'), load: () => import('../pages/MetricsFactDist') },
  { id: 'insights-classification', match: (p) => p.startsWith('/insights/classification'), load: () => import('../pages/MetricsClassification') },
  { id: 'insights-catalog', match: (p) => p.startsWith('/insights/catalog'), load: () => import('../pages/MetricsCatalog') },
  { id: 'insights-server', match: (p) => p.startsWith('/insights/openvox-server-health'), load: () => import('../pages/MetricsPuppetServerHealth') },
  { id: 'insights-pdb', match: (p) => p.startsWith('/insights/openvoxdb-health'), load: () => import('../pages/MetricsPuppetDBHealth') },
  { id: 'insights-host', match: (p) => p.startsWith('/insights/host-health'), load: () => import('../pages/MetricsHostHealth') },
  { id: 'insights-node-health', match: (p) => p.startsWith('/insights/node-health'), load: () => import('../pages/MetricsNodeHealth') },
  { id: 'insights-heatmap', match: (p) => p.startsWith('/insights/heatmap'), load: () => import('../pages/MetricsHeatmap') },
  { id: 'insights-environments', match: (p) => p.startsWith('/insights/environments'), load: () => import('../pages/MetricsEnvironments') },
  { id: 'insights-classes', match: (p) => p.startsWith('/insights/classes'), load: () => import('../pages/MetricsClassCoverage') },
  { id: 'config-puppet', match: (p) => p.startsWith('/config/puppet'), load: () => import('../pages/ConfigPuppet') },
  { id: 'config-app', match: (p) => p.startsWith('/config/app'), load: () => import('../pages/ConfigApp') },
  { id: 'config-ssl', match: (p) => p.startsWith('/config/ssl'), load: () => import('../pages/ConfigSSL') },
];

/** High-traffic operator pages — warm these after login, not the whole catalog. */
export const IDLE_PREFETCH_PATHS = [
  '/nodes',
  '/enc',
  '/reports',
  '/certificates',
  '/deployment',
  '/insights',
];

const started = new Set<string>();

export function resetPrefetchState(): void {
  started.clear();
}

export function loaderForPath(path: string): RouteLoader | undefined {
  if (!path) return undefined;
  return ROUTE_LOADERS.find((l) => l.match(path));
}

/** Start the matching chunk download once. Safe to call from hover/focus. */
export function prefetchRoute(path: string): string | null {
  const loader = loaderForPath(path);
  if (!loader) return null;
  if (started.has(loader.id)) return loader.id;
  started.add(loader.id);
  void loader.load().catch(() => {
    started.delete(loader.id);
  });
  return loader.id;
}

export function prefetchIdleRoutes(): void {
  const run = () => {
    for (const path of IDLE_PREFETCH_PATHS) prefetchRoute(path);
  };
  if (typeof window === 'undefined') return;
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1200);
  }
}
