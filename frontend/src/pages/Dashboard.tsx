import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Alert, Loader, Center,
  SimpleGrid, Paper, ThemeIcon, Badge, Tooltip, HoverCard,
} from '@mantine/core';
import {
  IconServer, IconCheck, IconAlertTriangle, IconX, IconPlayerPause, IconEye,
  IconUsers,
} from '@tabler/icons-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend,
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export function DashboardPage() {
  const { data: stats, loading, error } = useApi<DashboardStats>(dashboard.getStats);
  const { data: services } = useApi<ServiceStatus[]>(dashboard.getServices);
  const { data: sessions } = useApi<any>(dashboard.getActiveSessions);

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

  const activeCount = sessions?.active_count || 0;
  const activeUsers = sessions?.users || [];

  return (
    <Stack>
      <Title order={2}>Dashboard</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 6 }}>
        <StatsCard title="Total Nodes" value={ns.total} icon={IconServer} color="#0D6EFD" />
        <StatsCard title="Unchanged" value={ns.unchanged} icon={IconCheck} color="green" />
        <StatsCard title="Changed" value={ns.changed} icon={IconAlertTriangle} color="yellow" />
        <StatsCard title="Failed" value={ns.failed} icon={IconX} color="red" />
        <StatsCard title="Noop" value={ns.noop} icon={IconEye} color="blue" />
        <HoverCard width={280} shadow="md" position="bottom" withArrow openDelay={200}>
          <HoverCard.Target>
            <Paper withBorder p="md" radius="md" style={{ cursor: 'pointer' }}>
              <Group justify="space-between">
                <div>
                  <Text c="dimmed" tt="uppercase" fw={700} fz="xs">Active Users</Text>
                  <Text fw={700} fz="xl">{activeCount}</Text>
                </div>
                <ThemeIcon color="teal" variant="light" size={48} radius="md">
                  <IconUsers size={28} />
                </ThemeIcon>
              </Group>
            </Paper>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Text fw={600} size="sm" mb="xs">Active in last 15 minutes</Text>
            {activeUsers.length === 0 ? (
              <Text c="dimmed" size="sm">No active users</Text>
            ) : (
              <Stack gap={6}>
                {activeUsers.map((u: any) => (
                  <Group key={u.username} justify="space-between" gap="xs">
                    <Group gap={6}>
                      <ThemeIcon color="teal" variant="light" size="xs" radius="xl">
                        <IconUsers size={10} />
                      </ThemeIcon>
                      <Text size="sm" fw={500}>{u.username}</Text>
                    </Group>
                    <Group gap={6}>
                      {u.ip_address && <Text size="xs" c="dimmed">{u.ip_address}</Text>}
                      <Badge size="xs" variant="light" color="gray">
                        {u.last_seen ? timeAgo(u.last_seen) : '\u2014'}
                      </Badge>
                    </Group>
                  </Group>
                ))}
              </Stack>
            )}
          </HoverCard.Dropdown>
        </HoverCard>
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
                <ReTooltip />
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
        <Grid.Col span={{ base: 12, md: 4 }}>
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
      </Grid>
    </Stack>
  );
}
