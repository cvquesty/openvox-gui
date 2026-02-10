import { useParams, useNavigate } from 'react-router-dom';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Badge,
  Table, Tabs, Grid, Code, Paper,
} from '@mantine/core';
import { IconServer, IconFileReport, IconList, IconCode } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';

export function NodeDetailPage() {
  const { certname } = useParams<{ certname: string }>();
  const navigate = useNavigate();
  const { data: node, loading, error } = useApi(() => nodes.get(certname!), [certname]);
  const { data: reportList } = useApi(() => nodes.getReports(certname!, 10), [certname]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!node) return <Alert color="yellow">Node not found</Alert>;

  const keyFacts = ['os', 'networking', 'kernel', 'kernelrelease', 'processors',
    'memorysize', 'uptime', 'virtual', 'is_virtual', 'fqdn', 'ipaddress',
    'operatingsystem', 'operatingsystemrelease', 'architecture'];

  return (
    <Stack>
      <Group>
        <Title order={2}>{node.certname}</Title>
        <StatusBadge status={node.latest_report_status} size="lg" />
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder shadow="sm" padding="md">
            <Text fw={700} mb="sm">Overview</Text>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Environment</Text>
                <Badge variant="outline">{node.report_environment || 'N/A'}</Badge>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Resources</Text>
                <Text size="sm" fw={500}>{node.resources_count}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Last Report</Text>
                <Text size="sm">{node.report_timestamp ? new Date(node.report_timestamp).toLocaleString() : 'Never'}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Last Catalog</Text>
                <Text size="sm">{node.catalog_timestamp ? new Date(node.catalog_timestamp).toLocaleString() : 'Never'}</Text>
              </Group>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder shadow="sm" padding="md">
            <Text fw={700} mb="sm">Applied Classes ({node.classes.length})</Text>
            <Group gap="xs">
              {node.classes.map((cls: string) => (
                <Badge key={cls} variant="light" size="sm">{cls}</Badge>
              ))}
              {node.classes.length === 0 && <Text c="dimmed" size="sm">No classes applied</Text>}
            </Group>
          </Card>
        </Grid.Col>
      </Grid>

      <Tabs defaultValue="facts">
        <Tabs.List>
          <Tabs.Tab value="facts" leftSection={<IconList size={16} />}>Key Facts</Tabs.Tab>
          <Tabs.Tab value="allfacts" leftSection={<IconCode size={16} />}>All Facts</Tabs.Tab>
          <Tabs.Tab value="reports" leftSection={<IconFileReport size={16} />}>Recent Reports</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="facts" pt="md">
          <Card withBorder>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fact</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {keyFacts.map((fact) => (
                  node.facts[fact] !== undefined ? (
                    <Table.Tr key={fact}>
                      <Table.Td><Text fw={500} size="sm">{fact}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {typeof node.facts[fact] === 'object'
                            ? JSON.stringify(node.facts[fact]).slice(0, 120)
                            : String(node.facts[fact])}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : null
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="allfacts" pt="md">
          <Paper withBorder p="md">
            <Code block style={{ maxHeight: 500, overflow: 'auto', fontSize: 12 }}>
              {JSON.stringify(node.facts, null, 2)}
            </Code>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="reports" pt="md">
          <Card withBorder>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Environment</Table.Th>
                  <Table.Th>Puppet Version</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reportList?.map((r: any) => (
                  <Table.Tr
                    key={r.hash}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/reports/${r.hash}`)}
                  >
                    <Table.Td><StatusBadge status={r.status} /></Table.Td>
                    <Table.Td>{new Date(r.start_time).toLocaleString()}</Table.Td>
                    <Table.Td>{r.environment}</Table.Td>
                    <Table.Td>{r.puppet_version}</Table.Td>
                  </Table.Tr>
                )) || <Table.Tr><Table.Td colSpan={4}><Text c="dimmed">No reports</Text></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
