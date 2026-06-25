/**
 * Configurable multi-GRAPH monitoring wallboard (NOC / ops).
 * Select which Recharts panels appear; scroll for many; click a graph to expand.
 * Reuses the same data sources as Dashboard, Compliance, Run Performance,
 * OpenVox Server Health, and OpenVoxDB Health — not KPI tiles alone.
 */
import { useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Stack, Group, Card, Grid, Badge, Button, MultiSelect,
  Switch, Select, Loader, Center, Alert, ActionIcon, Tooltip, ThemeIcon,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconSettings, IconRefresh, IconExternalLink,
  IconChartBar, IconArrowsMaximize, IconArrowsMinimize,
} from '@tabler/icons-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { dashboard, metrics, performance as perfApi } from '../services/api';

const GRAPHS_KEY = 'openvox-gui-monitor-graphs-v2';
const REFRESH_KEY = 'openvox-gui-monitor-refresh-v2';
const PERF_HIST_KEY = 'openvox_perf_server_history';
const PS_HIST_KEY = 'openvox_ps_health_history';
const PDB_HIST_KEY = 'openvox_pdb_heap_history';
const MAX_HIST = 360;

const COLORS = ['#0D6EFD', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];

const TT = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 12,
    color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff' } as const,
  itemStyle: { color: '#e0e0e0' } as const,
};

type GraphId =
  | 'fleet_status_trends'
  | 'compliance_trend'
  | 'compliance_dist'
  | 'run_duration_trends'
  | 'timing_phase_breakdown'
  | 'top10_slowest'
  | 'cmd_processing'
  | 'storage_timing'
  | 'db_pool'
  | 'http_latency'
  | 'catalog_dedup'
  | 'gc_pressure_pdb'
  | 'fleet_population'
  | 'ps_heap'
  | 'ps_nonheap'
  | 'ps_catalog_route'
  | 'ps_report_route'
  | 'ps_gc_young'
  | 'ps_gc_old'
  | 'ps_cpu'
  | 'ps_fds'
  | 'pdb_heap'
  | 'pdb_queue'
  | 'pdb_catalog_save'
  | 'pdb_report_process';

type GraphSource = 'dash' | 'compliance' | 'perf' | 'ps' | 'pdb';

type GraphDef = {
  id: GraphId;
  label: string;
  group: string;
  sources: GraphSource[];
  detailPath: string;
  defaultOn: boolean;
};

/** Every entry is a real time-series / chart — not a stat tile */
const GRAPH_CATALOG: GraphDef[] = [
  { id: 'fleet_status_trends', label: 'Fleet node status trends', group: 'Fleet', sources: ['dash'], detailPath: '/', defaultOn: true },
  { id: 'compliance_trend', label: 'Compliance trend (24h)', group: 'Fleet', sources: ['compliance'], detailPath: '/insights/compliance', defaultOn: true },
  { id: 'compliance_dist', label: 'Compliance distribution (bar)', group: 'Fleet', sources: ['compliance'], detailPath: '/insights/compliance', defaultOn: true },
  { id: 'run_duration_trends', label: 'Run duration trends', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: true },
  { id: 'timing_phase_breakdown', label: 'Timing phase breakdown', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: true },
  { id: 'top10_slowest', label: 'Top 10 slowest nodes', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'cmd_processing', label: 'Command processing time (PDB)', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: true },
  { id: 'storage_timing', label: 'Storage operation timing', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'db_pool', label: 'Database connection pool', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: true },
  { id: 'http_latency', label: 'HTTP API latency (PDB)', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'catalog_dedup', label: 'Catalog deduplication timing', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'gc_pressure_pdb', label: 'GC collections (PDB JMX)', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'fleet_population', label: 'Fleet population (nodes / resources)', group: 'Run Performance', sources: ['perf'], detailPath: '/insights/performance', defaultOn: false },
  { id: 'ps_heap', label: 'OpenVox Server JVM heap', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: true },
  { id: 'ps_nonheap', label: 'OpenVox Server non-heap', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: false },
  { id: 'ps_catalog_route', label: 'Server catalog route mean (ms)', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: true },
  { id: 'ps_report_route', label: 'Server report route mean (ms)', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: false },
  { id: 'ps_gc_young', label: 'Server GC young gen time', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: false },
  { id: 'ps_gc_old', label: 'Server GC old gen time', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: false },
  { id: 'ps_cpu', label: 'Server process CPU load', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: true },
  { id: 'ps_fds', label: 'Server open file descriptors', group: 'OpenVox Server', sources: ['ps'], detailPath: '/insights/openvox-server-health', defaultOn: false },
  { id: 'pdb_heap', label: 'OpenVoxDB JVM heap', group: 'OpenVoxDB', sources: ['pdb'], detailPath: '/insights/openvoxdb-health', defaultOn: true },
  { id: 'pdb_queue', label: 'OpenVoxDB command queue depth', group: 'OpenVoxDB', sources: ['pdb'], detailPath: '/insights/openvoxdb-health', defaultOn: true },
  { id: 'pdb_catalog_save', label: 'PDB catalog_save mean (ms)', group: 'OpenVoxDB', sources: ['pdb'], detailPath: '/insights/openvoxdb-health', defaultOn: false },
  { id: 'pdb_report_process', label: 'PDB report_process mean (ms)', group: 'OpenVoxDB', sources: ['pdb'], detailPath: '/insights/openvoxdb-health', defaultOn: false },
];

const DEFAULT_GRAPH_IDS = GRAPH_CATALOG.filter((g) => g.defaultOn).map((g) => g.id);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore quota */
  }
}

function loadGraphIds(): GraphId[] {
  const parsed = loadJson<string[]>(GRAPHS_KEY, DEFAULT_GRAPH_IDS);
  const valid = new Set(GRAPH_CATALOG.map((g) => g.id));
  const ids = parsed.filter((id) => valid.has(id as GraphId)) as GraphId[];
  // Migrate away from v1 tile-only preferences
  if (!ids.length) return [...DEFAULT_GRAPH_IDS];
  return ids;
}

function jmxVal(obj: any, attr?: string): number {
  if (obj == null) return 0;
  if (typeof obj === 'number') return obj;
  if (attr && typeof obj === 'object') {
    const v = obj[attr];
    return typeof v === 'number' ? v : 0;
  }
  if (typeof obj === 'object') {
    for (const key of ['Mean', 'Value', 'Count', 'FiveMinuteRate']) {
      const v = obj[key];
      if (typeof v === 'number') return v;
    }
  }
  return 0;
}

function formatSeconds(v: number) {
  if (v >= 60) return `${(v / 60).toFixed(1)}m`;
  return `${(v || 0).toFixed(1)}s`;
}

function formatMs(v: number) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  if (v >= 10) return `${v.toFixed(0)}ms`;
  return `${(v || 0).toFixed(1)}ms`;
}

function tickTime(v: string) {
  const s = String(v || '');
  if (!s || s.length < 4) return s;
  // Hour buckets from API: "2026-06-25T16" or full ISO "2026-06-25T16:30:00Z"
  const hourOnly = s.match(/T(\d{2})$/);
  if (hourOnly) return `${hourOnly[1]}:00`;
  const hm = s.match(/T(\d{2}:\d{2})/);
  if (hm) return hm[1];
  if (s.includes('T')) return s.split('T')[1]?.substring(0, 5) || s;
  return s.length > 10 ? s.substring(11, 16) : s;
}

function shortName(cn: string) {
  if (cn.length <= 22) return cn;
  const parts = cn.split('.');
  return parts[0].length <= 20 ? parts[0] : `${parts[0].substring(0, 18)}...`;
}

function GraphFrame({
  title,
  expanded,
  onToggle,
  detailPath,
  onOpenDetail,
  children,
  height,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  detailPath: string;
  onOpenDetail: (p: string) => void;
  children: ReactNode;
  height: number;
}) {
  return (
    <Card
      withBorder
      shadow="sm"
      padding="sm"
      style={{ cursor: 'pointer', transition: 'all 0.15s' }}
      onClick={onToggle}
    >
      <Group justify="space-between" mb={4} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
        <Text size={expanded ? 'md' : 'sm'} fw={700} style={{ cursor: 'pointer' }} onClick={onToggle}>
          {title}
        </Text>
        <Group gap={4}>
          <Tooltip label="Open full Insights page">
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(detailPath);
              }}
            >
              <IconExternalLink size={14} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon size="sm" variant="subtle" onClick={onToggle}>
            {expanded ? <IconArrowsMinimize size={14} /> : <IconArrowsMaximize size={14} />}
          </ActionIcon>
        </Group>
      </Group>
      <div onClick={onToggle}>
        <ResponsiveContainer width="100%" height={height}>
          {children as any}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function MonitoringDashboardPage() {
  const navigate = useNavigate();
  const [graphIds, setGraphIds] = useState<GraphId[]>(() => loadGraphIds());
  const [configureOpen, setConfigureOpen] = useState(false);
  const [expanded, setExpanded] = useState<GraphId | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(() => loadJson(REFRESH_KEY + '-auto', true));
  const [refreshSec, setRefreshSec] = useState(() => loadJson(REFRESH_KEY + '-sec', '15'));
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashData, setDashData] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [perfData, setPerfData] = useState<any>(null);
  const [perfServerHist, setPerfServerHist] = useState<any[]>(() => loadJson(PERF_HIST_KEY, []));
  const [psHist, setPsHist] = useState<any[]>(() => loadJson(PS_HIST_KEY, []));
  const [pdbHist, setPdbHist] = useState<any[]>(() => loadJson(PDB_HIST_KEY, []));

  const enabled = useMemo(() => new Set(graphIds), [graphIds]);
  const neededSources = useMemo(() => {
    const s = new Set<GraphSource>();
    for (const g of GRAPH_CATALOG) {
      if (enabled.has(g.id)) g.sources.forEach((x) => s.add(x));
    }
    return s;
  }, [enabled]);

  const persistGraphs = (ids: GraphId[]) => {
    setGraphIds(ids);
    saveJson(GRAPHS_KEY, ids);
  };

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const tasks: Promise<void>[] = [];

      if (neededSources.has('dash')) {
        tasks.push(dashboard.getData().then(setDashData));
      }
      if (neededSources.has('compliance')) {
        tasks.push(metrics.compliance(24).then(setCompliance));
      }
      if (neededSources.has('perf')) {
        tasks.push(
          (async () => {
            const [perf, server] = await Promise.all([
              perfApi.getOverview(),
              metrics.puppetdbPerformance().catch(() => null),
            ]);
            setPerfData(perf);
            if (server) {
              const point: any = { time: new Date().toLocaleTimeString() };
              point.catalog_ms = Number(server.catalog_processing?.Mean) || 0;
              point.facts_ms = Number(server.facts_processing?.Mean) || 0;
              point.report_ms = Number(server.report_processing?.Mean) || 0;
              point.store_catalog_ms = Number(server.store_catalog?.Mean) / 1000 || 0;
              point.store_facts_ms = Number(server.store_facts?.Mean) / 1000 || 0;
              point.store_report_ms = Number(server.store_report?.Mean) / 1000 || 0;
              point.http_query_ms = Number(server.http_query_time?.Mean) || 0;
              point.http_cmd_ms = Number(server.http_cmd_time?.Mean) || 0;
              point.write_active = Number(server.write_pool_active?.Value) || 0;
              point.write_idle = Number(server.write_pool_idle?.Value) || 0;
              point.read_active = Number(server.read_pool_active?.Value) || 0;
              point.read_idle = Number(server.read_pool_idle?.Value) || 0;
              point.write_pending = Number(server.write_pool_pending?.Value) || 0;
              point.read_pending = Number(server.read_pool_pending?.Value) || 0;
              point.hash_match_ms = Number(server.catalog_hash_match?.Mean) / 1000 || 0;
              point.hash_miss_ms = Number(server.catalog_hash_miss?.Mean) / 1000 || 0;
              point.gc_young_count = Number(server.gc_young?.CollectionCount) || 0;
              point.gc_old_count = Number(server.gc_old?.CollectionCount) || 0;
              point.nodes = Number(server.population_nodes?.Value) || 0;
              point.avg_resources = Number(server.population_avg_resources?.Value) || 0;
              setPerfServerHist((prev) => {
                const updated = [...prev, point].slice(-MAX_HIST);
                saveJson(PERF_HIST_KEY, updated);
                return updated;
              });
            }
          })()
        );
      }
      if (neededSources.has('ps')) {
        tasks.push(
          metrics.puppetserverHealth().then((result) => {
            if (result?.history?.length) {
              const mapped = result.history.map((p: any) => ({
                time: p.time,
                heap_used_mb: p.heap_used_mb,
                nonheap_used_mb: p.nonheap_used_mb,
                http_catalog_mean: p.http_catalog_mean,
                http_report_mean: p.http_report_mean,
                gc_young_time: p.gc_young_time,
                gc_old_time: p.gc_old_time,
                process_cpu_load: p.process_cpu_load,
                open_fds: p.open_fds,
              }));
              const trimmed = mapped.slice(-MAX_HIST);
              setPsHist(trimmed);
              saveJson(PS_HIST_KEY, trimmed);
              return;
            }
            const point = {
              time: new Date().toLocaleTimeString(),
              heap_used_mb: result?.jvm_heap?.used_mb,
              nonheap_used_mb: result?.jvm_nonheap?.used_mb,
              http_catalog_mean: result?.http_catalog_mean ?? result?.http?.catalog_mean,
              http_report_mean: result?.http_report_mean ?? result?.http?.report_mean,
              gc_young_time: result?.gc_young?.time_ms,
              gc_old_time: result?.gc_old?.time_ms,
              process_cpu_load: result?.os?.process_cpu_load,
              open_fds: result?.os?.open_file_descriptors,
            };
            setPsHist((prev) => {
              const updated = [...prev, point].slice(-MAX_HIST);
              saveJson(PS_HIST_KEY, updated);
              return updated;
            });
          }).catch(() => { /* leave prior history */ })
        );
      }
      if (neededSources.has('pdb')) {
        tasks.push(
          metrics.puppetdbHealth().then((result) => {
            const jvm = result.jvm_heap || {};
            const pdbm = result.ps_puppetdb_metrics || [];
            const findMean = (arr: any[], key: string) =>
              arr.find((x: any) => (x.metric || '').includes(key))?.mean;
            const point = {
              time: new Date().toLocaleTimeString(),
              used_mb: jvm.used_mb ?? 0,
              queue_depth: result.queue_depth ?? 0,
              catalog_save_mean: findMean(pdbm, 'catalog_save'),
              report_process_mean: findMean(pdbm, 'report_process'),
            };
            setPdbHist((prev) => {
              const updated = [...prev, point].slice(-MAX_HIST);
              saveJson(PDB_HIST_KEY, updated);
              return updated;
            });
          }).catch(() => { /* leave prior history */ })
        );
      }

      await Promise.all(tasks);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load monitoring graphs');
    } finally {
      setLoading(false);
    }
  }, [neededSources]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const ms = Math.max(5, parseInt(String(refreshSec), 10) || 15) * 1000;
    const t = setInterval(fetchAll, ms);
    return () => clearInterval(t);
  }, [autoRefresh, refreshSec, fetchAll]);

  useEffect(() => {
    saveJson(REFRESH_KEY + '-auto', autoRefresh);
    saveJson(REFRESH_KEY + '-sec', refreshSec);
  }, [autoRefresh, refreshSec]);

  const nodeTrends = (dashData?.node_trends || []).map((trend: any) => ({
    timestamp: trend.timestamp,
    unchanged: trend.unchanged || 0,
    changed: trend.changed || 0,
    failed: trend.failed || 0,
    noop: trend.noop || 0,
    unreported: trend.unreported || 0,
  }));

  // Trend timestamps are hour buckets like "2026-06-25T16" (not full ISO) — never Date.parse.
  const complianceTrend = compliance?.trend || [];

  const complianceDist = compliance
    ? [
        { name: 'Compliant', value: compliance.compliant || 0, color: '#28a745' },
        { name: 'Drifted', value: compliance.drifted || 0, color: '#fd7e14' },
        { name: 'Failed', value: compliance.failed || 0, color: '#dc3545' },
        { name: 'Noop', value: compliance.noop || 0, color: '#ffc107' },
        { name: 'Unreported', value: compliance.unreported || 0, color: '#6c757d' },
      ].filter((d) => d.value > 0)
    : [];

  const runTrends = useMemo(() => {
    const raw = perfData?.run_time_trends || [];
    return raw.filter((_: any, i: number) => i % 2 === 0).slice(-120);
  }, [perfData]);

  const nodeComparison = useMemo(
    () =>
      (perfData?.node_comparison || [])
        .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
        .slice(0, 10),
    [perfData]
  );

  const top10Data = useMemo(() => {
    const top10Names = nodeComparison.map((n: any) => n.certname);
    const hourBuckets: Record<string, Record<string, number[]>> = {};
    for (const run of perfData?.run_time_trends || []) {
      if (!top10Names.includes(run.certname)) continue;
      const hour = (run.time || '').substring(0, 13);
      if (!hour) continue;
      if (!hourBuckets[hour]) hourBuckets[hour] = {};
      if (!hourBuckets[hour][run.certname]) hourBuckets[hour][run.certname] = [];
      hourBuckets[hour][run.certname].push(run.total);
    }
    return Object.entries(hourBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, nodeRuns]) => {
        const point: any = { time: hour };
        for (const [cn, values] of Object.entries(nodeRuns)) {
          point[cn] = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
        }
        return point;
      });
  }, [perfData, nodeComparison]);

  const multiSelectData = GRAPH_CATALOG.map((g) => ({
    value: g.id,
    label: `[${g.group}] ${g.label}`,
  }));

  const renderChartBody = (id: GraphId): ReactNode => {
    switch (id) {
      case 'fleet_status_trends':
        return (
          <AreaChart data={nodeTrends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="timestamp" type="category" tick={{ fontSize: 9 }} tickFormatter={tickTime} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip
              {...TT}
              labelFormatter={(v) => {
                const s = String(v || '');
                return s.length >= 13 ? `${s.slice(0, 10)} ${tickTime(s)}` : tickTime(s) || s;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="unchanged" stroke="#2ecc71" fill="#2ecc71" fillOpacity={0.12} strokeWidth={1.5} name="Unchanged" />
            <Area type="monotone" dataKey="changed" stroke="#f39c12" fill="#f39c12" fillOpacity={0.1} strokeWidth={1.5} name="Changed" />
            <Area type="monotone" dataKey="failed" stroke="#e74c3c" fill="#e74c3c" fillOpacity={0.1} strokeWidth={2} name="Failed" />
            <Area type="monotone" dataKey="noop" stroke="#3498db" fill="#3498db" fillOpacity={0.08} strokeWidth={1} name="Noop" />
          </AreaChart>
        );
      case 'compliance_trend':
        return (
          <AreaChart data={complianceTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis
              dataKey="timestamp"
              type="category"
              tick={{ fontSize: 9 }}
              tickFormatter={tickTime}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip
              {...TT}
              labelFormatter={(v) => {
                const s = String(v || '');
                return s.length >= 13 ? `${s.slice(0, 10)} ${tickTime(s)}` : tickTime(s) || s;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="compliant" stroke="#28a745" fill="#28a745" fillOpacity={0.12} name="Compliant" />
            <Area type="monotone" dataKey="failed" stroke="#dc3545" fill="#dc3545" fillOpacity={0.1} name="Failed" />
            <Area type="monotone" dataKey="drifted" stroke="#fd7e14" fill="#fd7e14" fillOpacity={0.08} name="Drifted" />
          </AreaChart>
        );
      case 'compliance_dist':
        return (
          <BarChart data={complianceDist} layout="vertical" margin={{ left: 8, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} />
            <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
            <ReTooltip {...TT} />
            <Bar dataKey="value" name="Nodes" radius={[0, 4, 4, 0]}>
              {complianceDist.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        );
      case 'run_duration_trends':
        return (
          <AreaChart data={runTrends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} tickFormatter={tickTime} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36} />
            <ReTooltip {...TT} formatter={(v: number) => [formatSeconds(v), 'Total']} />
            <Area type="natural" dataKey="total" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Total" />
          </AreaChart>
        );
      case 'timing_phase_breakdown':
        return (
          <AreaChart data={runTrends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} tickFormatter={tickTime} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Area type="natural" dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Fact Gen" />
            <Area type="natural" dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} name="Plugin Sync" />
            <Area type="natural" dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} name="Config Retrieval" />
            <Area type="natural" dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1.5} name="Catalog Apply" />
          </AreaChart>
        );
      case 'top10_slowest':
        return (
          <AreaChart data={top10Data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} tickFormatter={tickTime} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
            <Legend wrapperStyle={{ fontSize: 8 }} />
            {nodeComparison.map((n: any, i: number) => (
              <Area
                key={n.certname}
                type="natural"
                dataKey={n.certname}
                stroke={COLORS[i % COLORS.length]}
                fill="none"
                strokeWidth={1.5}
                connectNulls
                name={shortName(n.certname)}
              />
            ))}
          </AreaChart>
        );
      case 'cmd_processing':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Catalog" />
            <Area type="natural" dataKey="facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Facts" />
            <Area type="natural" dataKey="report_ms" stroke="#e67e22" fill="none" strokeWidth={2} name="Report" />
          </AreaChart>
        );
      case 'storage_timing':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="store_catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Catalog" />
            <Area type="natural" dataKey="store_facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Facts" />
            <Area type="natural" dataKey="store_report_ms" stroke="#e67e22" fill="none" strokeWidth={2} name="Report" />
          </AreaChart>
        );
      case 'db_pool':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Area type="natural" dataKey="write_active" stroke="#e74c3c" fill="none" strokeWidth={2} name="Write Active" />
            <Area type="natural" dataKey="write_idle" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Write Idle" />
            <Area type="natural" dataKey="read_active" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Read Active" />
            <Area type="natural" dataKey="read_idle" stroke="#1abc9c" fill="none" strokeWidth={1.5} name="Read Idle" />
          </AreaChart>
        );
      case 'http_latency':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="http_query_ms" stroke="#3498db" fill="none" strokeWidth={2} name="Query API" />
            <Area type="natural" dataKey="http_cmd_ms" stroke="#e74c3c" fill="none" strokeWidth={2} name="Command API" />
          </AreaChart>
        );
      case 'catalog_dedup':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="hash_match_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Hash Match" />
            <Area type="natural" dataKey="hash_miss_ms" stroke="#e74c3c" fill="none" strokeWidth={2} name="Hash Miss" />
          </AreaChart>
        );
      case 'gc_pressure_pdb':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="gc_young_count" stroke="#3498db" fill="none" strokeWidth={2} name="Young GC" />
            <Area type="natural" dataKey="gc_old_count" stroke="#e67e22" fill="none" strokeWidth={2} name="Old GC" />
          </AreaChart>
        );
      case 'fleet_population':
        return (
          <AreaChart data={perfServerHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={36} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="natural" dataKey="nodes" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Nodes" />
            <Area type="natural" dataKey="avg_resources" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Avg resources/node" />
          </AreaChart>
        );
      case 'ps_heap':
        return (
          <AreaChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44} />
            <ReTooltip {...TT} />
            <Area type="natural" dataKey="heap_used_mb" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Heap used MB" />
          </AreaChart>
        );
      case 'ps_nonheap':
        return (
          <AreaChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44} />
            <ReTooltip {...TT} />
            <Area type="natural" dataKey="nonheap_used_mb" stroke="#8e44ad" fill="#8e44ad" fillOpacity={0.12} strokeWidth={2} name="Non-heap MB" />
          </AreaChart>
        );
      case 'ps_catalog_route':
        return (
          <LineChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="http_catalog_mean" stroke="#2980b9" strokeWidth={2} dot={false} name="Catalog route" />
          </LineChart>
        );
      case 'ps_report_route':
        return (
          <LineChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="http_report_mean" stroke="#16a085" strokeWidth={2} dot={false} name="Report route" />
          </LineChart>
        );
      case 'ps_gc_young':
        return (
          <AreaChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Area type="natural" dataKey="gc_young_time" stroke="#3498db" fill="#3498db" fillOpacity={0.12} strokeWidth={2} name="Young GC ms" />
          </AreaChart>
        );
      case 'ps_gc_old':
        return (
          <AreaChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Area type="natural" dataKey="gc_old_time" stroke="#e67e22" fill="#e67e22" fillOpacity={0.12} strokeWidth={2} name="Old GC ms" />
          </AreaChart>
        );
      case 'ps_cpu':
        return (
          <LineChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={36} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="process_cpu_load" stroke="#e74c3c" strokeWidth={2} dot={false} name="CPU load" />
          </LineChart>
        );
      case 'ps_fds':
        return (
          <LineChart data={psHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={40} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="open_fds" stroke="#9b59b6" strokeWidth={2} dot={false} name="Open FDs" />
          </LineChart>
        );
      case 'pdb_heap':
        return (
          <AreaChart data={pdbHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44} />
            <ReTooltip {...TT} />
            <Area type="natural" dataKey="used_mb" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Heap used MB" />
          </AreaChart>
        );
      case 'pdb_queue':
        return (
          <LineChart data={pdbHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="queue_depth" stroke="#e67e22" strokeWidth={2} dot={false} name="Queue depth" />
          </LineChart>
        );
      case 'pdb_catalog_save':
        return (
          <LineChart data={pdbHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="catalog_save_mean" stroke="#2980b9" strokeWidth={2} dot={false} name="catalog_save" />
          </LineChart>
        );
      case 'pdb_report_process':
        return (
          <LineChart data={pdbHist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44} />
            <ReTooltip {...TT} />
            <Line type="natural" dataKey="report_process_mean" stroke="#16a085" strokeWidth={2} dot={false} name="report_process" />
          </LineChart>
        );
      default:
        return (
          <Text size="sm" c="dimmed">
            Unknown graph
          </Text>
        );
    }
  };

  const selectedDefs = GRAPH_CATALOG.filter((g) => enabled.has(g.id));
  const expandedDef = expanded ? GRAPH_CATALOG.find((g) => g.id === expanded) : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Group gap="sm">
            <ThemeIcon size="lg" variant="light" color="teal">
              <IconLayoutDashboard size={22} />
            </ThemeIcon>
            <Title order={2}>Monitoring</Title>
            <Badge variant="light" color="teal">
              {graphIds.length} graphs
            </Badge>
          </Group>
          <Text c="dimmed" size="sm" mt={4} maw={720}>
            NOC wallboard of <strong>real charts</strong> (Recharts) — same series as Run Performance, Server Health,
            OpenVoxDB Health, fleet status, and compliance. Choose which graphs stay on this page; scroll for as many
            as you need. Click a graph to expand full width; external link opens the full Insights page.
          </Text>
        </div>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : '—'}
          </Text>
          <Select
            size="xs"
            w={90}
            data={[
              { value: '5', label: '5s' },
              { value: '10', label: '10s' },
              { value: '15', label: '15s' },
              { value: '30', label: '30s' },
              { value: '60', label: '1m' },
            ]}
            value={String(refreshSec)}
            onChange={(v) => setRefreshSec(v || '15')}
            allowDeselect={false}
          />
          <Switch size="sm" label="Auto" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={loading && !lastRefresh}
            onClick={() => {
              setLoading(true);
              fetchAll();
            }}
          >
            Refresh
          </Button>
          <Button
            size="xs"
            variant={configureOpen ? 'filled' : 'default'}
            leftSection={<IconSettings size={14} />}
            onClick={() => setConfigureOpen((o) => !o)}
          >
            Select graphs
          </Button>
          <Button size="xs" variant="subtle" leftSection={<IconChartBar size={14} />} onClick={() => navigate('/insights/all')}>
            Full pages catalog
          </Button>
        </Group>
      </Group>

      {configureOpen && (
        <Card withBorder padding="md">
          <Text fw={600} mb={4}>
            Graphs on this monitoring page
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Multi-select any combination. Order follows the catalog (Fleet → Run Performance → Server → OpenVoxDB).
            History for JMX-backed series accumulates in this browser while Monitoring (or the source page) is open.
          </Text>
          <MultiSelect
            data={multiSelectData}
            value={graphIds}
            onChange={(vals) => persistGraphs(vals as GraphId[])}
            searchable
            clearable
            maxDropdownHeight={320}
            nothingFoundMessage="No graphs"
            placeholder="Pick graphs to display…"
          />
          <Group mt="sm" gap="xs">
            <Button size="xs" variant="light" onClick={() => persistGraphs([...DEFAULT_GRAPH_IDS])}>
              Reset recommended set
            </Button>
            <Button size="xs" variant="subtle" onClick={() => persistGraphs(GRAPH_CATALOG.map((g) => g.id))}>
              Add all graphs
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={() => persistGraphs([])}>
              Clear all
            </Button>
          </Group>
        </Card>
      )}

      {error && (
        <Alert color="red" title="Monitoring error" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && !lastRefresh && graphIds.length > 0 ? (
        <Center h={320}>
          <Loader size="lg" />
        </Center>
      ) : graphIds.length === 0 ? (
        <Alert color="yellow" title="No graphs selected">
          Click <strong>Select graphs</strong> and choose the charts you want on this wallboard (fleet trends,
          compliance, run performance, server heap, PDB queue, …).
        </Alert>
      ) : (
        <Stack gap="md">
          {expandedDef && (
            <GraphFrame
              title={expandedDef.label}
              expanded
              onToggle={() => setExpanded(null)}
              detailPath={expandedDef.detailPath}
              onOpenDetail={(p) => navigate(p)}
              height={420}
            >
              {renderChartBody(expandedDef.id)}
            </GraphFrame>
          )}

          <Grid gutter="md">
            {selectedDefs
              .filter((g) => g.id !== expanded)
              .map((g) => (
                <Grid.Col key={g.id} span={{ base: 12, md: 6 }}>
                  <GraphFrame
                    title={g.label}
                    expanded={false}
                    onToggle={() => setExpanded(g.id)}
                    detailPath={g.detailPath}
                    onOpenDetail={(p) => navigate(p)}
                    height={220}
                  >
                    {renderChartBody(g.id)}
                  </GraphFrame>
                </Grid.Col>
              ))}
          </Grid>
        </Stack>
      )}
    </Stack>
  );
}
