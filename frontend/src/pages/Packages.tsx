import { useState } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text,
  TextInput, Button, Badge, Code,
} from '@mantine/core';
import { IconSearch, IconPackage } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { nodes } from '../services/api';

/**
 * Package Inventory Page
 *
 * Allows administrators to search for installed packages across the entire
 * fleet of managed nodes. Answers questions like "which servers have
 * openssl 1.1.1?" or "where is httpd installed?" by querying PuppetDB's
 * package inventory data.
 *
 * The page provides a search interface with package name and optional
 * version filter. Results are displayed in a table showing certname,
 * package name, version, and provider (yum, apt, etc.).
 */
export function PackagesPage() {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!name.trim()) {
      notifications.show({ title: 'Required', message: 'Enter a package name to search', color: 'yellow' });
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await nodes.searchPackages(name.trim(), version.trim() || undefined);
      setResults(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  // Count unique certnames in results
  const uniqueNodes = results ? new Set(results.map((r) => r.certname)).size : 0;
  // Count unique versions
  const uniqueVersions = results ? [...new Set(results.map((r) => r.version))].sort() : [];

  return (
    <Stack>
      <Title order={2}>📦 Package Inventory</Title>

      <Alert variant="light" color="blue" mb="xs">
        Search for installed packages across your entire fleet. Find out which servers
        have a specific package installed and what version they're running. Useful for
        security audits, upgrade planning, and compliance checks.
      </Alert>

      <Card withBorder shadow="sm">
        <Group align="flex-end">
          <TextInput
            label="Package Name"
            placeholder="e.g. openssl, httpd, nginx, puppet-agent"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            style={{ flex: 2 }}
            required
            leftSection={<IconPackage size={16} />}
          />
          <TextInput
            label="Version (optional)"
            placeholder="e.g. 1.1.1, 2.4.6"
            value={version}
            onChange={(e) => setVersion(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            style={{ flex: 1 }}
          />
          <Button onClick={handleSearch} loading={loading}
            leftSection={<IconSearch size={16} />}>
            Search Fleet
          </Button>
        </Group>
      </Card>

      {error && <Alert color="red" title="Error">{error}</Alert>}

      {results && (
        <Card withBorder shadow="sm">
          <Group justify="space-between" mb="md">
            <Text fw={700}>
              Results: {results.length} entries across {uniqueNodes} node{uniqueNodes !== 1 ? 's' : ''}
            </Text>
            {uniqueVersions.length > 0 && (
              <Group gap="xs">
                <Text size="sm" c="dimmed">Versions found:</Text>
                {uniqueVersions.map((v) => (
                  <Badge key={v} variant="light" size="sm">{v}</Badge>
                ))}
              </Group>
            )}
          </Group>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Certname</Table.Th>
                <Table.Th>Package</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Provider</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {results.map((pkg, i) => (
                <Table.Tr key={i}>
                  <Table.Td><Text fw={500} size="sm">{pkg.certname}</Text></Table.Td>
                  <Table.Td><Code>{pkg.package_name}</Code></Table.Td>
                  <Table.Td><Badge variant="outline" size="sm">{pkg.version}</Badge></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{pkg.provider || '—'}</Text></Table.Td>
                </Table.Tr>
              ))}
              {results.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" ta="center" py="lg">
                      No packages matching "{name}" found across the fleet
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {!results && !loading && (
        <Card withBorder shadow="sm" padding="xl">
          <Center>
            <Stack align="center" gap="xs">
              <IconPackage size={48} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Enter a package name and click "Search Fleet" to see which nodes have it installed</Text>
            </Stack>
          </Center>
        </Card>
      )}
    </Stack>
  );
}
