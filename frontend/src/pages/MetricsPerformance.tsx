/**
 * OpenVox GUI - MetricsPerformance.tsx
 *
 * Run Performance — 10 charts in a thumbnail grid (2 per row).
 * Click any chart to expand it full-width. Click again to collapse.
 * Combines agent-side metrics (from PuppetDB reports) with server-side
 * metrics (from PuppetDB Jolokia/JMX).
 */
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper, Select, Button,
} from '@mantine/core';
import {
  AreaChart, Area, Bar, BarChart, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconChartLine, IconArrowsMaximize, IconArrowsMinimize, IconRefresh, IconTrash } from '@tabler/icons-react';
import {
  CHART_LINE_TYPE,
  chartSizeProps,
  durationTickFormatter,
  downsampleSeries,
  formatDuration,
  jmxGaugePct,
  jmxMean,
  jmxTimerToMs,
  movingAverageSeries,
  prepareDurationOverlay,
  smoothTimeSeries,
} from '../utils/chartDefaults';
import { MeasuredArea } from '../components/MeasuredChart';
import { effectivePollIntervalMs } from '../utils/accessMode';
import { useApi } from '../hooks/useApi';
import { performance as perfApi, metrics } from '../services/api';
import {
  FleetScopeSelect,
  loadStoredScope,
  scopeQuery,
  type ScopeSelection,
} from '../components/FleetScopeSelect';

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
const formatMs = formatDuration;

function DurationOverlayChart({
  data,
  keys,
  names,
  colors,
  width,
  height,
  xLabel = 'Time',
  yLabel = 'Duration',
  snapshot,
}: {
  data: Array<Record<string, unknown>>;
  keys: string[];
  names: string[];
  colors: string[];
  width: number;
  height: number;
  xLabel?: string;
  yLabel?: string;
  snapshot?: Array<{ name: string; mean: number }>;
}) {
  const { rows, maxes, normalized } = prepareDurationOverlay(data, keys);
  const peak = Math.max(0, ...Object.values(maxes));
  const snap = (snapshot || []).filter((d) => d.mean > 0);
  const size = chartSizeProps(width, height);
  const showDots = rows.length < 4;
  // Time series is empty or all-zero — still plot the current Jolokia snapshot
  // so the card is never a blank box on first paint / after Clear History.
  if (peak <= 0 && snap.length) {
    const snapPeak = Math.max(...snap.map((d) => d.mean));
    return (
      <BarChart data={snap} margin={{ top: 8, right: 12, left: 4, bottom: 18 }} {...size}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 9, fill: '#8899aa' }}
          label={{ value: 'Operation', position: 'insideBottom', offset: -2, fill: '#8899aa', fontSize: 9 }}
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#8899aa' }}
          tickFormatter={durationTickFormatter(snapPeak)}
          width={52}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#8899aa', fontSize: 9 }}
        />
        <ReTooltip {...TOOLTIP_STYLE} formatter={((v: number, n: string) => [formatDuration(Number(v)), n]) as any} />
        <Bar isAnimationActive={false} dataKey="mean" fill={colors[0] || '#0D6EFD'} name={yLabel} maxBarSize={36} />
      </BarChart>
    );
  }
  const tickFmt = normalized
    ? (v: number) => `${Math.round(v)}%`
    : durationTickFormatter(peak);
  return (
    <AreaChart
      data={rows}
      margin={{ top: 8, right: 12, left: 4, bottom: 18 }}
      {...size}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
      <XAxis
        dataKey="time"
        tick={{ fontSize: 9, fill: '#8899aa' }}
        label={{ value: xLabel, position: 'insideBottom', offset: -2, fill: '#8899aa', fontSize: 9 }}
      />
      <YAxis
        tick={{ fontSize: 9, fill: '#8899aa' }}
        domain={normalized ? [0, 100] : peak > 0 ? [0, 'auto'] : [0, 1]}
        ticks={normalized ? [0, 25, 50, 75, 100] : undefined}
        tickFormatter={tickFmt}
        width={normalized ? 40 : 52}
        label={{
          value: normalized ? 'Relative duration' : yLabel,
          angle: -90,
          position: 'insideLeft',
          fill: '#8899aa',
          fontSize: 9,
        }}
      />
      <ReTooltip
        {...TOOLTIP_STYLE}
        formatter={((v: number, n: string, item: any) => {
          const key = String(item?.dataKey ?? '');
          const raw = item?.payload?.[`${key}__raw`];
          const ms = typeof raw === 'number' ? raw : v;
          return [formatDuration(Number(ms)), n];
        }) as any}
      />
      <Legend wrapperStyle={{ fontSize: 10 }} />
      {keys.map((k, i) => (
        <Area
          isAnimationActive={false}
          animationDuration={0}
          key={k}
          type={CHART_LINE_TYPE}
          dataKey={k}
          stroke={colors[i % colors.length]}
          fill="none"
          strokeWidth={2}
          dot={showDots ? { r: 3 } : false}
          name={
            maxes[k] > 0
              ? `${names[i]} · max ${formatDuration(maxes[k])}`
              : names[i]
          }
        />
      ))}
    </AreaChart>
  );
}
const shortName = (cn: string) => {
  if (cn.length <= 22) return cn;
  const parts = cn.split('.');
  return parts[0].length <= 20 ? parts[0] : parts[0].substring(0, 18) + '...';
};
/** host.site — unique enough for a rank bar, no FQDN dataKey. */
const barLabel = (cn: string) => {
  const parts = String(cn || '').split('.');
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return shortName(cn);
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
  render: (width: number, height: number) => ReactNode;
  stats?: Array<{ label: string; value: string; color?: string }>;
}

function ChartPanel({ title, expanded, onClick, render, stats }: ChartPanelProps) {
  const height = expanded ? 450 : 200;
  return (
    <Card withBorder shadow="sm" padding="sm" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
      onClick={onClick}>
      <Group justify="space-between" mb={4}>
        <Text size={expanded ? 'md' : 'sm'} fw={700}>{title}</Text>
        {expanded ? <IconArrowsMinimize size={14} color="#8899aa" /> : <IconArrowsMaximize size={14} color="#8899aa" />}
      </Group>
      {stats && stats.length > 0 && (
        <Group gap="xs" mb="xs">
          {stats.map((s, i) => (
            <Badge key={i} size="sm" variant="light" color={s.color || 'blue'}>{s.label}: {s.value}</Badge>
          ))}
        </Group>
      )}
      <MeasuredArea height={height}>
        {(w) => render(w, height)}
      </MeasuredArea>
    </Card>
  );
}

const SERVER_HISTORY_KEY = 'openvox_perf_server_history';
const MAX_SERVER_POINTS = 120;

const HISTORY_VERSION = 6; // size-safe overlay + snapshot fallback

const COUNT_KEYS = new Set([
  'nodes', 'resources', 'queue_depth',
  'write_active', 'write_idle', 'read_active', 'read_idle',
  'write_pending', 'read_pending',
  'gc_young_count', 'gc_old_count',
]);

function carryForward(next: number, prev: number | undefined): number {
  if (Number.isFinite(next) && next > 0) return next;
  if (prev && prev > 0) return prev;
  return Number.isFinite(next) ? next : 0;
}

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
  scope: scopeProp,
  onScopeChange,
}: {
  embedded?: boolean;
  windowHours?: number;
  scope?: ScopeSelection;
  onScopeChange?: (s: ScopeSelection) => void;
} = {}) {
  const [serverHistory, setServerHistory] = useState<any[]>(loadServerHistory);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 30s default — charts re-render is expensive; cache on API is ~30s anyway
  const [refreshRate, setRefreshRate] = useState<string>('30');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [scopeLocal, setScopeLocal] = useState<ScopeSelection>(loadStoredScope);
  const scope = scopeProp ?? scopeLocal;
  const setScope = onScopeChange ?? setScopeLocal;
  const sq = scopeQuery(scope);
  const hoursNum =
    windowHours != null && Number.isFinite(windowHours)
      ? Math.min(168, Math.max(0.25, Number(windowHours)))
      : 48;

  const fetchBundle = useCallback(async () => {
    const [perf, server] = await Promise.all([
      perfApi.getOverview(hoursNum, sq),
      metrics.puppetdbPerformance().catch(() => null),
    ]);
    return { perf, server };
  }, [hoursNum, sq]);

  const { data: bundle, loading, refreshing, error, refetch } = useApi(
    fetchBundle,
    [hoursNum, sq],
    {
      cacheKey: `openvox_metrics_performance_v3_${hoursNum}_${sq}`,
      cacheValidate: (d) => d != null && (d as any).perf != null,
      pollIntervalMs: effectivePollIntervalMs(parseInt(refreshRate, 10) * 1000) ?? undefined,
    },
  );

  const perfData = bundle?.perf ?? null;
  const serverData = bundle?.server ?? null;

  // Accumulate JMX history points whenever a fresh server snapshot arrives
  useEffect(() => {
    if (!serverData) return;
    const server = serverData;
    const point: any = { time: new Date().toLocaleTimeString() };
    point.catalog_ms = jmxMean(server.catalog_processing);
    point.facts_ms = jmxMean(server.facts_processing);
    point.report_ms = jmxMean(server.report_processing);
    point.store_catalog_ms = jmxMean(server.store_catalog);
    point.store_facts_ms = jmxMean(server.store_facts);
    point.store_report_ms = jmxMean(server.store_report);
    point.http_query_ms = jmxMean(server.http_query_time);
    point.http_cmd_ms = jmxMean(server.http_cmd_time);
    point.queue_depth = Number(server.cmd_depth?.Count) || 0;
    point.write_active = Number(server.write_pool_active?.Value) || 0;
    point.write_idle = Number(server.write_pool_idle?.Value) || 0;
    point.read_active = Number(server.read_pool_active?.Value) || 0;
    point.read_idle = Number(server.read_pool_idle?.Value) || 0;
    point.write_pending = Number(server.write_pool_pending?.Value) || 0;
    point.read_pending = Number(server.read_pool_pending?.Value) || 0;
    point.hash_match_ms = jmxMean(server.catalog_hash_match);
    point.hash_miss_ms = jmxMean(server.catalog_hash_miss);
    point.dedup_pct = jmxGaugePct(server.dedup_pct);
    point.gc_young_count = Number(server.gc_young?.CollectionCount) || 0;
    point.gc_young_time = Number(server.gc_young?.CollectionTime) || 0;
    point.gc_old_count = Number(server.gc_old?.CollectionCount) || 0;
    point.gc_old_time = Number(server.gc_old?.CollectionTime) || 0;
    const rawNodes = Number(server.fleet_nodes);
    const rawAvg = Number(server.fleet_avg_resources);
    const rawRes = Number(server.fleet_resources);
    setServerHistory((prev) => {
      const last = prev.length ? prev[prev.length - 1] : undefined;
      point.nodes = carryForward(
        Number.isFinite(rawNodes) && rawNodes > 0 ? rawNodes : jmxVal(server.population_nodes, 'Value'),
        last?.nodes,
      );
      point.resources = carryForward(
        Number.isFinite(rawRes) && rawRes > 0 ? rawRes : jmxVal(server.population_resources, 'Value'),
        last?.resources,
      );
      point.avg_resources = carryForward(
        Number.isFinite(rawAvg) && rawAvg > 0 ? rawAvg : jmxVal(server.population_avg_resources, 'Value'),
        last?.avg_resources,
      );
      const updated = [...prev, point];
      const trimmed = updated.length > MAX_SERVER_POINTS ? updated.slice(-MAX_SERVER_POINTS) : updated;
      saveServerHistory(trimmed);
      return trimmed;
    });
    setLastRefresh(new Date());
  }, [serverData]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

  if (loading && !perfData) return <Center h={embedded ? 200 : 400}><Loader size={embedded ? 'md' : 'xl'} /></Center>;
  if (error && !perfData) return <Alert color="red" title="Error">{String(error)}</Alert>;
  if (!perfData) return null;

  // Catch render errors from bad JMX data
  try {
    return (
      <MetricsPerformanceContent
        embedded={embedded}
        perfData={perfData}
        serverData={serverData}
        serverHistory={serverHistory}
        expanded={expanded}
        toggleExpand={toggleExpand}
        refreshRate={refreshRate}
        setRefreshRate={setRefreshRate}
        lastRefresh={lastRefresh}
        fetchData={() => refetch()}
        clearHistory={() => {
          setServerHistory([]);
          saveServerHistory([]);
          localStorage.setItem(SERVER_HISTORY_KEY + '_v', String(HISTORY_VERSION));
        }}
        refreshing={refreshing}
        scope={scope}
        setScope={setScope}
      />
    );
  } catch (e: any) {
    return <Alert color="red" title="Render Error">{String(e?.message || e)}</Alert>;
  }
}

function MetricsPerformanceContent({
  embedded = false,
  perfData,
  serverData,
  serverHistory,
  expanded,
  toggleExpand,
  refreshRate,
  setRefreshRate,
  lastRefresh,
  fetchData,
  clearHistory,
  refreshing = false,
  scope,
  setScope,
}: {
  embedded?: boolean;
  perfData: any;
  serverData: any;
  serverHistory: any[];
  expanded: string | null;
  toggleExpand: (id: string) => void;
  refreshRate: string;
  setRefreshRate: (v: string) => void;
  lastRefresh: Date;
  fetchData: () => void;
  clearHistory: () => void;
  refreshing?: boolean;
  scope: ScopeSelection;
  setScope: (s: ScopeSelection) => void;
}) {

  // Agent-side data — stride + cap before Recharts bind
  const rawTrends = (perfData.run_time_trends || []) as Record<string, unknown>[];
  const trends = smoothTimeSeries(
    downsampleSeries(
      rawTrends.filter((_: Record<string, unknown>, i: number) => i % 2 === 0).slice(-240),
      120,
    ),
  );
  // Live JMX series can grow; bind a downsampled + SMA view so 10+ charts stay cheap
  const serverHistoryChart = useMemo(() => {
    const down = downsampleSeries(serverHistory, 120);
    if (!down.length) return down;
    const trendKeys = new Set<string>();
    for (const row of down) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'time' || k === 'ts' || COUNT_KEYS.has(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) trendKeys.add(k);
      }
    }
    return movingAverageSeries(down, [...trendKeys]);
  }, [serverHistory]);
  const nodeComparison = (perfData.node_comparison || [])
    .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
    .slice(0, 10);
  const stats = perfData.stats || {};

  const top10Bars = nodeComparison.map((n: any) => ({
    name: barLabel(n.certname),
    seconds: Number(n.avg_total) || Number(n.avg_catalog_application) || 0,
  })).reverse();

  // Server-side data — safely default all fields to prevent render crashes
  const s: Record<string, any> = {};
  if (serverData && typeof serverData === 'object') {
    for (const [k, v] of Object.entries(serverData)) {
      s[k] = v;
    }
  }

  // Build server metric bars for storage timing
  const storageData = [
    { name: 'Catalog', mean: jmxTimerToMs(jmxVal(s.store_catalog, 'Mean')) },
    { name: 'Facts', mean: jmxTimerToMs(jmxVal(s.store_facts, 'Mean')) },
    { name: 'Report', mean: jmxTimerToMs(jmxVal(s.store_report, 'Mean')) },
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
    { name: 'Catalog', mean: jmxTimerToMs(jmxVal(s.catalog_processing, 'Mean')), p95: jmxTimerToMs(s.catalog_processing?.['95thPercentile']) },
    { name: 'Facts', mean: jmxTimerToMs(jmxVal(s.facts_processing, 'Mean')), p95: jmxTimerToMs(s.facts_processing?.['95thPercentile']) },
    { name: 'Report', mean: jmxTimerToMs(jmxVal(s.report_processing, 'Mean')), p95: jmxTimerToMs(s.report_processing?.['95thPercentile']) },
  ].filter(d => d.mean > 0);

  // HTTP latency — bean names vary by OpenVoxDB/PuppetDB version
  const httpData = [
    { name: 'Query API', mean: jmxMean(s.http_query_time), p95: jmxTimerToMs(s.http_query_time?.['95thPercentile']) },
    { name: 'Command API', mean: jmxMean(s.http_cmd_time), p95: jmxTimerToMs(s.http_cmd_time?.['95thPercentile']) },
  ].filter(d => d.mean > 0);
  const hashPeak = Math.max(
    0,
    jmxMean(s.catalog_hash_match),
    jmxMean(s.catalog_hash_miss),
    ...serverHistoryChart.map((r) =>
      Math.max(Number(r.hash_match_ms) || 0, Number(r.hash_miss_ms) || 0),
    ),
  );
  const dedupSeries = serverHistoryChart.length
    ? serverHistoryChart
    : [{
        time: lastRefresh.toLocaleTimeString(),
        dedup_pct: jmxGaugePct(s.dedup_pct),
        hash_match_ms: jmxMean(s.catalog_hash_match),
        hash_miss_ms: jmxMean(s.catalog_hash_miss),
      }];

  // Define all 10 chart panels
  const charts: Array<{ id: string; title: string; stats?: any[]; render: (w: number, h: number) => ReactNode }> = [
    {
      id: 'run-trends', title: 'Run Duration Trends',
      stats: [{ label: 'Avg', value: formatSeconds(stats.avg_run_time || 0) }, { label: 'Max', value: formatSeconds(stats.max_run_time || 0), color: 'red' }],
      render: (w, h) => (
        <AreaChart width={w} height={h} data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs><linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.3}/><stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={tickTime} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={((v: number, n: string) => [formatSeconds(v), n]) as any} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="total" stroke="#0D6EFD" fill="url(#gT)" strokeWidth={2} dot={false} name="Total" />
        </AreaChart>
      ),
    },
    {
      id: 'phase-breakdown', title: 'Timing Phase Breakdown',
      render: (w, h) => (
        <AreaChart width={w} height={h} data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={tickTime} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={((v: number, n: string) => [formatSeconds(v), n]) as any} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Fact Gen" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} dot={false} name="Plugin Sync" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} dot={false} name="Config Retrieval" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1.5} dot={false} name="Catalog Apply" />
        </AreaChart>
      ),
    },
    {
      id: 'top10-nodes', title: 'Top 10 Slowest Nodes',
      render: (w, h) => (
        <BarChart width={w} height={h} data={top10Bars} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis type="number" tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatSeconds} />
          <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip
            {...TOOLTIP_STYLE}
            formatter={((v: number) => [
              typeof v === 'number' && Number.isFinite(v) ? formatSeconds(v) : '—',
              'Avg run',
            ]) as any}
          />
          <Bar isAnimationActive={false} dataKey="seconds" fill="#0D6EFD" name="Avg run" maxBarSize={18} />
        </BarChart>
      ),
    },
    {
      id: 'cmd-processing', title: 'Command Processing Time',
      stats: cmdData.map(d => ({ label: d.name, value: String(formatMs(d.mean)), color: 'cyan' })),
      render: (w, h) => (
        <DurationOverlayChart
          width={w}
          height={h}
          data={serverHistoryChart}
          keys={['catalog_ms', 'facts_ms', 'report_ms']}
          names={['Catalog', 'Facts', 'Report']}
          colors={['#0D6EFD', '#2ecc71', '#e67e22']}
          snapshot={cmdData}
        />
      ),
    },
    {
      id: 'storage-timing', title: 'Storage Operation Timing',
      stats: storageData.map(d => ({ label: d.name, value: String(formatMs(d.mean)), color: 'cyan' })),
      render: (w, h) => (
        <DurationOverlayChart
          width={w}
          height={h}
          data={serverHistoryChart}
          keys={['store_catalog_ms', 'store_facts_ms', 'store_report_ms']}
          names={['Catalog', 'Facts', 'Report']}
          colors={['#0D6EFD', '#2ecc71', '#e67e22']}
          snapshot={storageData}
        />
      ),
    },
    {
      id: 'db-pool', title: 'Database Connection Pool',
      render: (w, h) => (
        <AreaChart width={w} height={h} data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} allowDecimals={false} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="write_active" stroke="#e74c3c" fill="none" strokeWidth={2} dot={false} name="Write Active" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="write_idle" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Write Idle" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="read_active" stroke="#0D6EFD" fill="none" strokeWidth={2} dot={false} name="Read Active" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="read_idle" stroke="#1abc9c" fill="none" strokeWidth={1.5} dot={false} name="Read Idle" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="write_pending" stroke="#f39c12" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Write Pending" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="read_pending" stroke="#9b59b6" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Read Pending" />
        </AreaChart>
      ),
    },
    {
      id: 'http-latency', title: 'HTTP API Latency',
      stats: httpData.map(d => ({ label: d.name, value: String(formatMs(d.mean)), color: 'cyan' })),
      render: (w, h) => (
        <DurationOverlayChart
          width={w}
          height={h}
          data={serverHistoryChart}
          keys={['http_query_ms', 'http_cmd_ms']}
          names={['Query API', 'Command API']}
          colors={['#3498db', '#e74c3c']}
          snapshot={httpData}
        />
      ),
    },
    {
      id: 'catalog-dedup', title: 'Catalog Deduplication',
      stats: [{ label: 'Dedup Rate', value: `${jmxGaugePct(s.dedup_pct).toFixed(1)}%`, color: 'green' }],
      render: (w, h) => (
        <ComposedChart width={w} height={h} data={dedupSeries} margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: '#8899aa' }}
            label={{ value: 'Time', position: 'insideBottom', offset: -2, fill: '#8899aa', fontSize: 9 }}
          />
          <YAxis
            yAxisId="pct"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 9, fill: '#2ecc71' }}
            width={40}
            label={{ value: 'Dedup rate', angle: -90, position: 'insideLeft', fill: '#2ecc71', fontSize: 9 }}
          />
          <YAxis
            yAxisId="ms"
            orientation="right"
            domain={hashPeak > 0 ? [0, 'auto'] : [0, 1]}
            tickFormatter={durationTickFormatter(hashPeak)}
            tick={{ fontSize: 9, fill: '#8899aa' }}
            width={48}
            label={{ value: 'Hash time', angle: 90, position: 'insideRight', fill: '#8899aa', fontSize: 9 }}
          />
          <ReTooltip
            {...TOOLTIP_STYLE}
            formatter={((v: number, n: string) => [
              String(n).includes('Dedup')
                ? `${Number(v).toFixed(1)}%`
                : formatDuration(Number(v)),
              n,
            ]) as any}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area
            yAxisId="pct"
            isAnimationActive={false}
            animationDuration={0}
            type={CHART_LINE_TYPE}
            dataKey="dedup_pct"
            stroke="#2ecc71"
            fill="none"
            strokeWidth={2}
            dot={false}
            name="Dedup rate"
          />
          <Line
            yAxisId="ms"
            isAnimationActive={false}
            type={CHART_LINE_TYPE}
            dataKey="hash_match_ms"
            stroke="#3498db"
            strokeWidth={1.5}
            dot={false}
            name="Hash match"
          />
          <Line
            yAxisId="ms"
            isAnimationActive={false}
            type={CHART_LINE_TYPE}
            dataKey="hash_miss_ms"
            stroke="#e74c3c"
            strokeWidth={1.5}
            dot={false}
            name="Hash miss"
          />
        </ComposedChart>
      ),
    },
    {
      id: 'gc-pressure', title: 'GC Pressure',
      stats: [
        { label: 'Young GC', value: `${Number(jmxVal(s.gc_young, 'CollectionCount')) || 0} collections`, color: 'cyan' },
        { label: 'Old GC', value: `${Number(jmxVal(s.gc_old, 'CollectionCount')) || 0} collections`, color: 'orange' },
      ],
      render: (w, h) => (
        <AreaChart width={w} height={h} data={serverHistoryChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="gc_young_count" stroke="#3498db" fill="none" strokeWidth={2} dot={false} name="Young Gen Collections" />
          <Area isAnimationActive={false} animationDuration={0} type={CHART_LINE_TYPE} dataKey="gc_old_count" stroke="#e67e22" fill="none" strokeWidth={2} dot={false} name="Old Gen Collections" />
        </AreaChart>
      ),
    },
    {
      id: 'population', title: 'Fleet Population',
      stats: [
        { label: 'Live nodes', value: `${Number(s.fleet_nodes) || Number(jmxVal(s.population_nodes, 'Value')) || 0}`, color: 'blue' },
        { label: 'Catalog resources', value: `${Number(s.fleet_resources) || Number(jmxVal(s.population_resources, 'Value')) || 0}`, color: 'violet' },
        { label: 'Avg / node', value: `${(Number(s.fleet_avg_resources) || Number(jmxVal(s.population_avg_resources, 'Value')) || 0).toFixed(0)}`, color: 'orange' },
      ],
      render: (w, h) => (
        <ComposedChart width={w} height={h} data={serverHistoryChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.35} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} />
          <YAxis
            yAxisId="nodes"
            allowDecimals={false}
            tick={{ fontSize: 9, fill: '#0D6EFD' }}
            width={36}
            label={{ value: 'Nodes', angle: -90, position: 'insideLeft', fill: '#0D6EFD', fontSize: 10 }}
          />
          <YAxis
            yAxisId="avg"
            orientation="right"
            tick={{ fontSize: 9, fill: '#EC8622' }}
            width={44}
            label={{ value: 'Avg resources', angle: 90, position: 'insideRight', fill: '#EC8622', fontSize: 10 }}
          />
          <ReTooltip
            {...TOOLTIP_STYLE}
            formatter={((v: number, n: string) => [
              typeof v === 'number' ? (n.includes('Avg') ? v.toFixed(0) : String(Math.round(v))) : v,
              n,
            ]) as any}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line yAxisId="nodes" type="linear" dataKey="nodes" stroke="#0D6EFD" strokeWidth={2.5} dot={false} name="Live nodes" />
          <Line yAxisId="avg" type="monotone" dataKey="avg_resources" stroke="#EC8622" strokeWidth={2.5} dot={false} name="Avg resources / node (MA)" />
        </ComposedChart>
      ),
    },
  ];

  return (
    <Stack gap={embedded ? 'sm' : 'md'}>
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="sm">
          <IconChartLine size={embedded ? 22 : 28} />
          <div>
            <Title order={embedded ? 3 : 2}>Run Performance</Title>
            {perfData?.scope?.label && (
              <Text size="xs" c="dimmed">
                Scope: {perfData.scope.label}
                {perfData.scope.total != null ? ` · ${perfData.scope.total} hosts` : ''}
              </Text>
            )}
          </div>
          <Badge variant="light" color="blue" size="lg">{stats.total_runs || 0} runs / {stats.total_nodes || 0} nodes</Badge>
          {refreshing && <Badge variant="outline" color="gray" size="sm">Refreshing…</Badge>}
        </Group>
        <Group gap="md" align="flex-end" wrap="wrap">
          <FleetScopeSelect
            size={embedded ? 'xs' : 'sm'}
            value={scope}
            onChange={setScope}
          />
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
            <ChartPanel title={chart.title} expanded={true} onClick={() => toggleExpand(chart.id)} stats={chart.stats} render={chart.render} />
          );
        })()
      ) : (
        // Grid view — 2 per row
        <Grid>
          {charts.map(chart => (
            <Grid.Col key={chart.id} span={6}>
              <ChartPanel title={chart.title} expanded={false} onClick={() => toggleExpand(chart.id)} stats={chart.stats} render={chart.render} />
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
