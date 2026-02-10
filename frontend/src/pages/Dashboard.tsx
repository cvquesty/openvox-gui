import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Alert, Loader, Center, Box,
  Badge, Tooltip, Table, ActionIcon,
} from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { dashboard, nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import type { DashboardStats, NodeSummary } from '../types';



function nodeTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, loading, error } = useApi<DashboardStats>(dashboard.getStats);
  const { data: nodeList } = useApi<NodeSummary[]>(nodes.list);

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
    <Box style={{ position: 'relative', overflow: 'hidden', minHeight: '100%' }}>
      {/* Watermark */}
      <Box
        style={{
          position: 'fixed',
          top: '50%',
          left: '55%',
          transform: 'translate(-50%, -50%) rotate(-45deg)',
          opacity: 0.15,
          pointerEvents: 'none',
          zIndex: 0,
          width: 500,
          height: 500,
        }}
      >
        <img src="/openvox-logo.svg" alt="" style={{ width: '100%', height: '100%' }} />
      </Box>
    <Stack style={{ position: 'relative', zIndex: 1 }}>
      <Title order={2}>Dashboard</Title>



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

    
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>Nodes</Title>
          <Badge variant="light" size="lg">{nodeList?.length || 0} total</Badge>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Last Report</Table.Th>
              <Table.Th style={{ width: 60 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(nodeList || []).map((node) => (
              <Table.Tr key={node.certname} style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/nodes/${node.certname}`)}>
                <Table.Td><Text fw={500} size="sm">{node.certname}</Text></Table.Td>
                <Table.Td><StatusBadge status={node.latest_report_status} /></Table.Td>
                <Table.Td><Text size="sm">{node.report_environment || '\u2014'}</Text></Table.Td>
                <Table.Td><Text size="sm">{nodeTimeAgo(node.report_timestamp)}</Text></Table.Td>
                <Table.Td>
                  <Tooltip label="View details">
                    <ActionIcon variant="subtle" onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      navigate(`/nodes/${node.certname}`);
                    }}>
                      <IconEye size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {(!nodeList || nodeList.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" py="md">No nodes found</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
    </Box>
  );
}