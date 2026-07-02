/**
 * OpenVox GUI - MetricsPuppetDBHealth.tsx
 *
 * OpenVoxDB Health Dashboard — JVM heap usage over time as a line chart,
 * service status badge, command queue stats, active node count.
 * Auto-refreshes every 30 seconds, accumulating data points for the graph.
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
import { IconDatabase, IconRefresh, IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { metrics } from '../services/api';

interface HeapDataPoint {
  time: string;
  ts: number;  // epoch ms for dedup and sorting
  used_mb: number;
  committed_mb: number;
  max_mb: number;
  pct: number;
  queue_depth: number;
  nonheap_used_mb?: number;
  // DB interaction proxies from PS
  catalog_save_mean?: number;
  report_process_mean?: number;
  replace_catalog_mean?: number;
  store_report_mean?: number;
  replace_facts_mean?: number;
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
  const height = expanded ? 420 : 180;
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

/** embedded: compact chrome for Insights | Monitoring wallboard (same charts/data as full page). */
export function MetricsPuppetDBHealthPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<any>(null);
  const [heapHistory, setHeapHistory] = useState<HeapDataPoint[]>(loadHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.puppetdbHealth();
      setData(result);
      setError(null);

      // Accumulate heap + DB interaction data points (persistent client history)
      const jvm = result.jvm_heap || {};
      const nh = result.jvm_nonheap || {};
      if (jvm.used_mb !== undefined || result.ps_puppetdb_metrics || result.http_client_metrics) {
        const now = Date.now();
        // Pull some means from ps_ lists for history
        const pdbm = result.ps_puppetdb_metrics || [];
        const hcm = result.http_client_metrics || [];
        const findMean = (arr: any[], key: string) => arr.find((x: any) => (x.metric || '').includes(key))?.mean;

        const point: HeapDataPoint = {
          time: new Date().toLocaleTimeString(),
          ts: now,
          used_mb: jvm.used_mb ?? 0,
          committed_mb: jvm.committed_mb ?? 0,
          max_mb: jvm.max_mb ?? 0,
          pct: jvm.pct ?? 0,
          queue_depth: result.queue_depth ?? 0,
          nonheap_used_mb: nh.used_mb,
          catalog_save_mean: findMean(pdbm, 'catalog_save'),
          report_process_mean: findMean(pdbm, 'report_process'),
          replace_catalog_mean: findMean(hcm, 'replace_catalog'),
          store_report_mean: findMean(hcm, 'store_report'),
          replace_facts_mean: findMean(hcm, 'replace_facts'),
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
    intervalRef.current = setInterval(fetchData, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  if (loading) return <Center h={embedded ? 200 : 400}><Loader size={embedded ? 'md' : 'xl'} /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const jvm = data.jvm_heap || {};
  const nh = data.jvm_nonheap || {};
  const heapPct = jvm.pct ?? 0;
  const statusColor = data.status === 'running' ? 'green' : 'red';

  // Prepare series from history (now carries DB interaction means)
  const pdbHeapData = heapHistory.map(h => ({ time: h.time, used: h.used_mb, pct: h.pct }));
  const pdbNonheapData = heapHistory.map(h => ({ time: h.time, used: h.nonheap_used_mb }));
  const queueData = heapHistory.map(h => ({ time: h.time, depth: h.queue_depth }));
  const catSaveData = heapHistory.map(h => ({ time: h.time, mean: h.catalog_save_mean }));
  const reportProcData = heapHistory.map(h => ({ time: h.time, mean: h.report_process_mean }));
  const repCatData = heapHistory.map(h => ({ time: h.time, mean: h.replace_catalog_mean }));
  const storeRepData = heapHistory.map(h => ({ time: h.time, mean: h.store_report_mean }));
  const repFactsData = heapHistory.map(h => ({ time: h.time, mean: h.replace_facts_mean }));

  // Rich chart set for OpenVoxDB Health (DB interaction + core PDB health)
  const dbCharts: Array<{ id: string; title: string; stats?: any[]; render: () => React.ReactNode }> = [
    {
      id: 'pdb-heap',
      title: 'PDB JVM Heap',
      stats: [{ label: 'Used', value: `${jvm.used_mb ?? 0} MB` }, { label: '%', value: `${heapPct.toFixed(1)}%` }],
      render: () => (
        <AreaChart data={pdbHeapData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id="gPdbH" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.3} /><stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" MB" />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v} MB`, '']} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="used" stroke="#0D6EFD" fill="url(#gPdbH)" strokeWidth={2} dot={false} name="Heap used" />
        </AreaChart>
      ),
    },
    {
      id: 'pdb-nonheap',
      title: 'PDB Non-Heap',
      stats: [{ label: 'Used', value: `${nh.used_mb ?? 0} MB` }],
      render: () => (
        <AreaChart data={pdbNonheapData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" MB" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="used" stroke="#8e44ad" fillOpacity={0.25} strokeWidth={2} dot={false} name="Non-heap" />
        </AreaChart>
      ),
    },
    {
      id: 'queue',
      title: 'PDB Command Queue Depth',
      stats: [{ label: 'Current', value: data.queue_depth ?? 0 }],
      render: () => (
        <LineChart data={queueData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line isAnimationActive={false} animationDuration={0} type="natural" dataKey="depth" stroke="#e67e22" strokeWidth={2} dot={false} name="Queue" />
        </LineChart>
      ),
    },
    {
      id: 'catalog-save',
      title: 'PS: catalog_save mean (ms)',
      stats: [{ label: 'Last', value: (catSaveData.slice().reverse().find((d: { mean?: number }) => d.mean != null) || {}).mean?.toFixed?.(0) ?? '—' }],
      render: () => (
        <LineChart data={catSaveData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line isAnimationActive={false} animationDuration={0} type="natural" dataKey="mean" stroke="#2980b9" strokeWidth={2} dot={false} name="catalog_save" />
        </LineChart>
      ),
    },
    {
      id: 'report-proc',
      title: 'PS: report_process mean (ms)',
      stats: [{ label: 'Last', value: (reportProcData.slice().reverse().find((d: { mean?: number }) => d.mean != null) || {}).mean?.toFixed?.(0) ?? '—' }],
      render: () => (
        <LineChart data={reportProcData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line isAnimationActive={false} animationDuration={0} type="natural" dataKey="mean" stroke="#16a085" strokeWidth={2} dot={false} name="report_process" />
        </LineChart>
      ),
    },
    {
      id: 'replace-cat',
      title: 'http-client: replace_catalog (ms)',
      stats: [{ label: 'Last', value: (repCatData.slice().reverse().find((d: { mean?: number }) => d.mean != null) || {}).mean?.toFixed?.(0) ?? '—' }],
      render: () => (
        <AreaChart data={repCatData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="mean" stroke="#e74c3c" fillOpacity={0.25} strokeWidth={2} dot={false} name="replace_catalog" />
        </AreaChart>
      ),
    },
    {
      id: 'store-report',
      title: 'http-client: store_report (ms)',
      stats: [{ label: 'Last', value: (storeRepData.slice().reverse().find((d: { mean?: number }) => d.mean != null) || {}).mean?.toFixed?.(0) ?? '—' }],
      render: () => (
        <AreaChart data={storeRepData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Area isAnimationActive={false} animationDuration={0} type="natural" dataKey="mean" stroke="#c0392b" fillOpacity={0.25} strokeWidth={2} dot={false} name="store_report" />
        </AreaChart>
      ),
    },
    {
      id: 'replace-facts',
      title: 'http-client: replace_facts (ms)',
      stats: [{ label: 'Last', value: (repFactsData.slice().reverse().find((d: { mean?: number }) => d.mean != null) || {}).mean?.toFixed?.(0) ?? '—' }],
      render: () => (
        <LineChart data={repFactsData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} unit=" ms" />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Line isAnimationActive={false} animationDuration={0} type="natural" dataKey="mean" stroke="#9b59b6" strokeWidth={2} dot={false} name="replace_facts" />
        </LineChart>
      ),
    },
  ];

  return (
    <Stack gap={embedded ? 'sm' : 'md'}>
      <Group justify="space-between">
        <Group gap="sm">
          <IconDatabase size={embedded ? 22 : 28} />
          <Title order={embedded ? 3 : 2}>OpenVoxDB Health</Title>
          <Badge color={statusColor} variant="filled" size="lg">
            {data.status || 'unknown'}
          </Badge>
        </Group>
        <Group gap="xs">
          <IconRefresh size={14} style={{ opacity: 0.5 }} />
          <Text size="xs" c="dimmed">
            Auto-refresh 30s &middot; Updated {lastRefresh.toLocaleTimeString()}
          </Text>
          {error && <Badge color="orange" variant="light" size="sm">Refresh error</Badge>}
          {heapHistory.length > 0 && (
            <Text size="xs" c="dimmed" style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => { setHeapHistory([]); saveHistory([]); }}>
              Clear history
            </Text>
          )}
        </Group>
      </Group>

      {/* Expandable chart grid (like Server Health / Run Performance) */}
      {expanded ? (
        (() => {
          const ch = dbCharts.find(c => c.id === expanded);
          if (!ch) return null;
          return <ChartPanel title={ch.title} expanded={true} onClick={() => toggleExpand(ch.id)} stats={ch.stats}>{ch.render()}</ChartPanel>;
        })()
      ) : (
        <Grid>
          {dbCharts.map(ch => (
            <Grid.Col key={ch.id} span={6}>
              <ChartPanel title={ch.title} expanded={false} onClick={() => toggleExpand(ch.id)} stats={ch.stats}>{ch.render()}</ChartPanel>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Stat cards - core + new DB interaction */}
      <Grid>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Queue Depth" value={data.queue_depth ?? 0}
            color={data.queue_depth > 100 ? 'red' : data.queue_depth > 10 ? 'yellow' : 'green'}
            description="Pending commands" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Processed" value={(data.processed ?? 0).toLocaleString()} color="blue" description="Total commands" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Active Nodes" value={data.active_nodes ?? 0} color="blue" description="Reporting in" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="catalog_save (PS)" value={data.ps_puppetdb_metrics ? (data.ps_puppetdb_metrics.find((x: any) => x.metric?.includes('catalog_save'))?.mean?.toFixed(0) + 'ms') : '—'} color="teal" description="Server view" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="replace_catalog (PS→PDB)" value={data.http_client_metrics ? (data.http_client_metrics.find((x: any) => (x.metric||'').includes('replace_catalog'))?.mean?.toFixed(0) + 'ms') : '—'} color="red" description="Command" />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard label="Heap %" value={`${heapPct.toFixed(1)}%`} color={heapPct > 85 ? 'red' : 'blue'} />
        </Grid.Col>
      </Grid>

      {!embedded && (
        <Text size="xs" c="dimmed">
          DB interaction metrics (puppetdb_* and http-client-*) come from Puppet Server experimental status.
          Additional PDB Jolokia metrics (pools, storage, GC, population) are available in Metrics → Run Performance.
        </Text>
      )}
    </Stack>
  );
}
