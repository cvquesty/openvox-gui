/**
 * OpenVox GUI - MetricsPuppetServerHealth.tsx
 *
 * PuppetServer Health page.
 * Positioned between Catalog Graph and PuppetDB Health in the Metrics nav.
 *
 * Covers the metrics shortfall vs puppet_operational_dashboards:
 * - Service status
 * - JVM heap & GC trends (live polling + history)
 * - Catalog compilation metrics
 * - JRuby pool / instance usage
 * - HTTP / request serving metrics
 * - Additional performance charts (Phase 2)
 *
 * Uses server-side history (Phase 3) when available + client accumulation.
 * Auto-refreshes. Recharts for graphs. Pattern-matched to PuppetDB Health.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Grid, Button, Select,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconServer, IconRefresh, IconTrash } from '@tabler/icons-react';
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

      // Prefer server history (Phase 3), fall back to building local
      if (result.history && Array.isArray(result.history) && result.history.length > 0) {
        setHistory(result.history.map((p: any) => ({
          time: p.time,
          heap_used_mb: p.heap_used_mb,
          heap_pct: p.heap_pct,
          compile_time_ms: p.compile_time_ms,
          jruby_active: p.jruby_active,
        })));
      } else if (result.jvm_heap) {
        const now = Date.now();
        const point: HistoryPoint = {
          time: new Date().toLocaleTimeString(),
          ts: now,
          heap_used_mb: result.jvm_heap.used_mb,
          heap_pct: result.jvm_heap.pct,
          compile_time_ms: result.compile_time_ms,
          jruby_active: result.jruby_active,
        };
        setHistory(prev => {
          const updated = [...prev, point];
          return updated.length > 360 ? updated.slice(-360) : updated;
        });
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
  const heapData = history.filter(h => h.heap_used_mb != null).map(h => ({
    time: h.time,
    used: h.heap_used_mb,
    pct: h.heap_pct,
  }));

  const compileData = history.filter(h => h.compile_time_ms != null).map(h => ({
    time: h.time,
    compile: h.compile_time_ms,
  }));

  const jrubyData = history.filter(h => h.jruby_active != null).map(h => ({
    time: h.time,
    active: h.jruby_active,
  }));

  const hasHistory = history.length > 2;

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconServer size={28} />
          <Title order={2}>PuppetServer Health</Title>
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

      {/* JVM Heap Over Time */}
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>JVM Heap Usage</Title>
          <Group gap="xs">
            <Badge color={heapPct >= 90 ? 'red' : heapPct >= 70 ? 'yellow' : 'green'} variant="filled" size="lg">
              {heapPct.toFixed(1)}%
            </Badge>
            <Text size="sm" c="dimmed">{jvm.used_mb ?? 0} / {jvm.max_mb ?? 0} MB</Text>
          </Group>
        </Group>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={heapData.length ? heapData : [{time: '—', used: 0}]} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gPsHeap" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }} />
            <YAxis tick={{ fontSize: 11, fill: '#8899aa' }} unit=" MB" />
            <ReTooltip
              contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', padding: '10px 14px', fontSize: 12, color: '#e0e0e0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="used" name="Used Heap" stroke="#0D6EFD" fill="url(#gPsHeap)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        {!hasHistory && <Text size="xs" c="dimmed" ta="center" mt="xs">Chart populates on refresh (server history or live samples)</Text>}
      </Card>

      {/* Compilation & JRuby */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Compilation Time</Title>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={compileData.length ? compileData : [{time: '—', compile: 0}]} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }} />
                <YAxis tick={{ fontSize: 11, fill: '#8899aa' }} unit=" ms" />
                <ReTooltip contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="compile" name="Avg Compile (ms)" stroke="#e67e22" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <Text size="sm" mt="xs">Current: <b>{currentCompile}</b> ms</Text>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">JRuby Pool</Title>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={jrubyData.length ? jrubyData : [{time: '—', active: 0}]} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }} />
                <YAxis tick={{ fontSize: 11, fill: '#8899aa' }} allowDecimals={false} />
                <ReTooltip contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Area type="monotone" dataKey="active" name="Active JRubies" stroke="#9b59b6" fillOpacity={0.3} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <Text size="sm" mt="xs">Active: <b>{currentJRuby}</b> {data.jruby_max ? `/ ${data.jruby_max}` : ''}</Text>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Stat cards */}
      <Grid>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Status" value={data.status || '—'} color={statusColor} />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Compile (ms)" value={currentCompile} color="orange" description="avg / recent" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="JRuby Active" value={currentJRuby} color="violet" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Heap %" value={heapPct.toFixed(1) + '%'} color={heapPct > 85 ? 'red' : 'blue'} />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Heap Used" value={`${jvm.used_mb ?? '—'} MB`} description={`${jvm.max_mb ?? '—'} max`} />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Last Update" value={lastRefresh.toLocaleTimeString()} color="gray" />
        </Grid.Col>
      </Grid>

      {/* Phase 2: Additional performance insights (if richer data present) */}
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
        If metrics are sparse, enable more in puppetserver metrics.conf or use the operational dashboards module for deeper Grafana views.
      </Text>
    </Stack>
  );
}
