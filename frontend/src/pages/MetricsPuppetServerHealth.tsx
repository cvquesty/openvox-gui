/**
 * OpenVox GUI - MetricsPuppetServerHealth.tsx
 *
 * OpenVox Server Health page.
 * Positioned between Catalog Graph and OpenVoxDB Health in the Metrics nav.
 *
 * Covers the metrics shortfall vs puppet_operational_dashboards:
 * - Service status
 * - JVM heap & GC trends (live polling + history)
 * - Catalog compilation metrics
 * - JRuby pool / instance usage
 *
 * Uses server-side history (Phase 3) when available + client accumulation.
 * Auto-refreshes. Recharts for graphs. Layout matches Run Performance page (thumbnail grid, click to expand).
 * Renamed to OpenVox Server Health for branding consistency.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Grid, Button, Select, Paper,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconServer, IconRefresh, IconTrash, IconArrowsMaximize, IconArrowsMinimize, IconChartLine } from '@tabler/icons-react';
import { metrics } from '../services/api';

interface HistoryPoint {
  time: string;
  ts?: number;
  heap_used_mb?: number;
  heap_pct?: number;
  nonheap_used_mb?: number;
  nonheap_pct?: number;
  compile_time_ms?: number;
  jruby_active?: number;
  gc_young_time?: number;
  gc_old_time?: number;
  http_catalog_mean?: number;
  http_report_mean?: number;
  http_file_mean?: number;
  process_cpu_load?: number;
  open_fds?: number;
  [key: string]: any;
}

const REFRESH_OPTIONS = [
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1m' },
];

// Client-side persistence for OpenVox Server Health history (matches Run Performance pattern).
// Gives instant graphs with prior data on page entry without waiting for polls.
const PS_HEALTH_HISTORY_KEY = 'openvox_ps_health_history';
const PS_HEALTH_HISTORY_VERSION = 1;
const MAX_PS_POINTS = 360;

function loadPSHealthHistory(): HistoryPoint[] {
  try {
    const ver = localStorage.getItem(PS_HEALTH_HISTORY_KEY + '_v');
    if (ver !== String(PS_HEALTH_HISTORY_VERSION)) {
      localStorage.removeItem(PS_HEALTH_HISTORY_KEY);
      localStorage.setItem(PS_HEALTH_HISTORY_KEY + '_v', String(PS_HEALTH_HISTORY_VERSION));
      return [];
    }
    const raw = localStorage.getItem(PS_HEALTH_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePSHealthHistory(pts: HistoryPoint[]) {
  try {
    localStorage.setItem(PS_HEALTH_HISTORY_KEY, JSON.stringify(pts));
  } catch {}
}

function StatCard({ label, value, color, description }: {
  label: string; value: string | number; color?: string; description?: string;
}) {
  return (
    <Card withBorder shadow="sm" padding="md" ta="center">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700} c={color}>{value}</Text>
      {description && <Text size="xs" c="dimmed" mt={2}>{description}</Text>}
    </Card>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 } as const,
  itemStyle: { color: '#e0e0e0' } as const,
};

interface ChartPanelProps {
  title: string;
  expanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
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

export function MetricsPuppetServerHealthPage() {
  const [data, setData] = useState<any>(null);
  // Seed from localStorage so graphs have prior data immediately on page load (persistent collection UX)
  const [history, setHistory] = useState<HistoryPoint[]>(loadPSHealthHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshRate, setRefreshRate] = useState<string>('10');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.puppetserverHealth();
      setData(result);
      setError(null);

      // Prefer server-provided history (Phase 3 + background collector). It will contain points
      // even if some values were temporarily missing. This gives cross-session shared history.
      // Always persist whatever we end up with so revisits show data instantly.
      let nextHistory: HistoryPoint[] | null = null;
      if (result.history && Array.isArray(result.history) && result.history.length > 0) {
        nextHistory = result.history.map((p: any) => ({
          time: p.time,
          heap_used_mb: p.heap_used_mb,
          heap_pct: p.heap_pct,
          nonheap_used_mb: p.nonheap_used_mb,
          nonheap_pct: p.nonheap_pct,
          compile_time_ms: p.compile_time_ms,
          jruby_active: p.jruby_active,
          gc_young_time: p.gc_young_time,
          gc_old_time: p.gc_old_time,
          http_catalog_mean: p.http_catalog_mean,
          http_report_mean: p.http_report_mean,
          http_file_mean: p.http_file_mean,
          process_cpu_load: p.process_cpu_load,
          open_fds: p.open_fds,
        }));
      } else {
        // Always try to record a point when we have a successful response.
        // This way compile time and JRuby trends accumulate even if heap metrics
        // are not yet available on this poll.
        const now = Date.now();
        const point: HistoryPoint = {
          time: new Date().toLocaleTimeString(),
          ts: now,
          heap_used_mb: result.jvm_heap ? result.jvm_heap.used_mb : undefined,
          heap_pct: result.jvm_heap ? result.jvm_heap.pct : undefined,
          nonheap_used_mb: result.jvm_nonheap ? result.jvm_nonheap.used_mb : undefined,
          nonheap_pct: result.jvm_nonheap ? result.jvm_nonheap.pct : undefined,
          compile_time_ms: result.compile_time_ms,
          jruby_active: result.jruby_active,
          gc_young_time: (result.gc_young || {}).time_ms,
          gc_old_time: (result.gc_old || {}).time_ms,
          process_cpu_load: (result.os || {}).process_cpu_load,
          open_fds: (result.os || {}).open_file_descriptors,
        };
        // Only append if we have at least one interesting value, to avoid pure-empty spam
        if (point.heap_used_mb != null || point.compile_time_ms != null || point.jruby_active != null) {
          setHistory(prev => {
            const updated = [...prev, point];
            const trimmed = updated.length > MAX_PS_POINTS ? updated.slice(-MAX_PS_POINTS) : updated;
            savePSHealthHistory(trimmed);
            return trimmed;
          });
          // Early return for this branch (we saved inside setter)
          nextHistory = null;
        }
      }
      if (nextHistory) {
        const trimmed = nextHistory.length > MAX_PS_POINTS ? nextHistory.slice(-MAX_PS_POINTS) : nextHistory;
        setHistory(trimmed);
        savePSHealthHistory(trimmed);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load PuppetServer health');
    }
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const rate = parseInt(refreshRate) * 1000;
    if (rate <= 0) return;
    intervalRef.current = setInterval(fetchData, rate);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, refreshRate]);

  const clearHistory = () => {
    setHistory([]);
    savePSHealthHistory([]);
    // keep version marker
    try { localStorage.setItem(PS_HEALTH_HISTORY_KEY + '_v', String(PS_HEALTH_HISTORY_VERSION)); } catch {}
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const jvm = data.jvm_heap || {};
  const jvmnh = data.jvm_nonheap || {};
  const heapPct = jvm.pct ?? 0;
  const statusColor = (data.status || '').toLowerCase() === 'running' ? 'green' : 'red';

  const currentCompile = data.compile_time_ms ?? '—';
  const currentJRuby = data.jruby_active ?? '—';
  const currentReport = (data.http_metrics || []).find((h: any) => (h.route || '').includes('report'))?.mean ?? data.http_report_mean ?? '—';
  const currentFile = (data.http_metrics || []).find((h: any) => (h.route || '').includes('file_content'))?.mean ?? data.http_file_mean ?? '—';

  // Prepare chart data for expanded set (more streams)
  const heapData = history.map(h => ({
    time: h.time,
    used: h.heap_used_mb,
    pct: h.heap_pct,
  }));

  const nonheapData = history.map(h => ({
    time: h.time,
    used: h.nonheap_used_mb,
    pct: h.nonheap_pct,
  }));

  const compileData = history.map(h => ({
    time: h.time,
    compile: h.compile_time_ms,
  }));

  const reportData = history.map(h => ({
    time: h.time,
    mean: h.http_report_mean,
  }));

  const fileData = history.map(h => ({
    time: h.time,
    mean: h.http_file_mean,
  }));

  const jrubyData = history.map(h => ({
    time: h.time,
    active: h.jruby_active,
  }));

  const gcYoungData = history.map(h => ({
    time: h.time,
    time_ms: h.gc_young_time,
  }));

  const gcOldData = history.map(h => ({
    time: h.time,
    time_ms: h.gc_old_time,
  }));

  const cpuData = history.map(h => ({
    time: h.time,
    load: h.process_cpu_load != null ? h.process_cpu_load * 100 : undefined,
  }));

  const fdsData = history.map(h => ({
    time: h.time,
    fds: h.open_fds,
  }));

  const hasHistory = history.length > 2;

  // Define charts like Run Performance page for consistent thumbnail grid + expand UX
  // Expanded to cover the 8+ data streams (server side JVM/GC/HTTP/JRuby/OS + phases in raw)
  const charts: Array<{ id: string; title: string; stats?: any[]; render: () => React.ReactNode }> = [
    {
      id: 'jvm-heap',
      title: 'JVM Heap Usage',
      stats: [
        { label: 'Used', value: `${jvm.used_mb ?? 0} MB` },
        { label: 'Max', value: `${jvm.max_mb ?? 0} MB` },
        { label: 'Pct', value: `${heapPct.toFixed(1)}%` },
      ],
      render: () => (
        <AreaChart data={heapData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gPsHeap" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" MB" />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v} MB`, '']} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area type="natural" dataKey="used" stroke="#0D6EFD" fill="url(#gPsHeap)" strokeWidth={2} dot={false} name="Used" />
        </AreaChart>
      ),
    },
    {
      id: 'jvm-nonheap',
      title: 'JVM Non-Heap (Metaspace)',
      stats: [
        { label: 'Used', value: `${jvmnh.used_mb ?? 0} MB` },
        { label: 'Committed', value: `${jvmnh.committed_mb ?? 0} MB` },
      ],
      render: () => (
        <AreaChart data={nonheapData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" MB" />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v} MB`, '']} />
          <Area type="natural" dataKey="used" stroke="#8e44ad" fillOpacity={0.25} strokeWidth={2} dot={false} name="Non-heap used" />
        </AreaChart>
      ),
    },
    {
      id: 'compile-time',
      title: 'Catalog Route Mean (ms)',
      stats: [{ label: 'Current', value: `${currentCompile} ms`, color: 'orange' }],
      render: () => (
        <LineChart data={compileData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line type="natural" dataKey="compile" stroke="#e67e22" strokeWidth={2} dot={false} name="Catalog mean (ms)" />
        </LineChart>
      ),
    },
    {
      id: 'report-mean',
      title: 'Report Submission Mean (ms)',
      stats: [{ label: 'Current', value: `${currentReport} ms`, color: 'green' }],
      render: () => (
        <LineChart data={reportData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line type="natural" dataKey="mean" stroke="#27ae60" strokeWidth={2} dot={false} name="Report mean (ms)" />
        </LineChart>
      ),
    },
    {
      id: 'file-mean',
      title: 'File Content Mean (ms)',
      stats: [{ label: 'Current', value: `${currentFile} ms`, color: 'blue' }],
      render: () => (
        <AreaChart data={fileData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area type="natural" dataKey="mean" stroke="#3498db" fillOpacity={0.3} strokeWidth={2} dot={false} name="File mean (ms)" />
        </AreaChart>
      ),
    },
    {
      id: 'jruby-pool',
      title: 'Total Req Mean (ms) - load proxy',
      stats: [{ label: 'Current', value: `${currentJRuby} ms`, color: 'violet' }],
      render: () => (
        <AreaChart data={jrubyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area type="natural" dataKey="active" stroke="#9b59b6" fillOpacity={0.3} strokeWidth={2} dot={false} name="Total mean (ms)" />
        </AreaChart>
      ),
    },
    {
      id: 'gc-young',
      title: 'GC Young Gen Time (ms)',
      stats: [{ label: 'Last', value: (data.gc_young && data.gc_young.time_ms) ? `${data.gc_young.time_ms} ms` : '—' }],
      render: () => (
        <LineChart data={gcYoungData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line type="natural" dataKey="time_ms" stroke="#e74c3c" strokeWidth={2} dot={false} name="Young GC ms" />
        </LineChart>
      ),
    },
    {
      id: 'gc-old',
      title: 'GC Old Gen Time (ms)',
      stats: [{ label: 'Last', value: (data.gc_old && data.gc_old.time_ms) ? `${data.gc_old.time_ms} ms` : '—' }],
      render: () => (
        <LineChart data={gcOldData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line type="natural" dataKey="time_ms" stroke="#c0392b" strokeWidth={2} dot={false} name="Old GC ms" />
        </LineChart>
      ),
    },
    {
      id: 'cpu-load',
      title: 'Process CPU Load (%)',
      stats: [{ label: 'Current', value: data.os && data.os.process_cpu_load != null ? `${(data.os.process_cpu_load * 100).toFixed(1)}%` : '—' }],
      render: () => (
        <AreaChart data={cpuData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" %" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area type="natural" dataKey="load" stroke="#f39c12" fillOpacity={0.25} strokeWidth={2} dot={false} name="CPU %" />
        </AreaChart>
      ),
    },
    {
      id: 'open-fds',
      title: 'Open File Descriptors',
      stats: [{ label: 'Current', value: data.os && data.os.open_file_descriptors != null ? data.os.open_file_descriptors : '—' }],
      render: () => (
        <LineChart data={fdsData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line type="natural" dataKey="fds" stroke="#16a085" strokeWidth={2} dot={false} name="Open FDs" />
        </LineChart>
      ),
    },
  ];

  // Top level stats like Run Performance
  const topStats = [
    { label: 'Status', value: data.status || '—', color: statusColor },
    { label: 'Catalog mean (ms)', value: currentCompile, color: 'orange' },
    { label: 'Report mean (ms)', value: currentReport, color: 'green' },
    { label: 'Total mean (ms)', value: currentJRuby, color: 'violet' },
    { label: 'Heap %', value: `${heapPct.toFixed(1)}%`, color: heapPct > 85 ? 'red' : 'blue' },
    { label: 'Heap Used', value: `${jvm.used_mb ?? '—'} / ${jvm.max_mb ?? '—'} MB` },
    { label: 'CPU %', value: data.os && data.os.process_cpu_load != null ? (data.os.process_cpu_load * 100).toFixed(1) + '%' : '—' },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconServer size={28} />
          <Title order={2}>OpenVox Server Health</Title>
          <Badge color={statusColor} variant="filled" size="lg">
            {data.status || 'unknown'}
          </Badge>
        </Group>
        <Group gap="xs">
          <Select size="xs" data={REFRESH_OPTIONS} value={refreshRate}
            onChange={(v) => setRefreshRate(v || '10')} style={{ width: 90 }} />
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />}
            onClick={fetchData}>Refresh</Button>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconTrash size={14} />}
            onClick={clearHistory}>
            Clear History
          </Button>
          <Text size="xs" c="dimmed">Updated {lastRefresh.toLocaleTimeString()}</Text>
          {error && <Badge color="orange" variant="light" size="sm">Refresh error</Badge>}
        </Group>
      </Group>

      {/* Top stats row, matching Run Performance style */}
      <Group grow>
        {topStats.map((s, i) => (
          <Paper key={i} withBorder p="sm" ta="center">
            <Text size="xs" c="dimmed">{s.label}</Text>
            <Text size="lg" fw={700} c={s.color}>{s.value}</Text>
          </Paper>
        ))}
      </Group>

      {/* Expandable chart grid like Run Performance */}
      {expanded ? (
        (() => {
          const chart = charts.find(c => c.id === expanded);
          if (!chart) return null;
          return (
            <ChartPanel title={chart.title} expanded={true} onClick={() => toggleExpand(chart.id)} stats={chart.stats}>
              {chart.render()}
            </ChartPanel>
          );
        })()
      ) : (
        <Grid>
          {charts.map(chart => (
            <Grid.Col key={chart.id} span={6}>
              <ChartPanel title={chart.title} expanded={false} onClick={() => toggleExpand(chart.id)} stats={chart.stats}>
                {chart.render()}
              </ChartPanel>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Additional raw metrics for debugging / Phase 2 */}
      {data.raw && (
        <Card withBorder shadow="sm" padding="lg">
          <Title order={4} mb="sm">Additional Server Metrics (raw)</Title>
          <Text size="xs" c="dimmed">From Puppet Server /status and /metrics/v2. Use the list endpoint for full discovery.</Text>
          <pre style={{ fontSize: 11, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
            {JSON.stringify(data.raw, null, 2)}
          </pre>
        </Card>
      )}

      <Text size="xs" c="dimmed">
        Polls Puppet Server status + metrics/v2 (Jolokia). Server history (shared) + client accumulation. 
        <strong>Configuration required on OpenVox Server (Puppet 8+):</strong> See the metrics.conf example below (no top-level "enabled"). Use the auth.conf rules with match-request that you provided. Restart puppetserver after changes. Check the "raw" section in this page for what is actually returned.
      </Text>
    </Stack>
  );
}
