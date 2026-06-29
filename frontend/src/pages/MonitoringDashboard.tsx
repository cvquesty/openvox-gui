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
import { useMonitoringHistory } from '../hooks/MonitoringHistoryContext';

const GRAPHS_KEY = 'openvox-gui-monitor-graphs-v2';
const REFRESH_KEY = 'openvox-gui-monitor-refresh-v2';
const WINDOW_KEY = 'openvox-gui-monitor-window-hours-v1';
const PERF_HIST_KEY = 'openvox_monitor_perf_hist_v2';
/** v3: merge API ring + localStorage points (v2 wiped client trend on each server history replace). */
const PS_HIST_KEY = 'openvox_monitor_ps_hist_v3';
const PDB_HIST_KEY = 'openvox_monitor_pdb_hist_v3';
const MAX_HIST = 2000;

/** Keep curves inside the plot (natural splines overshoot below 0 / past axes). */
const CHART_MARGIN = { top: 8, right: 12, left: 4, bottom: 4 };
const CURVE = 'monotone' as const;
/** Non-negative metrics (heap MB, queue depth, CPU load, ms timings). */
const Y_NONNEG = {
  domain: [0, 'auto'] as [number, string],
  allowDataOverflow: false,
};

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
  { id: 'compliance_trend', label: 'Compliance trend', group: 'Fleet', sources: ['compliance'], detailPath: '/insights/compliance', defaultOn: true },
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

/**
 * Normalize epoch to milliseconds. Backend PS health uses time.time() (seconds);
 * treating seconds as ms put all points in 1970 → off the shared axis → empty charts.
 */
function toEpochMs(ts: number): number {
  if (!Number.isFinite(ts)) return NaN;
  // < year 2001 in ms ⇒ almost certainly seconds
  return ts < 1e12 ? ts * 1000 : ts;
}

/** UTC hour bucket key: YYYY-MM-DDTHH (PuppetDB / compliance API style) */
function hourKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}`;
}

/** Start of UTC hour for a bucket key → epoch ms */
function hourKeyToMs(key: string): number {
  const s = String(key || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) {
    return Date.parse(`${s}:00:00.000Z`);
  }
  if (s.length >= 13 && s.includes('T')) {
    return Date.parse(s.length === 13 ? `${s}:00:00.000Z` : s);
  }
  const p = Date.parse(s);
  return Number.isNaN(p) ? NaN : p;
}

function windowBounds(hours: number): { startMs: number; endMs: number } {
  const endMs = Date.now();
  const startMs = endMs - Math.max(1, Math.min(168, hours)) * 3600_000;
  return { startMs, endMs };
}

/** Resolve any row to epoch ms, or null if unplaceable on the timeline. */
function pointEpochMs(row: any, timeField = 'timestamp'): number | null {
  if (row == null) return null;
  if (typeof row.ts === 'number' && Number.isFinite(row.ts)) {
    const ms = toEpochMs(row.ts);
    return Number.isNaN(ms) ? null : ms;
  }
  const raw = row[timeField] ?? row.time ?? row.timestamp ?? row.hour ?? row.label;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = toEpochMs(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) {
    const ms = hourKeyToMs(s);
    return Number.isNaN(ms) ? null : ms;
  }
  if (s.length >= 13 && s[4] === '-' && s.includes('T')) {
    const ms = hourKeyToMs(s.slice(0, 13));
    return Number.isNaN(ms) ? null : ms;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;
  return null;
}

/**
 * Map rows onto the shared numeric timeline (field `t` = epoch ms).
 * Identical domain on every chart; live polls keep full resolution (not crushed to 1 pt/hour).
 * Hourly API series become one point at each hour start — still on the same start/end.
 */
function seriesInWindow(
  rows: any[],
  startMs: number,
  endMs: number,
  valueFields: string[],
  opts?: { timeField?: string; averageByHour?: boolean }
): any[] {
  const timeField = opts?.timeField ?? 'timestamp';

  if (opts?.averageByHour) {
    const buckets: Record<string, { sums: Record<string, number>; counts: Record<string, number>; extras: Record<string, number> }> = {};
    for (const row of rows || []) {
      const ms = pointEpochMs(row, timeField);
      if (ms == null || ms < startMs || ms > endMs) continue;
      const hk = hourKeyFromMs(ms);
      if (!buckets[hk]) buckets[hk] = { sums: {}, counts: {}, extras: {} };
      const b = buckets[hk];
      for (const f of valueFields) {
        const v = row[f];
        if (v == null || v === '' || Number.isNaN(Number(v))) continue;
        const num = Number(v);
        b.sums[f] = (b.sums[f] || 0) + num;
        b.counts[f] = (b.counts[f] || 0) + 1;
      }
      for (const [k, v] of Object.entries(row)) {
        if (valueFields.includes(k) || k === 'ts' || k === 'time' || k === 'timestamp' || k === 't' || k === 'x') continue;
        if (typeof v === 'number' && !Number.isNaN(v)) b.extras[k] = v;
      }
    }
    return Object.keys(buckets)
      .sort()
      .map((hk) => {
        const b = buckets[hk];
        const out: any = { t: hourKeyToMs(hk), x: hk };
        for (const f of valueFields) {
          if (b.counts[f]) out[f] = b.sums[f] / b.counts[f];
        }
        Object.assign(out, b.extras);
        return out;
      })
      .filter((p) => Number.isFinite(p.t));
  }

  const out: any[] = [];
  for (const row of rows || []) {
    const ms = pointEpochMs(row, timeField);
    if (ms == null || ms < startMs || ms > endMs) continue;
    const point: any = { t: ms, x: hourKeyFromMs(ms) };
    let any = false;
    for (const f of valueFields) {
      const v = row[f];
      if (v == null || v === '' || Number.isNaN(Number(v))) continue;
      point[f] = Number(v);
      any = true;
    }
    for (const [k, v] of Object.entries(row)) {
      if (valueFields.includes(k) || k === 'ts' || k === 'time' || k === 'timestamp' || k === 't' || k === 'x' || k === 'hour' || k === 'label') {
        continue;
      }
      if (typeof v === 'number' && !Number.isNaN(v)) {
        point[k] = v;
        any = true;
      }
    }
    if (any) out.push(point);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Top-10 style: average dynamic certname keys per hour, still on shared numeric domain. */
function top10InWindow(rows: any[], startMs: number, endMs: number, certnames: string[]): any[] {
  const hourBuckets: Record<string, Record<string, number[]>> = {};
  for (const run of rows || []) {
    const ms = pointEpochMs(run, 'time');
    if (ms == null || ms < startMs || ms > endMs) continue;
    const cn = run.certname;
    if (!certnames.includes(cn)) continue;
    const hk = hourKeyFromMs(ms);
    if (!hourBuckets[hk]) hourBuckets[hk] = {};
    if (!hourBuckets[hk][cn]) hourBuckets[hk][cn] = [];
    hourBuckets[hk][cn].push(Number(run.total) || 0);
  }
  return Object.keys(hourBuckets)
    .sort()
    .map((hk) => {
      const point: any = { t: hourKeyToMs(hk), x: hk };
      for (const [cn, vals] of Object.entries(hourBuckets[hk])) {
        point[cn] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return point;
    });
}

function formatAxisTick(ms: number, windowHours: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (windowHours > 48) {
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${mo}-${day} ${hh}:00`;
  }
  return `${hh}:${mm}`;
}

/** Shared numeric X — same domain on every time-series panel */
function sharedXAxisProps(startMs: number, endMs: number, windowHours: number) {
  return {
    dataKey: 't' as const,
    type: 'number' as const,
    domain: [startMs, endMs] as [number, number],
    tick: { fontSize: 9 },
    tickFormatter: (v: number) => formatAxisTick(v, windowHours),
    tickCount: 7,
    allowDataOverflow: true,
  };
}

/** Merge ring-buffer / poll points by timestamp; prefer newer field values; persist-friendly. */
function mergeHistByTs(prev: any[], incoming: any[], max = MAX_HIST): any[] {
  const byTs = new Map<number, any>();
  for (const p of [...(prev || []), ...(incoming || [])]) {
    if (!p || typeof p !== 'object') continue;
    let ts =
      typeof p.ts === 'number'
        ? toEpochMs(p.ts)
        : typeof p.t === 'number'
          ? toEpochMs(p.t)
          : pointEpochMs(p, 'time');
    if (ts == null || !Number.isFinite(ts) || Number.isNaN(ts)) continue;
    const prevPt = byTs.get(ts) || { ts, time: hourKeyFromMs(ts) };
    const next = { ...prevPt, ...p, ts, time: p.time || hourKeyFromMs(ts) };
    byTs.set(ts, next);
  }
  return Array.from(byTs.values())
    .sort((a, b) => a.ts - b.ts)
    .slice(-max);
}

function extractHttpRouteMeans(result: any): { catalog?: number; report?: number } {
  let catalog = result?.http_catalog_mean ?? result?.http?.catalog_mean;
  let report = result?.http_report_mean ?? result?.http?.report_mean;
  for (const hm of result?.http_metrics || []) {
    const r = String(hm?.route || hm?.name || '').toLowerCase();
    const mean = hm?.mean ?? hm?.Mean;
    if (mean == null || Number.isNaN(Number(mean))) continue;
    if (r.includes('catalog')) catalog = Number(mean);
    else if (r.includes('report')) report = Number(mean);
  }
  return { catalog: catalog != null ? Number(catalog) : undefined, report: report != null ? Number(report) : undefined };
}

function sharedLabelFormatter(v: unknown) {
  const ms = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(ms)) return String(v ?? '');
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function tickTime(v: string) {
  const s = String(v || '');
  if (!s || s.length < 4) return s;
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
      <div onClick={onToggle} style={{ overflow: 'hidden', width: '100%' }}>
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
  const [windowHours, setWindowHours] = useState(() => {
    const w = Number(loadJson(WINDOW_KEY, 24));
    return [12, 24, 48, 72, 168].includes(w) ? w : 24;
  });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashData, setDashData] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [perfData, setPerfData] = useState<any>(null);
  // Histories now come from the app-level collector so they continue to grow
  // even when you navigate away from the Monitoring wallboard.
  const {
    perfServerHist: perfServerHistFromCtx,
    psHist: psHistFromCtx,
    pdbHist: pdbHistFromCtx,
    refreshHistories,
  } = useMonitoringHistory();

  // Local copies synced from the shared collector. This keeps all the existing
  // useMemo / rendering logic working unchanged while the collector runs globally.
  const [perfServerHist, setPerfServerHist] = useState<any[]>(perfServerHistFromCtx);
  const [psHist, setPsHist] = useState<any[]>(psHistFromCtx);
  const [pdbHist, setPdbHist] = useState<any[]>(pdbHistFromCtx);

  // Keep local buffers in sync when the background collector appends new points.
  useEffect(() => { setPerfServerHist(perfServerHistFromCtx); }, [perfServerHistFromCtx]);
  useEffect(() => { setPsHist(psHistFromCtx); }, [psHistFromCtx]);
  useEffect(() => { setPdbHist(pdbHistFromCtx); }, [pdbHistFromCtx]);

  // When the Monitoring view mounts (or regains focus), ask the collector for latest.
  useEffect(() => {
    refreshHistories?.();
  }, [refreshHistories]);

  const { startMs, endMs } = useMemo(
    () => windowBounds(windowHours),
    [windowHours, lastRefresh]
  );

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
    const tsNow = Date.now();
    try {
      const tasks: Promise<void>[] = [];

      if (neededSources.has('dash')) {
        tasks.push(dashboard.getData().then(setDashData));
      }
      if (neededSources.has('compliance')) {
        tasks.push(metrics.compliance(windowHours).then(setCompliance));
      }
      if (neededSources.has('perf')) {
        tasks.push(
          perfApi.getOverview().then((perf) => {
            setPerfData(perf);
          })
        );
        // The persistent high-res perf server history is maintained by the
        // app-level MonitoringHistoryProvider (runs even when this page is not focused).
      }
      if (neededSources.has('ps')) {
        // We still fetch for fresh current values if this source is enabled,
        // but the long-term history accumulation for the wallboard is handled
        // by the global MonitoringHistoryProvider (survives route changes).
        tasks.push(
          metrics.puppetserverHealth().then((result) => {
            // The context provider will have the rich merged history.
            // We can optionally nudge it:
            refreshHistories?.();
          }).catch(() => {})
        );
      }
      if (neededSources.has('pdb')) {
        tasks.push(
          metrics.puppetdbHealth().then(() => {
            refreshHistories?.();
          }).catch(() => {})
        );
      }

      await Promise.all(tasks);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load monitoring graphs');
    } finally {
      setLoading(false);
    }
  }, [neededSources, windowHours]);

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

  useEffect(() => {
    saveJson(WINDOW_KEY, windowHours);
  }, [windowHours]);

  // When this wallboard tab regains browser focus, force a catch-up so graphs
  // show the very latest points + history that the global collector accumulated.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshHistories?.();
        // Also refresh the main dashboard/compliance snapshots
        fetchAll();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshHistories, fetchAll]);

  const xAxis = sharedXAxisProps(startMs, endMs, windowHours);

  // ── All time series on the SAME numeric domain [startMs, endMs] ──
  const nodeTrends = useMemo(
    () =>
      seriesInWindow(dashData?.node_trends || [], startMs, endMs, [
        'unchanged',
        'changed',
        'failed',
        'noop',
        'unreported',
      ]),
    [startMs, endMs, dashData]
  );

  const complianceTrend = useMemo(
    () =>
      seriesInWindow(compliance?.trend || [], startMs, endMs, [
        'compliant',
        'drifted',
        'failed',
      ]),
    [startMs, endMs, compliance]
  );

  const complianceDist = compliance
    ? [
        { name: 'Compliant', value: compliance.compliant || 0, color: '#28a745' },
        { name: 'Drifted', value: compliance.drifted || 0, color: '#fd7e14' },
        { name: 'Failed', value: compliance.failed || 0, color: '#dc3545' },
        { name: 'Noop', value: compliance.noop || 0, color: '#ffc107' },
        { name: 'Unreported', value: compliance.unreported || 0, color: '#6c757d' },
      ].filter((d) => d.value > 0)
    : [];

  const runTrends = useMemo(
    () =>
      seriesInWindow(
        perfData?.run_time_trends || [],
        startMs,
        endMs,
        ['total', 'fact_generation', 'plugin_sync', 'config_retrieval', 'catalog_application'],
        { timeField: 'time', averageByHour: true }
      ),
    [startMs, endMs, perfData]
  );

  const nodeComparison = useMemo(
    () =>
      (perfData?.node_comparison || [])
        .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
        .slice(0, 10),
    [perfData]
  );

  const top10Data = useMemo(
    () =>
      top10InWindow(
        perfData?.run_time_trends || [],
        startMs,
        endMs,
        nodeComparison.map((n: any) => n.certname)
      ),
    [startMs, endMs, perfData, nodeComparison]
  );

  const perfAligned = useMemo(
    () =>
      seriesInWindow(
        perfServerHist,
        startMs,
        endMs,
        [
          'catalog_ms',
          'facts_ms',
          'report_ms',
          'store_catalog_ms',
          'store_facts_ms',
          'store_report_ms',
          'http_query_ms',
          'http_cmd_ms',
          'write_active',
          'write_idle',
          'read_active',
          'read_idle',
          'write_pending',
          'read_pending',
          'hash_match_ms',
          'hash_miss_ms',
          'gc_young_count',
          'gc_old_count',
          'nodes',
          'avg_resources',
        ],
        { timeField: 'time' }
      ),
    [startMs, endMs, perfServerHist]
  );

  const psAligned = useMemo(
    () =>
      seriesInWindow(
        psHist,
        startMs,
        endMs,
        [
          'heap_used_mb',
          'nonheap_used_mb',
          'http_catalog_mean',
          'http_report_mean',
          'gc_young_time',
          'gc_old_time',
          'process_cpu_load',
          'open_fds',
        ],
        { timeField: 'time' }
      ),
    [startMs, endMs, psHist]
  );

  const pdbAligned = useMemo(
    () =>
      seriesInWindow(
        pdbHist,
        startMs,
        endMs,
        ['used_mb', 'queue_depth', 'catalog_save_mean', 'report_process_mean'],
        { timeField: 'time' }
      ),
    [startMs, endMs, pdbHist]
  );

  const axisRangeLabel = `${formatAxisTick(startMs, windowHours)} → ${formatAxisTick(endMs, windowHours)} UTC (${windowHours}h)`;

  const multiSelectData = GRAPH_CATALOG.map((g) => ({
    value: g.id,
    label: `[${g.group}] ${g.label}`,
  }));

  const renderChartBody = (id: GraphId): ReactNode => {
    switch (id) {
      case 'fleet_status_trends':
        return (
          <AreaChart data={nodeTrends} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} labelFormatter={sharedLabelFormatter} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="unchanged" stroke="#2ecc71" fill="#2ecc71" fillOpacity={0.12} strokeWidth={1.5} name="Unchanged" />
            <Area type="monotone" dataKey="changed" stroke="#f39c12" fill="#f39c12" fillOpacity={0.1} strokeWidth={1.5} name="Changed" />
            <Area type="monotone" dataKey="failed" stroke="#e74c3c" fill="#e74c3c" fillOpacity={0.1} strokeWidth={2} name="Failed" />
            <Area type="monotone" dataKey="noop" stroke="#3498db" fill="#3498db" fillOpacity={0.08} strokeWidth={1} name="Noop" />
          </AreaChart>
        );
      case 'compliance_trend':
        return (
          <AreaChart data={complianceTrend} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} labelFormatter={sharedLabelFormatter} />
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
          <AreaChart data={runTrends} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number) => [formatSeconds(v), 'Total']} />
            <Area type="monotone" dataKey="total" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Total" />
          </AreaChart>
        );
      case 'timing_phase_breakdown':
        return (
          <AreaChart data={runTrends} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Area type="monotone" dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Fact Gen" />
            <Area type="monotone" dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} name="Plugin Sync" />
            <Area type="monotone" dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} name="Config Retrieval" />
            <Area type="monotone" dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1.5} name="Catalog Apply" />
          </AreaChart>
        );
      case 'top10_slowest':
        return (
          <AreaChart data={top10Data} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatSeconds} width={36}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatSeconds(v), n]} />
            <Legend wrapperStyle={{ fontSize: 8 }} />
            {nodeComparison.map((n: any, i: number) => (
              <Area
                key={n.certname}
                type="monotone"
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
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Catalog" />
            <Area type="monotone" dataKey="facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Facts" />
            <Area type="monotone" dataKey="report_ms" stroke="#e67e22" fill="none" strokeWidth={2} name="Report" />
          </AreaChart>
        );
      case 'storage_timing':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="store_catalog_ms" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Catalog" />
            <Area type="monotone" dataKey="store_facts_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Facts" />
            <Area type="monotone" dataKey="store_report_ms" stroke="#e67e22" fill="none" strokeWidth={2} name="Report" />
          </AreaChart>
        );
      case 'db_pool':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Area type="monotone" dataKey="write_active" stroke="#e74c3c" fill="none" strokeWidth={2} name="Write Active" />
            <Area type="monotone" dataKey="write_idle" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Write Idle" />
            <Area type="monotone" dataKey="read_active" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Read Active" />
            <Area type="monotone" dataKey="read_idle" stroke="#1abc9c" fill="none" strokeWidth={1.5} name="Read Idle" />
          </AreaChart>
        );
      case 'http_latency':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="http_query_ms" stroke="#3498db" fill="none" strokeWidth={2} name="Query API" />
            <Area type="monotone" dataKey="http_cmd_ms" stroke="#e74c3c" fill="none" strokeWidth={2} name="Command API" />
          </AreaChart>
        );
      case 'catalog_dedup':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={formatMs} width={40}  {...Y_NONNEG} />
            <ReTooltip {...TT} formatter={(v: number, n: string) => [formatMs(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="hash_match_ms" stroke="#2ecc71" fill="none" strokeWidth={2} name="Hash Match" />
            <Area type="monotone" dataKey="hash_miss_ms" stroke="#e74c3c" fill="none" strokeWidth={2} name="Hash Miss" />
          </AreaChart>
        );
      case 'gc_pressure_pdb':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} width={28}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="gc_young_count" stroke="#3498db" fill="none" strokeWidth={2} name="Young GC" />
            <Area type="monotone" dataKey="gc_old_count" stroke="#e67e22" fill="none" strokeWidth={2} name="Old GC" />
          </AreaChart>
        );
      case 'fleet_population':
        return (
          <AreaChart data={perfAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} width={36}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="nodes" stroke="#0D6EFD" fill="none" strokeWidth={2} name="Nodes" />
            <Area type="monotone" dataKey="avg_resources" stroke="#2ecc71" fill="none" strokeWidth={1.5} name="Avg resources/node" />
          </AreaChart>
        );
      case 'ps_heap':
        return (
          <AreaChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Area type="monotone" dataKey="heap_used_mb" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Heap used MB" />
          </AreaChart>
        );
      case 'ps_nonheap':
        return (
          <AreaChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Area type="monotone" dataKey="nonheap_used_mb" stroke="#8e44ad" fill="#8e44ad" fillOpacity={0.12} strokeWidth={2} name="Non-heap MB" />
          </AreaChart>
        );
      case 'ps_catalog_route':
        return (
          <LineChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="http_catalog_mean" stroke="#2980b9" strokeWidth={2} dot={false} name="Catalog route" />
          </LineChart>
        );
      case 'ps_report_route':
        return (
          <LineChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="http_report_mean" stroke="#16a085" strokeWidth={2} dot={false} name="Report route" />
          </LineChart>
        );
      case 'ps_gc_young':
        return (
          <AreaChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Area type="monotone" dataKey="gc_young_time" stroke="#3498db" fill="#3498db" fillOpacity={0.12} strokeWidth={2} name="Young GC ms" />
          </AreaChart>
        );
      case 'ps_gc_old':
        return (
          <AreaChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Area type="monotone" dataKey="gc_old_time" stroke="#e67e22" fill="#e67e22" fillOpacity={0.12} strokeWidth={2} name="Old GC ms" />
          </AreaChart>
        );
      case 'ps_cpu':
        return (
          <LineChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} width={36}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="process_cpu_load" stroke="#e74c3c" strokeWidth={2} dot={false} name="CPU load" />
          </LineChart>
        );
      case 'ps_fds':
        return (
          <LineChart data={psAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} width={40}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="open_fds" stroke="#9b59b6" strokeWidth={2} dot={false} name="Open FDs" />
          </LineChart>
        );
      case 'pdb_heap':
        return (
          <AreaChart data={pdbAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" MB" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Area type="monotone" dataKey="used_mb" stroke="#0D6EFD" fill="#0D6EFD" fillOpacity={0.15} strokeWidth={2} name="Heap used MB" />
          </AreaChart>
        );
      case 'pdb_queue':
        return (
          <LineChart data={pdbAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} width={28}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="queue_depth" stroke="#e67e22" strokeWidth={2} dot={false} name="Queue depth" />
          </LineChart>
        );
      case 'pdb_catalog_save':
        return (
          <LineChart data={pdbAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="catalog_save_mean" stroke="#2980b9" strokeWidth={2} dot={false} name="catalog_save" />
          </LineChart>
        );
      case 'pdb_report_process':
        return (
          <LineChart data={pdbAligned} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis {...xAxis} />
            <YAxis tick={{ fontSize: 9 }} unit=" ms" width={44}  {...Y_NONNEG} />
            <ReTooltip {...TT} />
            <Line type="monotone" dataKey="report_process_mean" stroke="#16a085" strokeWidth={2} dot={false} name="report_process" />
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
            NOC wallboard of <strong>real charts</strong> on one shared timeline. Every time-series graph uses the
            same UTC hour buckets (window control below) so spikes line up across panels. Choose graphs; scroll for
            many; click to expand. Client-polled JMX series carry forward within an hour until the next sample.
          </Text>
        </div>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : '—'}
          </Text>
          <Select
            size="xs"
            w={100}
            label="Window"
            data={[
              { value: '12', label: '12h' },
              { value: '24', label: '24h' },
              { value: '48', label: '48h' },
              { value: '72', label: '72h' },
              { value: '168', label: '7d' },
            ]}
            value={String(windowHours)}
            onChange={(v) => setWindowHours(parseInt(v || '24', 10))}
            allowDeselect={false}
          />
          <Select
            size="xs"
            w={90}
            label="Refresh"
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
              refreshHistories?.();
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
            Multi-select any combination. History for live JMX series (heap, CPU, queue, route timings, etc.)
            is collected in the background for as long as this browser tab is open — even when you navigate
            to other pages. The wallboard will show the full trend when you return.
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

      
      <Alert variant="light" color="blue" title="Synchronized timeline">
        All trend graphs share domain <strong>{axisRangeLabel}</strong> (numeric UTC axis — spikes line up).
        Live Server/DB/JMX series keep poll resolution (background collector keeps them growing even off this page).
        Fleet/compliance/run trends use hourly points on the same window. Change <em>Window</em> to resync.
        Compliance distribution is a current snapshot only.
      </Alert>

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
