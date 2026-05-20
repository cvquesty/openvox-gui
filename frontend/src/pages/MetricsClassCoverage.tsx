/**
 * OpenVox GUI - MetricsClassCoverage.tsx
 *
 * Class Coverage Report — horizontal bar chart of top classes by deployment
 * count plus a searchable table.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Table,
  TextInput, ScrollArea, Paper,
} from '@mantine/core';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip,
} from 'recharts';
import { IconShieldCheck, IconSearch } from '@tabler/icons-react';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

interface ClassEntry {
  class_name: string;
  node_count: number;
}

export function MetricsClassCoveragePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await metrics.classCoverage();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load class coverage data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error loading class coverage">{error}</Alert>;
  if (!data) return null;

  const classes: ClassEntry[] = data.classes || [];
  const sortedClasses = [...classes].sort((a, b) => b.node_count - a.node_count);

  // Chart data: top 20 for the horizontal bar chart
  const chartData = sortedClasses.slice(0, 20).map((c) => ({
    name: c.class_name.length > 35
      ? c.class_name.slice(0, 32) + '...'
      : c.class_name,
    fullName: c.class_name,
    nodes: c.node_count,
  }));

  // Filter for table
  const filteredClasses = search
    ? sortedClasses.filter((c) =>
        c.class_name.toLowerCase().includes(search.toLowerCase()))
    : sortedClasses;

  const maxCount = sortedClasses.length > 0 ? sortedClasses[0].node_count : 1;

  return (
    <Stack>
      <Group gap="sm">
        <IconShieldCheck size={28} />
        <Title order={2}>Class Coverage Report</Title>
        <Badge variant="light" size="lg">{classes.length} classes</Badge>
      </Group>

      {/* Summary */}
      <Group>
        <Paper withBorder p="md" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Total Classes</Text>
          <Text size="xl" fw={700} mt="xs">{classes.length}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Most Deployed</Text>
          <Text size="xl" fw={700} mt="xs">
            {sortedClasses.length > 0 ? sortedClasses[0].node_count : 0} nodes
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {sortedClasses.length > 0 ? sortedClasses[0].class_name : '--'}
          </Text>
        </Paper>
      </Group>

      {/* Horizontal bar chart */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Top Classes by Deployment Count</Title>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 28)}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                dataKey="name"
                type="category"
                width={240}
                tick={{ fontSize: 11 }}
              />
              <ReTooltip
                formatter={(value: number, _name: string, props: any) => [
                  `${value} nodes`,
                  props.payload.fullName,
                ]}
              />
              <Bar dataKey="nodes" fill={COLORS[0]} name="Nodes" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Center h={300}>
            <Text c="dimmed">No class data available</Text>
          </Center>
        )}
      </Card>

      {/* Searchable table */}
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>All Classes</Title>
          <TextInput
            placeholder="Search classes..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 300 }}
          />
        </Group>
        <ScrollArea h={400}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Class Name</Table.Th>
                <Table.Th style={{ width: 120 }}>Node Count</Table.Th>
                <Table.Th style={{ width: 200 }}>Coverage</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredClasses.map((cls) => (
                <Table.Tr key={cls.class_name}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{cls.class_name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color="blue">{cls.node_count}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        flex: 1,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: '#e9ecef',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${(cls.node_count / maxCount) * 100}%`,
                          height: '100%',
                          borderRadius: 4,
                          backgroundColor: COLORS[0],
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      <Text size="xs" c="dimmed" style={{ minWidth: 35 }}>
                        {maxCount > 0 ? ((cls.node_count / maxCount) * 100).toFixed(0) : 0}%
                      </Text>
                    </div>
                  </Table.Td>
                </Table.Tr>
              ))}
              {filteredClasses.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text c="dimmed" ta="center" py="md">
                      {search ? 'No classes match your search' : 'No classes found'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
