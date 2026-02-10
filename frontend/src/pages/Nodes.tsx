import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text,
  ActionIcon, Tooltip,
} from '@mantine/core';
import { IconSearch, IconEye } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import type { NodeSummary } from '../types';

function timeAgo(timestamp: string | null): string {
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

export function NodesPage() {
  const [search, setSearch] = useState('');
  const { data: nodeList, loading, error } = useApi<NodeSummary[]>(nodes.list);
  const navigate = useNavigate();

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const filtered = nodeList?.filter(
    (n) => n.certname.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Nodes ({filtered.length})</Title>
        <TextInput
          placeholder="Search nodes..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ width: 300 }}
        />
      </Group>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Last Report</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((node) => (
              <Table.Tr key={node.certname} style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/nodes/${node.certname}`)}>
                <Table.Td>
                  <Text fw={500}>{node.certname}</Text>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={node.latest_report_status} />
                </Table.Td>
                <Table.Td>{node.report_environment || '—'}</Table.Td>
                <Table.Td>{timeAgo(node.report_timestamp)}</Table.Td>
                <Table.Td>
                  <Tooltip label="View details">
                    <ActionIcon variant="subtle" onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/nodes/${node.certname}`);
                    }}>
                      <IconEye size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
