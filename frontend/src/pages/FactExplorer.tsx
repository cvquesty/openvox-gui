import { useState, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, Select, TextInput, ScrollArea, Grid, Paper,
} from '@mantine/core';
import { IconSearch, IconFilter } from '@tabler/icons-react';
import { pql, nodes as nodesApi } from '../services/api';

export function FactExplorerPage() {
  const [factNames, setFactNames] = useState<string[]>([]);
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factData, setFactData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [namesLoading, setNamesLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Load fact names
  useEffect(() => {
    pql.query('fact-names {}', 5000)
      .then((r) => {
        const names = r.results || [];
        setFactNames(Array.isArray(names) ? names.filter((n: any) => typeof n === 'string') : []);
      })
      .catch(() => {})
      .finally(() => setNamesLoading(false));
  }, []);

  const handleSearch = async (factName: string) => {
    if (!factName) return;
    setSelectedFact(factName);
    setLoading(true);
    try {
      const r = await pql.query(`facts { name = "${factName}" }`, 500);
      setFactData(r.results || []);
    } catch {
      setFactData([]);
    }
    setLoading(false);
  };

  // Compute unique values for distribution
  const valueCounts: Record<string, number> = {};
  factData.forEach((f: any) => {
    const v = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
    valueCounts[v] = (valueCounts[v] || 0) + 1;
  });
  const distribution = Object.entries(valueCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  const filteredFacts = factData.filter((f: any) =>
    !search || f.certname?.toLowerCase().includes(search.toLowerCase()) ||
    String(f.value).toLowerCase().includes(search.toLowerCase())
  );

  const filteredNames = factNames.filter((n) =>
    !search || n.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Stack>
      <Group>
        <IconSearch size={28} />
        <Title order={2}>Fact Explorer</Title>
      </Group>

      <Alert variant="light" color="blue">
        Explore and compare facts across your entire fleet. Select a fact name to see
        its value on every node, plus a distribution breakdown.
      </Alert>

      <Card withBorder shadow="sm" padding="md">
        <Group align="flex-end">
          <Select
            label="Fact Name"
            placeholder={namesLoading ? 'Loading facts...' : 'Search facts...'}
            data={factNames.map((n) => ({ value: n, label: n }))}
            value={selectedFact}
            onChange={(v) => v && handleSearch(v)}
            searchable
            clearable
            style={{ flex: 1 }}
            nothingFoundMessage="No matching facts"
            limit={50}
          />
          <TextInput
            label="Filter Results"
            placeholder="Filter by node or value..."
            leftSection={<IconFilter size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 250 }}
          />
        </Group>
      </Card>

      {loading && <Center h={200}><Loader size="xl" /></Center>}

      {!loading && selectedFact && factData.length > 0 && (
        <Grid>
          {/* Distribution */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder shadow="sm" padding="md" h="100%">
              <Title order={4} mb="sm">Value Distribution</Title>
              <Badge color="blue" mb="sm">{factData.length} nodes</Badge>
              <ScrollArea style={{ maxHeight: 400 }}>
                <Stack gap={4}>
                  {distribution.map(([value, count]) => (
                    <Paper key={value} withBorder p="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                          {value}
                        </Text>
                        <Badge size="sm" variant="light">{count}</Badge>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea>
            </Card>
          </Grid.Col>

          {/* Per-node values */}
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Card withBorder shadow="sm" padding="md">
              <Group justify="space-between" mb="sm">
                <Title order={4}>{selectedFact}</Title>
                <Badge>{filteredFacts.length} results</Badge>
              </Group>
              <ScrollArea style={{ maxHeight: 500 }}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Node</Table.Th>
                      <Table.Th>Environment</Table.Th>
                      <Table.Th>Value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredFacts.map((f: any, i: number) => (
                      <Table.Tr key={i}>
                        <Table.Td><Text fw={500} size="sm">{f.certname}</Text></Table.Td>
                        <Table.Td><Badge variant="outline" size="xs">{f.environment || 'N/A'}</Badge></Table.Td>
                        <Table.Td>
                          <Text size="xs" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>
          </Grid.Col>
        </Grid>
      )}

      {!loading && selectedFact && factData.length === 0 && (
        <Alert color="yellow">No data found for fact "{selectedFact}"</Alert>
      )}
    </Stack>
  );
}
