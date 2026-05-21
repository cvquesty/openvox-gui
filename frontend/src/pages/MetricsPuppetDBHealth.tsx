/**
 * OpenVox GUI - MetricsPuppetDBHealth.tsx
 *
 * PuppetDB Health Dashboard — JVM heap usage over time as a line chart,
 * service status badge, command queue stats, active node count.
 * Auto-refreshes every 10 seconds, accumulating data points for the graph.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Grid,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconDatabase, IconRefresh } from '@tabler/icons-react';
import { metrics } from '../services/api';

interface HeapDataPoint {
  time: string;
  ts: number;  // epoch ms for dedup and sorting
  used_mb: number;
  committed_mb: number;
  max_mb: number;
  pct: number;
  queue_depth: number;
}

const STORAGE_KEY = 'openvox_pdb_heap_history';
const MAX_POINTS = 360; // 1 hour at 10s intervals

function loadHistory(): HeapDataPoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveHistory(points: HeapDataPoint[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
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

export function MetricsPuppetDBHealthPage() {
  const [data, setData] = useState<any>(null);
  const [heapHistory, setHeapHistory] = useState<HeapDataPoint[]>(loadHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.puppetdbHealth();
      setData(result);
      setError(null);

      // Accumulate heap data point
      const jvm = result.jvm_heap || {};
      if (jvm.used_mb !== undefined) {
        const now = Date.now();
        const point: HeapDataPoint = {
          time: new Date().toLocaleTimeString(),
          ts: now,
          used_mb: jvm.used_mb,
          committed_mb: jvm.committed_mb,
          max_mb: jvm.max_mb,
          pct: jvm.pct,
          queue_depth: result.queue_depth ?? 0,
        };
        setHeapHistory(prev => {
          const updated = [...prev, point];
          const trimmed = updated.length > MAX_POINTS ? updated.slice(-MAX_POINTS) : updated;
          saveHistory(trimmed);
          return trimmed;
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load PuppetDB health');
    }
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    intervalRef.current = setInterval(fetchData, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const jvm = data.jvm_heap || {};
  const heapPct = jvm.pct ?? 0;
  const statusColor = data.status === 'running' ? 'green' : 'red';

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconDatabase size={28} />
          <Title order={2}>PuppetDB Health</Title>
          <Badge color={statusColor} variant="filled" size="lg">
            {data.status || 'unknown'}
          </Badge>
        </Group>
        <Group gap="xs">
          <IconRefresh size={14} style={{ opacity: 0.5 }} />
          <Text size="xs" c="dimmed">
            Auto-refresh 10s &middot; Updated {lastRefresh.toLocaleTimeString()}
          </Text>
          {error && <Badge color="orange" variant="light" size="sm">Refresh error</Badge>}
          {heapHistory.length > 0 && (
            <Text size="xs" c="dimmed" style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => { setHeapHistory([]); saveHistory([]); }}>
              Clear history ({heapHistory.length} points)
            </Text>
          )}
        </Group>
      </Group>

      {/* JVM Heap Usage Over Time */}
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>JVM Heap Usage Over Time</Title>
          <Group gap="xs">
            <Badge color={heapPct >= 90 ? 'red' : heapPct >= 70 ? 'yellow' : 'green'} variant="filled" size="lg">
              {heapPct.toFixed(1)}%
            </Badge>
            <Text size="sm" c="dimmed">{jvm.used_mb ?? 0} / {jvm.max_mb ?? 0} MB</Text>
          </Group>
        </Group>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={heapHistory} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gHeapUsed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gHeapCommit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2ecc71" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#2ecc71" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }}
              axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }} />
            <YAxis tick={{ fontSize: 11, fill: '#8899aa' }}
              axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }}
              domain={[0, jvm.max_mb ? Math.ceil(jvm.max_mb / 100) * 100 : 'auto']}
              unit=" MB" />
            <ReTooltip
              contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', padding: '10px 14px', fontSize: 12, color: '#e0e0e0' }}
              labelStyle={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}
              formatter={(value: number, name: string) => [`${value.toFixed(1)} MB`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Area type="monotone" dataKey="max_mb" name="Max Heap"
              stroke="#95a5a6" fill="none" strokeWidth={1} strokeDasharray="4 4" dot={false} />
            <Area type="monotone" dataKey="committed_mb" name="Committed"
              stroke="#2ecc71" fill="url(#gHeapCommit)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="used_mb" name="Used"
              stroke="#0D6EFD" fill="url(#gHeapUsed)" strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        {heapHistory.length < 3 && (
          <Text size="xs" c="dimmed" ta="center" mt="xs">
            Chart populates as data is collected (one point every 10 seconds)
          </Text>
        )}
      </Card>

      {/* Queue Depth Over Time */}
      {heapHistory.length > 2 && (
        <Card withBorder shadow="sm" padding="lg">
          <Title order={4} mb="md">Command Queue Depth Over Time</Title>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={heapHistory} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8899aa' }} allowDecimals={false} />
              <ReTooltip
                contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', padding: '10px 14px', fontSize: 12, color: '#e0e0e0' }}
                labelStyle={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}
              />
              <Line type="monotone" dataKey="queue_depth" name="Queue Depth"
                stroke="#e67e22" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Stat cards */}
      <Grid>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Queue Depth" value={data.queue_depth ?? 0}
            color={data.queue_depth > 100 ? 'red' : data.queue_depth > 10 ? 'yellow' : 'green'}
            description="Pending commands" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Processed" value={(data.processed ?? 0).toLocaleString()}
            color="blue" description="Total commands" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Retried" value={data.retried ?? 0}
            color={data.retried > 0 ? 'orange' : 'green'} description="Retry attempts" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Discarded" value={data.discarded ?? 0}
            color={data.discarded > 0 ? 'red' : 'green'} description="Dropped commands" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Active Nodes" value={data.active_nodes ?? 0}
            color="blue" description="Reporting in" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Server Time"
            value={data.server_time ? new Date(data.server_time).toLocaleTimeString() : '\u2014'}
            color="gray"
            description={data.server_time ? new Date(data.server_time).toLocaleDateString() : ''} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
