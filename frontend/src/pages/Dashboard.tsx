import { useState, useEffect, useCallback } from 'react';
import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Alert, Loader, Center,
  Badge, Tooltip, Table, ActionIcon, Select, Switch,
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
  const { data: stats, loading, error, refetch: refetchStats } = useApi<DashboardStats>(dashboard.getStats);
  const { data: nodeList, refetch: refetchNodes } = useApi<NodeSummary[]>(nodes.list);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => {
      refetchStats();
      refetchNodes();
      setLastRefresh(new Date());
    }, parseInt(refreshInterval) * 1000);
    return () => clearInterval(iv);
  }, [autoRefresh, refreshInterval]);

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
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={2}>Dashboard</Title>
          {autoRefresh && (
            <Badge variant="dot" color="green" size="sm">Live</Badge>
          )}
        </Group>
        <Group gap="sm">
          <Text size="xs" c="dimmed">Updated {lastRefresh.toLocaleTimeString()}</Text>
          <Select size="xs"
            data={[{value:'10',label:'10s'},{value:'30',label:'30s'},{value:'60',label:'1m'},{value:'300',label:'5m'}]}
            value={refreshInterval} onChange={(v) => setRefreshInterval(v || '30')}
            style={{ width: 70 }} />
          <Switch size="sm" label="Auto" checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)} />
        </Group>
      </Group>



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
  );
}