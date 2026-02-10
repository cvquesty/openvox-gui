import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text,
  Select,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';

export function ReportsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const { data: reportList, loading, error } = useApi(
    () => reports.list({ status: statusFilter || undefined, limit: 100 }),
    [statusFilter]
  );

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const filtered = reportList?.filter(
    (r) => r.certname.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Reports ({filtered.length})</Title>
        <Group>
          <Select
            placeholder="Filter by status"
            data={[
              { value: '', label: 'All' },
              { value: 'changed', label: 'Changed' },
              { value: 'unchanged', label: 'Unchanged' },
              { value: 'failed', label: 'Failed' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            clearable
            style={{ width: 160 }}
          />
          <TextInput
            placeholder="Search by certname..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 250 }}
          />
        </Group>
      </Group>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Start Time</Table.Th>
              <Table.Th>End Time</Table.Th>
              <Table.Th>Puppet Version</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((report) => (
              <Table.Tr
                key={report.hash}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/reports/${report.hash}`)}
              >
                <Table.Td><Text fw={500}>{report.certname}</Text></Table.Td>
                <Table.Td><StatusBadge status={report.status} /></Table.Td>
                <Table.Td>{report.environment || '—'}</Table.Td>
                <Table.Td>{report.start_time ? new Date(report.start_time).toLocaleString() : '—'}</Table.Td>
                <Table.Td>{report.end_time ? new Date(report.end_time).toLocaleString() : '—'}</Table.Td>
                <Table.Td>{report.puppet_version || '—'}</Table.Td>
              </Table.Tr>
            ))}
            {filtered.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center">No reports found</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
