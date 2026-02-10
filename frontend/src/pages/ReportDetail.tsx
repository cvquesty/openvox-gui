import { useParams, useNavigate } from 'react-router-dom';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Badge,
  Table, Tabs, Code, Paper, Button, SimpleGrid, ThemeIcon, Anchor,
  ScrollArea,
} from '@mantine/core';
import {
  IconFileReport, IconList, IconChartBar, IconArrowLeft, IconClock,
  IconServer, IconCheck, IconX, IconAlertTriangle,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';

function MetricCard({ name, value, category }: { name: string; value: number; category: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase">{category}</Text>
      <Text fw={600} size="sm">{name}</Text>
      <Text fw={700} size="lg">{typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 3) : value}</Text>
    </Paper>
  );
}

function LogLevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    err: 'red', warning: 'yellow', notice: 'blue', info: 'cyan', debug: 'gray',
  };
  return <Badge color={colors[level] || 'gray'} variant="filled" size="sm">{level}</Badge>;
}

function EventStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'green', failure: 'red', noop: 'blue', skipped: 'gray', audit: 'blue',
  };
  return <Badge color={colors[status] || 'gray'} variant="filled" size="sm">{status}</Badge>;
}

export function ReportDetailPage() {
  const { hash } = useParams<{ hash: string }>();
  const navigate = useNavigate();
  const { data: report, loading, error } = useApi(() => reports.get(hash!), [hash]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!report) return <Alert color="yellow">Report not found</Alert>;

  const events = report.resource_events || [];
  const logs = report.logs || [];
  const metrics = report.metrics || [];

  // Group metrics by category
  const metricsByCategory: Record<string, { name: string; value: number }[]> = {};
  for (const m of metrics) {
    const cat = m.category || 'other';
    if (!metricsByCategory[cat]) metricsByCategory[cat] = [];
    metricsByCategory[cat].push({ name: m.name, value: m.value });
  }

  // Calculate run duration
  let duration = '—';
  if (report.start_time && report.end_time) {
    const ms = new Date(report.end_time).getTime() - new Date(report.start_time).getTime();
    duration = `${(ms / 1000).toFixed(1)}s`;
  }

  // Count events by status
  const eventCounts = events.reduce((acc: Record<string, number>, e: any) => {
    const s = e.status || 'unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <Stack>
      <Group>
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate(-1)}>Back</Button>
        <Title order={2}>Report Detail</Title>
        <StatusBadge status={report.status} size="lg" />
      </Group>

      {/* Overview cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="blue" size="lg"><IconServer size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">Node</Text>
              <Anchor fw={600} size="sm" onClick={() => navigate(`/nodes/${report.certname}`)}>
                {report.certname}
              </Anchor>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="green" size="lg"><IconClock size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">Duration</Text>
              <Text fw={600} size="sm">{duration}</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="#0D6EFD" size="lg"><IconFileReport size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">Environment</Text>
              <Badge variant="outline">{report.environment || 'N/A'}</Badge>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="yellow" size="lg"><IconList size={20} /></ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">Events</Text>
              <Group gap={4}>
                {Object.entries(eventCounts).map(([status, count]) => (
                  <Badge key={status} size="sm" color={status === 'success' ? 'green' : status === 'failure' ? 'red' : 'gray'}>
                    {status}: {count as number}
                  </Badge>
                ))}
                {events.length === 0 && <Text size="sm" c="dimmed">None</Text>}
              </Group>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      {/* Report metadata */}
      <Card withBorder shadow="sm" padding="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          <div>
            <Text size="xs" c="dimmed">Start Time</Text>
            <Text size="sm">{report.start_time ? new Date(report.start_time).toLocaleString() : '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">End Time</Text>
            <Text size="sm">{report.end_time ? new Date(report.end_time).toLocaleString() : '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">Puppet Version</Text>
            <Text size="sm">{report.puppet_version || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">Config Version</Text>
            <Text size="sm" style={{ wordBreak: 'break-all' }}>{report.configuration_version || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">Noop</Text>
            <Text size="sm">{report.noop ? 'Yes' : 'No'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">Corrective Change</Text>
            <Text size="sm">{report.corrective_change ? 'Yes' : 'No'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">Report Hash</Text>
            <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>{report.hash}</Text>
          </div>
        </SimpleGrid>
      </Card>

      {/* Tabs: Events, Logs, Metrics */}
      <Tabs defaultValue="events">
        <Tabs.List>
          <Tabs.Tab value="events" leftSection={<IconList size={16} />}>
            Resource Events ({events.length})
          </Tabs.Tab>
          <Tabs.Tab value="logs" leftSection={<IconFileReport size={16} />}>
            Logs ({logs.length})
          </Tabs.Tab>
          <Tabs.Tab value="metrics" leftSection={<IconChartBar size={16} />}>
            Metrics ({metrics.length})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="events" pt="md">
          <Card withBorder>
            {events.length > 0 ? (
              <ScrollArea>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Resource Type</Table.Th>
                      <Table.Th>Resource Title</Table.Th>
                      <Table.Th>Property</Table.Th>
                      <Table.Th>Old Value</Table.Th>
                      <Table.Th>New Value</Table.Th>
                      <Table.Th>Message</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {events.map((evt: any, i: number) => (
                      <Table.Tr key={i}>
                        <Table.Td><EventStatusBadge status={evt.status} /></Table.Td>
                        <Table.Td><Text size="sm" fw={500}>{evt.resource_type}</Text></Table.Td>
                        <Table.Td><Text size="sm">{evt.resource_title}</Text></Table.Td>
                        <Table.Td><Text size="sm">{evt.property || '—'}</Text></Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace" lineClamp={2} style={{ maxWidth: 150 }}>
                            {evt.old_value != null ? String(evt.old_value) : '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace" lineClamp={2} style={{ maxWidth: 150 }}>
                            {evt.new_value != null ? String(evt.new_value) : '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" lineClamp={2} style={{ maxWidth: 250 }}>
                            {evt.message || '—'}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Text c="dimmed" ta="center" p="lg">No resource events in this report</Text>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="logs" pt="md">
          <Card withBorder>
            {logs.length > 0 ? (
              <ScrollArea>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 80 }}>Level</Table.Th>
                      <Table.Th style={{ width: 180 }}>Time</Table.Th>
                      <Table.Th style={{ width: 200 }}>Source</Table.Th>
                      <Table.Th>Message</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {logs.map((log: any, i: number) => (
                      <Table.Tr key={i}>
                        <Table.Td><LogLevelBadge level={log.level} /></Table.Td>
                        <Table.Td><Text size="xs">{log.time ? new Date(log.time).toLocaleString() : '—'}</Text></Table.Td>
                        <Table.Td><Text size="xs" ff="monospace" lineClamp={1}>{log.source || '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm">{log.message}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Stack align="center" p="lg" gap="xs"><Text c="dimmed">No logs available for this report.</Text><Text size="xs" c="dimmed">Puppet agent log_level may be set to "err" which only captures error messages.</Text><Text size="xs" c="dimmed">Set log_level = info in puppet.conf [agent] to capture all run logs.</Text></Stack>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          {Object.keys(metricsByCategory).length > 0 ? (
            <Stack>
              {Object.entries(metricsByCategory).map(([category, items]) => (
                <Card key={category} withBorder shadow="sm">
                  <Title order={5} mb="sm" tt="capitalize">{category}</Title>
                  <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
                    {items.map((m) => (
                      <MetricCard key={`${category}-${m.name}`} name={m.name} value={m.value} category={category} />
                    ))}
                  </SimpleGrid>
                </Card>
              ))}
            </Stack>
          ) : (
            <Card withBorder>
              <Text c="dimmed" ta="center" p="lg">No metrics in this report</Text>
            </Card>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
