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
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconChartLine } from '@tabler/icons-react';
import { performance } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error loading performance data">{error}</Alert>;
  if (!data) return null;

  const trends = data.run_time_trends || [];
  const nodeComparison = (data.node_comparison || [])
    .sort((a: any, b: any) => b.avg_run_time - a.avg_run_time)
    .slice(0, 10);
  const breakdown = data.timing_breakdown || {};
  const stats = data.stats || {};

  // Build pie data from timing breakdown, excluding 'total'
  const pieData = Object.entries(breakdown)
    .filter(([key]) => key !== 'total')
    .map(([key, value]) => ({
      name: key.replace(/_/g, ' '),
      value: Number(value) || 0,
    }))
    .filter((d) => d.value > 0);

  const formatSeconds = (v: number) => {
    if (v >= 60) return `${(v / 60).toFixed(1)}m`;
    return `${v.toFixed(1)}s`;
  };

  return (
    <Stack>
      <Group gap="sm">
        <IconChartLine size={28} />
        <Title order={2}>Run Performance</Title>
      </Group>

      {/* Stat cards */}
      <Grid>
        {[
          { label: 'Average Run Time', value: stats.avg, color: 'blue' },
          { label: 'Max Run Time', value: stats.max, color: 'red' },
          { label: 'Min Run Time', value: stats.min, color: 'green' },
        ].map((stat) => (
          <Grid.Col span={{ base: 12, sm: 4 }} key={stat.label}>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{stat.label}</Text>
              <Group justify="space-between" mt="xs">
                <Text size="xl" fw={700}>
                  {typeof stat.value === 'number' ? formatSeconds(stat.value) : '--'}
                </Text>
                <Badge color={stat.color} variant="light" size="lg">
                  {stat.color === 'blue' ? 'AVG' : stat.color === 'red' ? 'MAX' : 'MIN'}
                </Badge>
              </Group>
            </Paper>
          </Grid.Col>
        ))}
      </Grid>

      {/* Run duration trends */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Run Duration Trends</Title>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => v?.slice(11, 16) || v}
            />
            <YAxis
              tickFormatter={(v: number) => formatSeconds(v)}
            />
            <ReTooltip
              formatter={(value: number) => formatSeconds(value)}
            />
            <Legend />
            <Line type="monotone" dataKey="total" stroke={COLORS[0]} strokeWidth={2} dot={false} name="Total" />
            <Line type="monotone" dataKey="config_retrieval" stroke={COLORS[1]} strokeWidth={1.5} dot={false} name="Config Retrieval" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Grid>
        {/* Node comparison — top 10 slowest */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Top 10 Slowest Nodes</Title>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={nodeComparison} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => formatSeconds(v)}
                />
                <YAxis
                  dataKey="certname"
                  type="category"
                  width={140}
                  tick={{ fontSize: 11 }}
                />
                <ReTooltip formatter={(value: number) => formatSeconds(value)} />
                <Bar dataKey="avg_run_time" fill={COLORS[0]} name="Avg Run Time" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Grid.Col>

        {/* Timing phase breakdown */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Timing Phase Breakdown</Title>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }: any) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                    labelLine={false}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip formatter={(value: number) => formatSeconds(value)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Center h={300}>
                <Text c="dimmed">No breakdown data available</Text>
              </Center>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
