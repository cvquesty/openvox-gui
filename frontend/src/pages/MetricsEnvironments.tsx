/**
 * OpenVox GUI - MetricsEnvironments.tsx
 *
 * Environment Comparison — stacked bar chart and stat cards per environment.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconGitBranch } from '@tabler/icons-react';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

const STATUS_COLORS: Record<string, string> = {
  unchanged: '#28a745',
  changed: '#0D6EFD',
  failed: '#dc3545',
  noop: '#ffc107',
  unreported: '#6c757d',
};

interface EnvironmentData {
  name: string;
  total: number;
  changed: number;
  unchanged: number;
  failed: number;
  noop: number;
  unreported: number;
}

export function MetricsEnvironmentsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await metrics.environments();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load environment data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error loading environments">{error}</Alert>;
  if (!data) return null;

  const environments: EnvironmentData[] = data.environments || [];

  const chartData = environments.map((env) => ({
    name: env.name,
    Unchanged: env.unchanged,
    Changed: env.changed,
    Failed: env.failed,
    Noop: env.noop,
    Unreported: env.unreported,
  }));

  const totalNodes = environments.reduce((sum, e) => sum + e.total, 0);
  const totalFailed = environments.reduce((sum, e) => sum + e.failed, 0);

  return (
    <Stack>
      <Group gap="sm">
        <IconGitBranch size={28} />
        <Title order={2}>Environment Comparison</Title>
        <Badge variant="light" size="lg">{environments.length} environments</Badge>
      </Group>

      {/* Summary stats */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Total Nodes</Text>
            <Text size="xl" fw={700} mt="xs">{totalNodes}</Text>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Environments</Text>
            <Text size="xl" fw={700} mt="xs">{environments.length}</Text>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Total Failed</Text>
            <Group justify="space-between" mt="xs">
              <Text size="xl" fw={700} c={totalFailed > 0 ? 'red' : undefined}>
                {totalFailed}
              </Text>
              {totalFailed > 0 && <Badge color="red" variant="light">Attention</Badge>}
            </Group>
          </Paper>
        </Grid.Col>
      </Grid>

      {/* Stacked bar chart */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Node Status by Environment</Title>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8899aa' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8899aa' }} />
              <ReTooltip contentStyle={{ backgroundColor: "rgba(20,20,33,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", padding: "10px 14px", fontSize: 12, color: "#e0e0e0" }} labelStyle={{ fontWeight: 600, color: "#fff", marginBottom: 4 }} itemStyle={{ color: '#e0e0e0' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area type="natural" dataKey="Unchanged" stroke={STATUS_COLORS.unchanged} fill="none" strokeWidth={2} dot={{ r: 4, fill: STATUS_COLORS.unchanged }} name="Unchanged" />
              <Area type="natural" dataKey="Changed" stroke={STATUS_COLORS.changed} fill="none" strokeWidth={2} dot={{ r: 4, fill: STATUS_COLORS.changed }} name="Changed" />
              <Area type="natural" dataKey="Failed" stroke={STATUS_COLORS.failed} fill="none" strokeWidth={2} dot={{ r: 4, fill: STATUS_COLORS.failed }} name="Failed" />
              <Area type="natural" dataKey="Noop" stroke={STATUS_COLORS.noop} fill="none" strokeWidth={2} dot={{ r: 4, fill: STATUS_COLORS.noop }} name="Noop" />
              <Area type="natural" dataKey="Unreported" stroke={STATUS_COLORS.unreported} fill="none" strokeWidth={2} dot={{ r: 4, fill: STATUS_COLORS.unreported }} name="Unreported" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Center h={300}>
            <Text c="dimmed">No environment data available</Text>
          </Center>
        )}
      </Card>

      {/* Per-environment stat cards */}
      <Title order={4}>Environment Details</Title>
      <Grid>
        {environments.map((env) => {
          const failRate = env.total > 0 ? ((env.failed / env.total) * 100).toFixed(1) : '0';
          return (
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }} key={env.name}>
              <Card withBorder shadow="sm" padding="lg">
                <Group justify="space-between" mb="sm">
                  <Title order={5}>{env.name}</Title>
                  <Badge variant="light">{env.total} nodes</Badge>
                </Group>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Group gap={6}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS.unchanged }} />
                      <Text size="sm">Unchanged</Text>
                    </Group>
                    <Text size="sm" fw={600}>{env.unchanged}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Group gap={6}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS.changed }} />
                      <Text size="sm">Changed</Text>
                    </Group>
                    <Text size="sm" fw={600}>{env.changed}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Group gap={6}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS.failed }} />
                      <Text size="sm">Failed</Text>
                    </Group>
                    <Text size="sm" fw={600} c={env.failed > 0 ? 'red' : undefined}>{env.failed}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Group gap={6}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS.noop }} />
                      <Text size="sm">Noop</Text>
                    </Group>
                    <Text size="sm" fw={600}>{env.noop}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Group gap={6}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS.unreported }} />
                      <Text size="sm">Unreported</Text>
                    </Group>
                    <Text size="sm" fw={600}>{env.unreported}</Text>
                  </Group>
                  <Group justify="space-between" mt="xs" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                    <Text size="xs" c="dimmed">Failure rate</Text>
                    <Badge color={parseFloat(failRate) > 0 ? 'red' : 'green'} variant="light" size="sm">
                      {failRate}%
                    </Badge>
                  </Group>
                </Stack>
              </Card>
            </Grid.Col>
          );
        })}
      </Grid>

      {environments.length === 0 && (
        <Center h={200}>
          <Text c="dimmed" size="lg">No environments found</Text>
        </Center>
      )}
    </Stack>
  );
}
