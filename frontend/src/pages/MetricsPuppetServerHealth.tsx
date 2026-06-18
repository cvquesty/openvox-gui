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
  compile_time_ms?: number;
  jruby_active?: number;
  [key: string]: any;
}

const REFRESH_OPTIONS = [
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1m' },
];

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
  const [history, setHistory] = useState<HistoryPoint[]>([]);
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

      // Prefer server-provided history (Phase 3). It will contain points even if some
      // values were temporarily missing. Fall back to local accumulation.
      if (result.history && Array.isArray(result.history) && result.history.length > 0) {
        setHistory(result.history.map((p: any) => ({
          time: p.time,
          heap_used_mb: p.heap_used_mb,
          heap_pct: p.heap_pct,
          compile_time_ms: p.compile_time_ms,
          jruby_active: p.jruby_active,
        })));
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
          compile_time_ms: result.compile_time_ms,
          jruby_active: result.jruby_active,
        };
        // Only append if we have at least one interesting value, to avoid pure-empty spam
        if (point.heap_used_mb != null || point.compile_time_ms != null || point.jruby_active != null) {
          setHistory(prev => {
            const updated = [...prev, point];
            return updated.length > 360 ? updated.slice(-360) : updated;
          });
        }
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
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const jvm = data.jvm_heap || {};
  const heapPct = jvm.pct ?? 0;
  const statusColor = (data.status || '').toLowerCase() === 'running' ? 'green' : 'red';

  const currentCompile = data.compile_time_ms ?? '—';
  const currentJRuby = data.jruby_active ?? '—';

  // Prepare chart data
  // Include all points so the time axis shows the full history even if a particular
  // metric is temporarily unavailable on some polls.
  const heapData = history.map(h => ({
    time: h.time,
    used: h.heap_used_mb,
    pct: h.heap_pct,
  }));

  const compileData = history.map(h => ({
    time: h.time,
    compile: h.compile_time_ms,
  }));

  const jrubyData = history.map(h => ({
    time: h.time,
    active: h.jruby_active,
  }));

  const hasHistory = history.length > 2;

  // Define charts like Run Performance page for consistent thumbnail grid + expand UX
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
      id: 'compile-time',
      title: 'Catalog Route Mean (ms) - compile proxy',
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
      id: 'jruby-pool',
      title: 'Total Req Mean (ms) - server load proxy',
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
  ];

  // Top level stats like Run Performance
  const topStats = [
    { label: 'Status', value: data.status || '—', color: statusColor },
    { label: 'Catalog mean (ms)', value: currentCompile, color: 'orange' },
    { label: 'Total mean (ms)', value: currentJRuby, color: 'violet' },
    { label: 'Heap %', value: `${heapPct.toFixed(1)}%`, color: heapPct > 85 ? 'red' : 'blue' },
    { label: 'Heap Used', value: `${jvm.used_mb ?? '—'} / ${jvm.max_mb ?? '—'} MB` },
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
