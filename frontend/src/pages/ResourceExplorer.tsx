import { useState } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, TextInput, ScrollArea, Select,
} from '@mantine/core';
import { IconPackage, IconSearch } from '@tabler/icons-react';
import { pql } from '../services/api';

const COMMON_TYPES = [
  'Class', 'File', 'Package', 'Service', 'Exec', 'User', 'Group',
  'Cron', 'Mount', 'Yumrepo', 'Apt::Source', 'Firewall',
  'Concat', 'Concat::Fragment', 'Augeas', 'Notify',
  'Ini_setting', 'File_line',
];

export function ResourceExplorerPage() {
  const [resourceType, setResourceType] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  const handleSearch = async () => {
    if (!resourceType) return;
    setLoading(true);
    setError(null);
    try {
      let q = `resources { type = "${resourceType}"`;
      if (titleFilter.trim()) {
        q += ` and title ~ "${titleFilter.trim()}"`;
      }
      q += ' order by certname limit 500 }';
      const r = await pql.query(q, 500);
      setResults(r.results || []);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    }
    setLoading(false);
  };

  const filtered = results.filter((r: any) =>
    !searchText ||
    r.certname?.toLowerCase().includes(searchText.toLowerCase()) ||
    r.title?.toLowerCase().includes(searchText.toLowerCase())
  );

  // Distribution: how many nodes have this resource
  const nodeCounts: Record<string, number> = {};
  results.forEach((r: any) => {
    const title = r.title || '';
    nodeCounts[title] = (nodeCounts[title] || 0) + 1;
  });
  const topResources = Object.entries(nodeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25);

  return (
    <Stack>
      <Group>
        <IconPackage size={28} />
        <Title order={2}>Resource Explorer</Title>
      </Group>

      <Alert variant="light" color="blue">
        Search and analyze Puppet resources across your entire fleet. Find which nodes
        have specific packages, services, files, or any other resource type.
      </Alert>

      <Card withBorder shadow="sm" padding="md">
        <Group align="flex-end">
          <Select
            label="Resource Type"
            placeholder="Select or type a resource type..."
            data={COMMON_TYPES.map((t) => ({ value: t, label: t }))}
            value={resourceType}
            onChange={(v) => setResourceType(v || '')}
            searchable
            creatable
            getCreateLabel={(q) => `+ Search "${q}"`}
            onCreate={(q) => { setResourceType(q); return q; }}
            style={{ flex: 1 }}
          />
          <TextInput
            label="Title Filter"
            placeholder="e.g. httpd, /etc/hosts (regex)"
            value={titleFilter}
            onChange={(e) => setTitleFilter(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button leftSection={<IconSearch size={16} />} onClick={handleSearch}
            disabled={!resourceType} loading={loading} color="green">
            Search
          </Button>
        </Group>
      </Card>

      {error && <Alert color="red" title="Search Error">{error}</Alert>}

      {!loading && results.length > 0 && (
        <>
          <Card withBorder shadow="sm" padding="md">
            <Group justify="space-between" mb="sm">
              <Group gap="sm">
                <Title order={4}>{resourceType} Resources</Title>
                <Badge color="blue" size="lg">{results.length} found</Badge>
                <Badge variant="outline">{Object.keys(nodeCounts).length} unique titles</Badge>
              </Group>
              <TextInput
                placeholder="Filter results..."
                leftSection={<IconSearch size={14} />}
                value={searchText}
                onChange={(e) => setSearchText(e.currentTarget.value)}
                style={{ width: 200 }}
              />
            </Group>

            {topResources.length > 1 && (
              <Group gap={4} mb="md" wrap="wrap">
                <Text size="xs" c="dimmed">Top titles:</Text>
                {topResources.slice(0, 10).map(([title, count]) => (
                  <Badge key={title} size="xs" variant="light" style={{ cursor: 'pointer' }}
                    onClick={() => setSearchText(title)}>
                    {title} ({count})
                  </Badge>
                ))}
              </Group>
            )}

            <ScrollArea style={{ maxHeight: 500 }}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Node</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Environment</Table.Th>
                    <Table.Th>File</Table.Th>
                    <Table.Th>Line</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((r: any, i: number) => (
                    <Table.Tr key={i}>
                      <Table.Td><Text fw={500} size="sm">{r.certname}</Text></Table.Td>
                      <Table.Td><Code style={{ fontSize: 12 }}>{r.title}</Code></Table.Td>
                      <Table.Td><Badge variant="outline" size="xs">{r.environment || 'N/A'}</Badge></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{r.file || '—'}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{r.line || '—'}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        </>
      )}

      {!loading && results.length === 0 && resourceType && (
        <Text c="dimmed" ta="center" py="xl">
          Click Search to find {resourceType} resources across your fleet.
        </Text>
      )}
    </Stack>
  );
}
