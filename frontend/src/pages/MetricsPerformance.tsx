/**
 * OpenVox GUI - MetricsPerformance.tsx
 *
 * Run Performance — 10 charts in a thumbnail grid (2 per row).
 * Click any chart to expand it full-width. Click again to collapse.
 * Combines agent-side metrics (from PuppetDB reports) with server-side
 * metrics (from PuppetDB Jolokia/JMX).
 */
import { useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper, Select, Button,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconChartLine, IconArrowsMaximize, IconArrowsMinimize, IconRefresh, IconTrash } from '@tabler/icons-react';
import { downsampleSeries } from '../utils/chartDefaults';
import { performance as perfApi, metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63', '#95a5a6'];

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 } as const,
  itemStyle: { color: '#e0e0e0' } as const,
};

const formatSeconds = (v: number) => {
  if (v >= 60) return `${(v / 60).toFixed(1)}m`;
  return `${v.toFixed(1)}s`;
};
const formatMs = (v: number) => {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  if (v >= 10) return `${v.toFixed(0)}ms`;
  if (v >= 1) return `${v.toFixed(1)}ms`;
  if (v >= 0.01) return `${(v * 1000).toFixed(0)}µs`;
  return `${v.toFixed(2)}ms`;
};
const shortName = (cn: string) => {
  if (cn.length <= 22) return cn;
  const parts = cn.split('.');
  return parts[0].length <= 20 ? parts[0] : parts[0].substring(0, 18) + '...';
};
const tickTime = (v: string) => {
  const s = String(v || '');
  if (s.includes('T')) return s.split('T')[1]?.substring(0, 5) || s;
  return s.slice(11, 16) || s;
};

// Extract a simple value from a Jolokia metric response
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
    return 0;
  }
  return 0;
}

interface ChartPanelProps {
  title: string;
  expanded: boolean;
  onClick: () => void;
  children: ReactNode;
  stats?: Array<{ label: string; value: string; color?: string }>;
}

function ChartPanel({ title, expanded, onClick, children, stats }: ChartPanelProps) {
  const height = expanded ? 450 : 200;
  return (
    <Card withBorder shadow="sm" padding="sm" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
      onClick={onClick}>
      <Group justify="space-between" mb={4}>
        <Text size={expanded ? 'md' : 'sm'} fw={700}>{title}</Text>
        {expanded ? <IconArrowsMinimize size={14} color="#8899aa" /> : <IconArrowsMaximize size={14} color="#8899aa" />}
      </Group>
      {stats && expanded && (
        <Group gap="xs" mb="xs">
          {stats.map((s, i) => (
            <Badge key={i} size="sm" variant="light" color={s.color || 'blue'}>{s.label}: {s.value}</Badge>
          ))}
        </Group>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children as any}
      </ResponsiveContainer>
    </Card>
  );
}

const SERVER_HISTORY_KEY = 'openvox_perf_server_history';
const MAX_SERVER_POINTS = 120;

const HISTORY_VERSION = 3; // Bump when new fields are added to force a reset

function loadServerHistory(): any[] {
  try {
    const ver = localStorage.getItem(SERVER_HISTORY_KEY + '_v');
    if (ver !== String(HISTORY_VERSION)) {
      localStorage.removeItem(SERVER_HISTORY_KEY);
      localStorage.setItem(SERVER_HISTORY_KEY + '_v', String(HISTORY_VERSION));
      return [];
    }
    const raw = localStorage.getItem(SERVER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveServerHistory(pts: any[]) {
  try { localStorage.setItem(SERVER_HISTORY_KEY, JSON.stringify(pts)); } catch {}
}

const REFRESH_OPTIONS = [
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '0', label: 'Off' },
];

/** embedded: compact chrome for Insights | Monitoring wallboard (same charts/data as full page).
 *  windowHours: lookback for agent run trends (API); live JMX history still accumulates while open.
 */
export function MetricsPerformancePage({
  embedded = false,
  windowHours,
}: { embedded?: boolean; windowHours?: number } = {}) {
  const [perfData, setPerfData] = useState<any>(null);
  const [serverData, setServerData] = useState<any>(null);
  const [serverHistory, setServerHistory] = useState<any[]>(loadServerHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 30s default — charts re-render is expensive; cache on API is ~30s anyway
  const [refreshRate, setRefreshRate] = useState<string>('30');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const initialLoadDone = useRef(false);
  const hoursNum =
    windowHours != null && Number.isFinite(windowHours)
      ? Math.min(168, Math.max(0.25, Number(windowHours)))
      : 48;

  const fetchData = useCallback(async () => {
    try {
      // Only block the page on the *first* load. Polls update in place so
      // Recharts is not unmounted/remounted (huge snappiness win).
      if (!initialLoadDone.current) setLoading(true);
      const [perf, server] = await Promise.all([
        perfApi.getOverview(hoursNum),
        metrics.puppetdbPerformance().catch(() => null),
      ]);
      setPerfData(perf);
      setServerData(server);
      initialLoadDone.current = true;
      // Accumulate server metrics history for time-series charts
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
        point.queue_depth = Number(server.cmd_depth?.Count) || 0;
        point.write_active = Number(server.write_pool_active?.Value) || 0;
        point.write_idle = Number(server.write_pool_idle?.Value) || 0;
        point.read_active = Number(server.read_pool_active?.Value) || 0;
        point.read_idle = Number(server.read_pool_idle?.Value) || 0;
        point.write_pending = Number(server.write_pool_pending?.Value) || 0;
        point.read_pending = Number(server.read_pool_pending?.Value) || 0;
        point.hash_match_ms = Number(server.catalog_hash_match?.Mean) / 1000 || 0;
        point.hash_miss_ms = Number(server.catalog_hash_miss?.Mean) / 1000 || 0;
        point.dedup_pct = (Number(server.dedup_pct?.Value) || 0) * 100;
        point.gc_young_count = Number(server.gc_young?.CollectionCount) || 0;
        point.gc_young_time = Number(server.gc_young?.CollectionTime) || 0;
        point.gc_old_count = Number(server.gc_old?.CollectionCount) || 0;
        point.gc_old_time = Number(server.gc_old?.CollectionTime) || 0;
        point.nodes = Number(server.population_nodes?.Value) || 0;
        point.resources = Number(server.population_resources?.Value) || 0;
        point.avg_resources = Number(server.population_avg_resources?.Value) || 0;
        setServerHistory(prev => {
          const updated = [...prev, point];
          const trimmed = updated.length > MAX_SERVER_POINTS ? updated.slice(-MAX_SERVER_POINTS) : updated;
          saveServerHistory(trimmed);
          return trimmed;
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load performance data');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [hoursNum]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh at configurable rate
  useEffect(() => {
    const rate = parseInt(refreshRate) * 1000;
    if (rate <= 0) return;
    const interval = setInterval(fetchData, rate);
    return () => clearInterval(interval);
  }, [fetchData, refreshRate]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

  if (loading && !perfData) return <Center h={embedded ? 200 : 400}><Loader size={embedded ? 'md' : 'xl'} /></Center>;
  if (error && !perfData) return <Alert color="red" title="Error">{String(error)}</Alert>;
  if (!perfData) return null;

  // Catch render errors from bad JMX data
  try {
    return <MetricsPerformanceContent embedded={embedded} perfData={perfData} serverData={serverData} serverHistory={serverHistory} expanded={expanded} toggleExpand={toggleExpand} refreshRate={refreshRate} setRefreshRate={setRefreshRate} lastRefresh={lastRefresh} fetchData={fetchData} clearHistory={() => { setServerHistory([]); saveServerHistory([]); localStorage.setItem(SERVER_HISTORY_KEY + '_v', String(HISTORY_VERSION)); }} />;
  } catch (e: any) {
    return <Alert color="red" title="Render Error">{String(e?.message || e)}</Alert>;
  }
}

function MetricsPerformanceContent({ embedded = false, perfData, serverData, serverHistory, expanded, toggleExpand, refreshRate, setRefreshRate, lastRefresh, fetchData, clearHistory }: { embedded?: boolean; perfData: any; serverData: any; serverHistory: any[]; expanded: string | null; toggleExpand: (id: string) => void; refreshRate: string; setRefreshRate: (v: string) => void; lastRefresh: Date; fetchData: () => void; clearHistory: () => void }) {

  // Agent-side data — stride + cap before Recharts bind
  const rawTrends = perfData.run_time_trends || [];
  const trends = downsampleSeries(
    rawTrends.filter((_: any, i: number) => i % 2 === 0).slice(-240),
    120,
  );
  // Live JMX series can grow; bind a downsampled view so 10+ charts stay cheap
  const serverHistoryChart = useMemo(
    () => downsampleSeries(serverHistory, 120),
    [serverHistory],
  );
  const nodeComparison = (perfData.node_comparison || [])
    .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
    .slice(0, 10);
  const stats = perfData.stats || {};

  const top10Names = nodeComparison.map((n: any) => n.certname);
  const top10Data = useMemo(() => {
    // Bucket by hour and average per node for smooth display
    const hourBuckets: Record<string, Record<string, number[]>> = {};
    for (const run of (perfData.run_time_trends || [])) {
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
  }, [perfData, top10Names]);

  // Server-side data — safely default all fields to prevent render crashes
  const s: Record<string, any> = {};
  if (serverData && typeof serverData === 'object') {
    for (const [k, v] of Object.entries(serverData)) {
      s[k] = v;
    }
  }

  // Build server metric bars for storage timing
  const storageData = [
    { name: 'Catalog', mean: jmxVal(s.store_catalog, 'Mean') / 1000 },
    { name: 'Facts', mean: jmxVal(s.store_facts, 'Mean') / 1000 },
    { name: 'Report', mean: jmxVal(s.store_report, 'Mean') / 1000 },
  ].filter(d => d.mean > 0);

  // DB pool data
  const poolData = [
    { name: 'Write Active', value: Number(jmxVal(s.write_pool_active, 'Value')) || 0 },
    { name: 'Write Idle', value: Number(jmxVal(s.write_pool_idle, 'Value')) || 0 },
    { name: 'Write Pending', value: Number(jmxVal(s.write_pool_pending, 'Value')) || 0 },
    { name: 'Read Active', value: Number(jmxVal(s.read_pool_active, 'Value')) || 0 },
    { name: 'Read Idle', value: Number(jmxVal(s.read_pool_idle, 'Value')) || 0 },
    { name: 'Read Pending', value: Number(jmxVal(s.read_pool_pending, 'Value')) || 0 },
  ];

  // Command processing data
  const cmdData = [
    { name: 'Catalog', mean: Number(jmxVal(s.catalog_processing, 'Mean')) / 1000 || 0, p95: Number(s.catalog_processing?.['95thPercentile'] ?? 0) / 1000 || 0 },
    { name: 'Facts', mean: Number(jmxVal(s.facts_processing, 'Mean')) / 1000 || 0, p95: Number(s.facts_processing?.['95thPercentile'] ?? 0) / 1000 || 0 },
    { name: 'Report', mean: Number(jmxVal(s.report_processing, 'Mean')) / 1000 || 0, p95: Number(s.report_processing?.['95thPercentile'] ?? 0) / 1000 || 0 },
  ].filter(d => d.mean > 0);

  // HTTP latency — may not be available (returns error object on some PuppetDB versions)
  const httpData = [
    { name: 'Query API', mean: jmxVal(s.http_query_time, 'Mean'), p95: Number(s.http_query_time?.['95thPercentile']) || 0 },
    { name: 'Command API', mean: jmxVal(s.http_cmd_time, 'Mean'), p95: Number(s.http_cmd_time?.['95thPercentile']) || 0 },
  ].filter(d => d.mean > 0);

  // Define all 10 chart panels
  const charts: Array<{ id: string; title: string; stats?: any[]; render: (h: number) => ReactNode }> = [
    {
      id: 'run-trends', title: 'Run Duration Trends',
      stats: [{ label: 'Avg', value: formatSeconds(stats.avg_run_time || 0) }, { label: 'Max', value: formatSeconds(stats.max_run_time || 0), color: 'red' }],
      render: () => (
        <AreaChart data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs><linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.3}/><stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={tickTime} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="total" stroke="#0D6EFD" fill="url(#gT)" strokeWidth={2} dot={false} name="Total" />
        </AreaChart>
      ),
    },
    {
      id: 'phase-breakdown', title: 'Timing Phase Breakdown',
      render: () => (
        <AreaChart data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={tickTime} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Fact Gen" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} dot={false} name="Plugin Sync" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} dot={false} name="Config Retrieval" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1.5} dot={false} name="Catalog Apply" />
        </AreaChart>
      ),
    },
    {
      id: 'top10-nodes', title: 'Top 10 Slowest Nodes',
      render: () => (
        <AreaChart data={top10Data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={tickTime} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {nodeComparison.map((n: any, i: number) => (
            <Area isAnimationActive={false} animationDuration={0} key={n.certname} type="natural" dataKey={n.certname}
              stroke={COLORS[i % COLORS.length]} fill="none" strokeWidth={1.5}
              dot={false} connectNulls name={shortName(n.certname)} />
          ))}
        </AreaChart>
      ),
    },
    {
      id: 'cmd-processing', title: 'Command Processing Time',
      stats: cmdData.map(d => ({ label: d.name, value: String(formatMs(d.mean)), color: 'cyan' })),
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} dot={false} name="Catalog" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} dot={false} name="Facts" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="report_ms" stroke="#e67e22" fill="none" strokeWidth={2} dot={false} name="Report" />
        </AreaChart>
      ),
    },
    {
      id: 'storage-timing', title: 'Storage Operation Timing',
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="store_catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} dot={false} name="Catalog" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="store_facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} dot={false} name="Facts" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="store_report_ms" stroke="#e67e22" fill="none" strokeWidth={2} dot={false} name="Report" />
        </AreaChart>
      ),
    },
    {
      id: 'db-pool', title: 'Database Connection Pool',
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} allowDecimals={false} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="write_active" stroke="#e74c3c" fill="none" strokeWidth={2} dot={false} name="Write Active" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="write_idle" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Write Idle" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="read_active" stroke="#0D6EFD" fill="none" strokeWidth={2} dot={false} name="Read Active" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="read_idle" stroke="#1abc9c" fill="none" strokeWidth={1.5} dot={false} name="Read Idle" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="write_pending" stroke="#f39c12" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Write Pending" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="read_pending" stroke="#9b59b6" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Read Pending" />
        </AreaChart>
      ),
    },
    {
      id: 'http-latency', title: 'HTTP API Latency',
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="http_query_ms" stroke="#3498db" fill="none" strokeWidth={2} dot={false} name="Query API" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="http_cmd_ms" stroke="#e74c3c" fill="none" strokeWidth={2} dot={false} name="Command API" />
        </AreaChart>
      ),
    },
    {
      id: 'catalog-dedup', title: 'Catalog Deduplication',
      stats: [{ label: 'Dedup Rate', value: `${(Number(jmxVal(s.dedup_pct, 'Value') || 0) * 100).toFixed(1)}%`, color: 'green' }],
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="hash_match_ms" stroke="#2ecc71" fill="none" strokeWidth={2} dot={false} name="Hash Match" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="hash_miss_ms" stroke="#e74c3c" fill="none" strokeWidth={2} dot={false} name="Hash Miss" />
        </AreaChart>
      ),
    },
    {
      id: 'gc-pressure', title: 'GC Pressure',
      stats: [
        { label: 'Young GC', value: `${Number(jmxVal(s.gc_young, 'CollectionCount')) || 0} collections`, color: 'cyan' },
        { label: 'Old GC', value: `${Number(jmxVal(s.gc_old, 'CollectionCount')) || 0} collections`, color: 'orange' },
      ],
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="gc_young_count" stroke="#3498db" fill="none" strokeWidth={2} dot={false} name="Young Gen Collections" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="gc_old_count" stroke="#e67e22" fill="none" strokeWidth={2} dot={false} name="Old Gen Collections" />
        </AreaChart>
      ),
    },
    {
      id: 'population', title: 'Fleet Population',
      stats: [
        { label: 'Nodes', value: `${Number(jmxVal(s.population_nodes, 'Value')) || 0}` },
        { label: 'Resources', value: `${Number(jmxVal(s.population_resources, 'Value')) || 0}` },
        { label: 'Avg/Node', value: `${(Number(jmxVal(s.population_avg_resources, 'Value')) || 0).toFixed(0)}` },
      ],
      render: () => (
        <AreaChart data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="nodes" stroke="#0D6EFD" fill="none" strokeWidth={2} dot={false} name="Nodes" />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="avg_resources" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Avg Resources/Node" />
        </AreaChart>
      ),
    },
  ];

  return (
    <Stack gap={embedded ? 'sm' : 'md'}>
      <Group justify="space-between">
        <Group gap="sm">
          <IconChartLine size={embedded ? 22 : 28} />
          <Title order={embedded ? 3 : 2}>Run Performance</Title>
          <Badge variant="light" color="blue" size="lg">{stats.total_runs || 0} runs / {stats.total_nodes || 0} nodes</Badge>
        </Group>
        <Group gap="xs">
          <Select size="xs" data={REFRESH_OPTIONS} value={refreshRate}
            onChange={(v) => setRefreshRate(v || '15')} style={{ width: 120 }} />
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />}
            onClick={fetchData}>Refresh</Button>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconTrash size={14} />}
            onClick={clearHistory}>
            Clear History
          </Button>
          <Text size="xs" c="dimmed">{lastRefresh.toLocaleTimeString()}</Text>
        </Group>
      </Group>

      {/* Stat cards */}
      <Group grow>
        <Paper withBorder p="sm" ta="center"><Text size="xs" c="dimmed">Avg Run</Text><Text size="lg" fw={700}>{formatSeconds(stats.avg_run_time || 0)}</Text></Paper>
        <Paper withBorder p="sm" ta="center"><Text size="xs" c="dimmed">Max Run</Text><Text size="lg" fw={700} c="red">{formatSeconds(stats.max_run_time || 0)}</Text></Paper>
        <Paper withBorder p="sm" ta="center"><Text size="xs" c="dimmed">Min Run</Text><Text size="lg" fw={700} c="green">{formatSeconds(stats.min_run_time || 0)}</Text></Paper>
        <Paper withBorder p="sm" ta="center"><Text size="xs" c="dimmed">Failed</Text><Text size="lg" fw={700} c={stats.failed_runs > 0 ? 'red' : 'green'}>{stats.failed_runs || 0}</Text></Paper>
        <Paper withBorder p="sm" ta="center"><Text size="xs" c="dimmed">Queue</Text><Text size="lg" fw={700}>{String(jmxVal(s.cmd_depth, 'Count'))}</Text></Paper>
      </Group>

      {/* Chart grid — 2 per row, expandable */}
      {expanded ? (
        // Expanded view — single chart full width
        (() => {
          const chart = charts.find(c => c.id === expanded);
          if (!chart) return null;
          return (
            <ChartPanel title={chart.title} expanded={true} onClick={() => toggleExpand(chart.id)} stats={chart.stats}>
              {chart.render(450)}
            </ChartPanel>
          );
        })()
      ) : (
        // Grid view — 2 per row
        <Grid>
          {charts.map(chart => (
            <Grid.Col key={chart.id} span={6}>
              <ChartPanel title={chart.title} expanded={false} onClick={() => toggleExpand(chart.id)} stats={chart.stats}>
                {chart.render(200)}
              </ChartPanel>
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
