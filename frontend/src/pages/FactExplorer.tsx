import { useState, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Alert, Loader, Center,
  Table, Badge, Select, TextInput, ScrollArea,
} from '@mantine/core';
import { IconSearch, IconFilter } from '@tabler/icons-react';
import { facts } from '../services/api';

export function FactExplorerPage() {
  const [factNames, setFactNames] = useState<string[]>([]);
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factData, setFactData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [namesLoading, setNamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Load fact names on mount
  useEffect(() => {
    facts.getNames()
      .then((names: string[]) => {
        const sorted = (Array.isArray(names) ? names : [])
          .filter((n: any) => typeof n === 'string')
          .sort();
        setFactNames(sorted);
      })
      .catch((e: any) => setError('Failed to load fact names: ' + e.message))
      .finally(() => setNamesLoading(false));
  }, []);

  const handleFactSelect = async (factName: string | null) => {
    setSelectedFact(factName);
    setFactData([]);
    setError(null);
    setFilter('');
    if (!factName) return;

    setLoading(true);
    try {
      const r = await facts.getByName(factName);
      setFactData(r.results || []);
    } catch (e: any) {
      setError('Failed to load fact values: ' + e.message);
      setFactData([]);
    }
    setLoading(false);
  };

  // Apply filter
  const filtered = factData.filter((f: any) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    const val = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
    return f.certname?.toLowerCase().includes(q) || val.toLowerCase().includes(q);
  });

  return (
    <Stack>
      <Group>
        <IconSearch size={28} />
        <Title order={2}>Fact Explorer</Title>
      </Group>

      <Alert variant="light" color="blue">
        Select a fact from the dropdown to see its value on every node in your fleet.
      </Alert>

      {/* Controls */}
      <Card withBorder shadow="sm" padding="md">
        <Group align="flex-end">
          <Select
            label="Fact Name"
            placeholder={namesLoading ? 'Loading facts...' : 'Select a fact...'}
            data={factNames.map((n) => ({ value: n, label: n }))}
            value={selectedFact}
            onChange={handleFactSelect}
            searchable
            clearable
            style={{ flex: 1, minWidth: 300 }}
            nothingFoundMessage="No matching facts"
            limit={100}
            disabled={namesLoading}
          />
          {selectedFact && factData.length > 0 && (
            <TextInput
              label="Filter Results"
              placeholder="Filter by node or value..."
              leftSection={<IconFilter size={14} />}
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              style={{ width: 300 }}
            />
          )}
        </Group>
      </Card>

      {/* Error */}
      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}

      {/* Loading */}
      {loading && <Center h={200}><Loader size="xl" /></Center>}

      {/* Results table */}
      {!loading && selectedFact && factData.length > 0 && (
        <Card withBorder shadow="sm" padding="md">
          <Group justify="space-between" mb="md">
            <Title order={4}>
              Results for <Text span c="blue" inherit>"{selectedFact}"</Text>
            </Title>
            <Badge size="lg" variant="light" color="blue">
              {filtered.length} node{filtered.length !== 1 ? 's' : ''}
            </Badge>
          </Group>

          <ScrollArea style={{ maxHeight: 600 }}>
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Certname</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((f: any, i: number) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Text fw={500} size="sm">{f.certname}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ wordBreak: 'break-word' }}>
                        {typeof f.value === 'object' ? JSON.stringify(f.value, null, 2) : String(f.value)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {/* No results */}
      {!loading && selectedFact && factData.length === 0 && !error && (
        <Alert color="yellow">No data found for fact "{selectedFact}".</Alert>
      )}
    </Stack>
  );
}
