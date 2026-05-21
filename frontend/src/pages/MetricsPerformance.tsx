/**
 * OpenVox GUI - MetricsPerformance.tsx
 *
 * Run Performance — 10 charts in a thumbnail grid (2 per row).
 * Click any chart to expand it full-width. Click again to collapse.
 * Combines agent-side metrics (from PuppetDB reports) with server-side
 * metrics (from PuppetDB Jolokia/JMX).
 */
import { useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, Cell,
} from 'recharts';
import { IconChartLine, IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
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
  return `${v.toFixed(0)}ms`;
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

export function MetricsPerformancePage() {
  const [perfData, setPerfData] = useState<any>(null);
  const [serverData, setServerData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [perf, server] = await Promise.all([
        perfApi.getOverview(),
        metrics.puppetdbPerformance().catch(() => null),
      ]);
      setPerfData(perf);
      setServerData(server);
    } catch (err: any) {
      setError(err.message || 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!perfData) return null;

  // Agent-side data
  const rawTrends = perfData.run_time_trends || [];
  const trends = rawTrends.filter((_: any, i: number) => i % 2 === 0).slice(-120);
  const nodeComparison = (perfData.node_comparison || [])
    .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
    .slice(0, 10);
  const stats = perfData.stats || {};

  const top10Names = nodeComparison.map((n: any) => n.certname);
  const top10Data = useMemo(() => {
    const timeMap: Record<string, any> = {};
    for (const run of trends) {
      if (!timeMap[run.time]) timeMap[run.time] = { time: run.time };
    }
    for (const run of trends) {
      if (top10Names.includes(run.certname)) {
        timeMap[run.time][run.certname] = run.total;
      }
    }
    return Object.values(timeMap).sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
  }, [trends, top10Names]);

  // Server-side data
  const s = serverData || {};

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
    { name: 'Catalog', mean: jmxVal(s.catalog_processing, 'Mean') / 1000, p95: (s.catalog_processing?.['95thPercentile'] ?? 0) / 1000 },
    { name: 'Facts', mean: jmxVal(s.facts_processing, 'Mean') / 1000, p95: (s.facts_processing?.['95thPercentile'] ?? 0) / 1000 },
    { name: 'Report', mean: jmxVal(s.report_processing, 'Mean') / 1000, p95: (s.report_processing?.['95thPercentile'] ?? 0) / 1000 },
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
          <Area type="natural" dataKey="total" stroke="#0D6EFD" fill="url(#gT)" strokeWidth={2} dot={false} name="Total" />
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
          <Area type="natural" dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Fact Gen" />
          <Area type="natural" dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} dot={false} name="Plugin Sync" />
          <Area type="natural" dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} dot={false} name="Config Retrieval" />
          <Area type="natural" dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1.5} dot={false} name="Catalog Apply" />
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
            <Area key={n.certname} type="natural" dataKey={n.certname}
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
        <BarChart data={cmdData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="mean" fill="#0D6EFD" name="Mean" radius={[4,4,0,0]} />
          <Bar dataKey="p95" fill="#e67e22" name="95th Percentile" radius={[4,4,0,0]} />
        </BarChart>
      ),
    },
    {
      id: 'storage-timing', title: 'Storage Operation Timing',
      render: () => (
        <BarChart data={storageData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [formatMs(v), 'Mean']} />
          <Bar dataKey="mean" name="Mean Time" radius={[4,4,0,0]}>
            {storageData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
          </Bar>
        </BarChart>
      ),
    },
    {
      id: 'db-pool', title: 'Database Connection Pool',
      render: () => (
        <BarChart data={poolData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} allowDecimals={false} />
          <ReTooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="value" name="Connections" radius={[4,4,0,0]}>
            {poolData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      ),
    },
    {
      id: 'http-latency', title: 'HTTP API Latency',
      render: () => (
        <BarChart data={httpData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
          <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
          <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatMs(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="mean" fill="#3498db" name="Mean" radius={[4,4,0,0]} />
          <Bar dataKey="p95" fill="#e74c3c" name="95th Pct" radius={[4,4,0,0]} />
        </BarChart>
      ),
    },
    {
      id: 'catalog-dedup', title: 'Catalog Deduplication',
      stats: [{ label: 'Dedup Rate', value: `${(Number(jmxVal(s.dedup_pct, 'Value') || 0) * 100).toFixed(1)}%`, color: 'green' }],
      render: () => {
        const dedupData = [
          { name: 'Hash Match', value: jmxVal(s.catalog_hash_match, 'Mean') / 1000 },
          { name: 'Hash Miss', value: jmxVal(s.catalog_hash_miss, 'Mean') / 1000 },
        ].filter(d => d.value > 0);
        return (
          <BarChart data={dedupData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
            <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} tickFormatter={formatMs} />
            <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [formatMs(v), 'Time']} />
            <Bar dataKey="value" name="Time" radius={[4,4,0,0]}>
              <Cell fill="#2ecc71" />
              <Cell fill="#e74c3c" />
            </Bar>
          </BarChart>
        );
      },
    },
    {
      id: 'gc-pressure', title: 'GC Pressure',
      stats: [
        { label: 'Young GC', value: `${Number(jmxVal(s.gc_young, 'CollectionCount')) || 0} collections`, color: 'cyan' },
        { label: 'Old GC', value: `${Number(jmxVal(s.gc_old, 'CollectionCount')) || 0} collections`, color: 'orange' },
      ],
      render: () => {
        const gcData = [
          { name: 'Young Gen', count: Number(jmxVal(s.gc_young, 'CollectionCount')) || 0, time_ms: Number(jmxVal(s.gc_young, 'CollectionTime')) || 0 },
          { name: 'Old Gen', count: Number(jmxVal(s.gc_old, 'CollectionCount')) || 0, time_ms: Number(jmxVal(s.gc_old, 'CollectionTime')) || 0 },
        ];
        return (
          <BarChart data={gcData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
            <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
            <ReTooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="count" fill="#3498db" name="Collections" radius={[4,4,0,0]} />
            <Bar dataKey="time_ms" fill="#e67e22" name="Time (ms)" radius={[4,4,0,0]} />
          </BarChart>
        );
      },
    },
    {
      id: 'population', title: 'Fleet Population',
      stats: [
        { label: 'Nodes', value: `${Number(jmxVal(s.population_nodes, 'Value')) || 0}` },
        { label: 'Resources', value: `${Number(jmxVal(s.population_resources, 'Value')) || 0}` },
        { label: 'Avg/Node', value: `${(Number(jmxVal(s.population_avg_resources, 'Value')) || 0).toFixed(0)}` },
      ],
      render: () => {
        const popData = [
          { name: 'Nodes', value: Number(jmxVal(s.population_nodes, 'Value')) || 0 },
          { name: 'Resources', value: Number(jmxVal(s.population_resources, 'Value')) || 0 },
          { name: 'Avg/Node', value: Number(jmxVal(s.population_avg_resources, 'Value')) || 0 },
        ];
        return (
          <BarChart data={popData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} />
            <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
            <ReTooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="value" name="Count" radius={[4,4,0,0]}>
              <Cell fill="#0D6EFD" />
              <Cell fill="#2ecc71" />
              <Cell fill="#e67e22" />
            </Bar>
          </BarChart>
        );
      },
    },
  ];

  return (
    <Stack>
      <Group gap="sm">
        <IconChartLine size={28} />
        <Title order={2}>Run Performance</Title>
        <Badge variant="light" color="blue" size="lg">{stats.total_runs || 0} runs / {stats.total_nodes || 0} nodes</Badge>
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
