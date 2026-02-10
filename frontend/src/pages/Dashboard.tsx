import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Alert, Loader, Center,
  SimpleGrid, Paper, ThemeIcon, Badge,
} from '@mantine/core';
import {
  IconServer, IconCheck, IconAlertTriangle, IconX, IconPlayerPause, IconEye,
} from '@tabler/icons-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { dashboard } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import type { DashboardStats, ServiceStatus } from '../types';

function StatsCard({ title, value, icon: Icon, color }: {
  title: string; value: number; icon: any; color: string;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between">
        <div>
          <Text c="dimmed" tt="uppercase" fw={700} fz="xs">{title}</Text>
          <Text fw={700} fz="xl">{value}</Text>
        </div>
        <ThemeIcon color={color} variant="light" size={48} radius="md">
          <Icon size={28} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

export function DashboardPage() {
  const { data: stats, loading, error } = useApi<DashboardStats>(dashboard.getStats);
  const { data: services } = useApi<ServiceStatus[]>(dashboard.getServices);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!stats) return null;

  const ns = stats.node_status;
  const ringData = [
    { value: ns.total ? (ns.unchanged / ns.total) * 100 : 0, color: 'green', tooltip: `Unchanged: ${ns.unchanged}` },
    { value: ns.total ? (ns.changed / ns.total) * 100 : 0, color: 'yellow', tooltip: `Changed: ${ns.changed}` },
    { value: ns.total ? (ns.failed / ns.total) * 100 : 0, color: 'red', tooltip: `Failed: ${ns.failed}` },
    { value: ns.total ? (ns.noop / ns.total) * 100 : 0, color: 'blue', tooltip: `Noop: ${ns.noop}` },
    { value: ns.total ? (ns.unreported / ns.total) * 100 : 0, color: 'gray', tooltip: `Unreported: ${ns.unreported}` },
  ].filter(d => d.value > 0);

  return (
    <Stack>
      <Title order={2}>Dashboard</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
        <StatsCard title="Total Nodes" value={ns.total} icon={IconServer} color="violet" />
        <StatsCard title="Unchanged" value={ns.unchanged} icon={IconCheck} color="green" />
        <StatsCard title="Changed" value={ns.changed} icon={IconAlertTriangle} color="yellow" />
        <StatsCard title="Failed" value={ns.failed} icon={IconX} color="red" />
        <StatsCard title="Noop" value={ns.noop} icon={IconEye} color="blue" />
      </SimpleGrid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Node Status</Title>
            <Center>
              <RingProgress
                size={220}
                thickness={24}
                roundCaps
                label={
                  <Text ta="center" fw={700} size="xl">{ns.total}</Text>
                }
                sections={ringData}
              />
            </Center>
            <Group justify="center" mt="md" gap="lg">
              <Group gap={4}><Badge color="green" size="xs" circle /> <Text size="xs">Unchanged</Text></Group>
              <Group gap={4}><Badge color="yellow" size="xs" circle /> <Text size="xs">Changed</Text></Group>
              <Group gap={4}><Badge color="red" size="xs" circle /> <Text size="xs">Failed</Text></Group>
              <Group gap={4}><Badge color="blue" size="xs" circle /> <Text size="xs">Noop</Text></Group>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Report Trends</Title>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={stats.report_trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v.slice(11) || v} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="unchanged" stroke="#40c057" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="changed" stroke="#fab005" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failed" stroke="#fa5252" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Grid.Col>
      </Grid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Services</Title>
            <Stack gap="sm">
              {services?.map((svc) => (
                <Group key={svc.service} justify="space-between">
                  <Text fw={500}>{svc.service}</Text>
                  <StatusBadge status={svc.status} />
                </Group>
              )) || <Text c="dimmed">Loading...</Text>}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Environments</Title>
            <Group>
              {stats.environments.map((env) => (
                <Badge key={env} variant="outline" size="lg">{env}</Badge>
              ))}
              {stats.environments.length === 0 && (
                <Text c="dimmed">No environments found</Text>
              )}
            </Group>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
