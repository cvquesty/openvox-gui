/**
 * OpenVox GUI - MetricsPerformance.tsx
 *
 * Run Performance page — shows run duration trends, node comparison
 * (top 10 slowest), timing phase breakdown, and stat cards.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper,
} from '@mantine/core';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconChartLine } from '@tabler/icons-react';
import { performance } from '../services/api';

const COLORS = ['#0D6EFD', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 },
};

export function MetricsPerformancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await performance.getOverview();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error loading performance data">{error}</Alert>;
  if (!data) return null;

  // Thin out trends — show every other data point for readability
  const rawTrends = data.run_time_trends || [];
  const trends = rawTrends.filter((_: any, i: number) => i % 2 === 0).slice(-120);
  const nodeComparison = (data.node_comparison || [])
    .sort((a: any, b: any) => (b.avg_total || 0) - (a.avg_total || 0))
    .slice(0, 10);
  const breakdownArr: any[] = Array.isArray(data.timing_breakdown) ? data.timing_breakdown : [];
  const stats = data.stats || {};

  // Build pie data from timing breakdown array
  const pieData = breakdownArr
    .filter((d: any) => d.avg_seconds > 0)
    .map((d: any) => ({
      name: d.category || d.key?.replace(/_/g, ' ') || 'Unknown',
      value: Number(d.avg_seconds) || 0,
    }));

  const formatSeconds = (v: number) => {
    if (v >= 60) return `${(v / 60).toFixed(1)}m`;
    return `${v.toFixed(1)}s`;
  };

  // Shorten certname for bar chart labels
  const shortName = (cn: string) => {
    if (cn.length <= 25) return cn;
    const parts = cn.split('.');
    return parts[0].length <= 20 ? parts[0] : parts[0].substring(0, 20) + '...';
  };

  return (
    <Stack>
      <Group gap="sm">
        <IconChartLine size={28} />
        <Title order={2}>Run Performance</Title>
        <Badge variant="light" color="blue" size="lg">{stats.total_runs || 0} runs / {stats.total_nodes || 0} nodes</Badge>
      </Group>

      {/* Stat cards */}
      <Grid>
        {[
          { label: 'Average Run Time', value: stats.avg_run_time, color: 'blue', badge: 'AVG' },
          { label: 'Max Run Time', value: stats.max_run_time, color: 'red', badge: 'MAX' },
          { label: 'Min Run Time', value: stats.min_run_time, color: 'green', badge: 'MIN' },
          { label: 'Failed Runs', value: stats.failed_runs, color: stats.failed_runs > 0 ? 'red' : 'green', badge: stats.failed_runs > 0 ? 'ALERT' : 'OK', raw: true },
          { label: 'Changed Runs', value: stats.changed_runs, color: 'yellow', badge: 'CHG', raw: true },
        ].map((stat) => (
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }} key={stat.label}>
            <Paper withBorder p="md" radius="md" ta="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{stat.label}</Text>
              <Text size="xl" fw={700} mt={4}>
                {stat.raw ? (stat.value ?? 0) : (typeof stat.value === 'number' ? formatSeconds(stat.value) : '--')}
              </Text>
              <Badge color={stat.color} variant="light" size="sm" mt={4}>{stat.badge}</Badge>
            </Paper>
          </Grid.Col>
        ))}
      </Grid>

      {/* Run duration trends */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Run Duration Trends</Title>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={trends} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8899aa' }}
              tickFormatter={(v: string) => v?.includes('T') ? v.split('T')[1]?.substring(0, 5) : v?.slice(11, 16) || v} />
            <YAxis tick={{ fontSize: 11, fill: '#8899aa' }}
              tickFormatter={(v: number) => formatSeconds(v)} />
            <ReTooltip {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [formatSeconds(value), name]}
              labelFormatter={(label: string) => label?.includes('T') ? new Date(label + ':00Z').toLocaleString() : label} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Area type="monotone" dataKey="total" stroke="#0D6EFD" fill="url(#gTotal)" strokeWidth={2} dot={false} name="Total" />
            <Area type="monotone" dataKey="fact_generation" stroke="#2ecc71" fill="none" strokeWidth={1.5} dot={false} name="Fact Generation" />
            <Area type="monotone" dataKey="config_retrieval" stroke="#e67e22" fill="none" strokeWidth={1.5} dot={false} name="Config Retrieval" />
            <Area type="monotone" dataKey="plugin_sync" stroke="#9b59b6" fill="none" strokeWidth={1.5} dot={false} name="Plugin Sync" />
            <Area type="monotone" dataKey="catalog_application" stroke="#e74c3c" fill="none" strokeWidth={1} dot={false} name="Catalog Application" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Grid>
        {/* Node comparison — top 10 slowest */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Top 10 Slowest Nodes (avg)</Title>
            {nodeComparison.length > 0 ? (
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={nodeComparison} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#8899aa' }}
                    tickFormatter={(v: number) => formatSeconds(v)} />
                  <YAxis dataKey="certname" type="category" width={160}
                    tick={{ fontSize: 10, fill: '#8899aa' }}
                    tickFormatter={shortName} />
                  <ReTooltip {...TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [formatSeconds(value), name]}
                    labelFormatter={(cn: string) => cn} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="avg_fact_generation" stackId="stack" fill="#2ecc71" name="Fact Gen" />
                  <Bar dataKey="avg_plugin_sync" stackId="stack" fill="#9b59b6" name="Plugin Sync" />
                  <Bar dataKey="avg_config_retrieval" stackId="stack" fill="#e67e22" name="Config Retrieval" />
                  <Bar dataKey="avg_catalog_application" stackId="stack" fill="#e74c3c" name="Catalog Apply" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Center h={300}><Text c="dimmed">No node comparison data available</Text></Center>
            )}
          </Card>
        </Grid.Col>

        {/* Timing phase breakdown */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Timing Phase Breakdown (fleet avg)</Title>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={50} outerRadius={100}
                      paddingAngle={2} dataKey="value" label={false}>
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const e = payload[0];
                        return (
                          <div style={{ ...TOOLTIP_STYLE.contentStyle }}>
                            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{e.name}</div>
                            <div>{formatSeconds(Number(e.value))}</div>
                          </div>
                        );
                      }}
                    />
                    <Legend layout="horizontal" verticalAlign="bottom" align="center"
                      wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Detail table */}
                {breakdownArr.map((d: any, i: number) => (
                  <Group key={i} justify="space-between" px="sm" py={4}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <Group gap="xs">
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length] }} />
                      <Text size="sm">{d.category}</Text>
                    </Group>
                    <Text size="sm" fw={500}>{formatSeconds(d.avg_seconds)}</Text>
                  </Group>
                ))}
              </>
            ) : (
              <Center h={300}><Text c="dimmed">No breakdown data available</Text></Center>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
