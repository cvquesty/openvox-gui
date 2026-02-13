import { useState } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, TextInput, ScrollArea, Select, Grid, Box,
} from '@mantine/core';
import { IconPackage, IconSearch } from '@tabler/icons-react';
import { pql } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { PrettyJson } from '../components/PrettyJson';

const COMMON_TYPES = [
  'Class', 'File', 'Package', 'Service', 'Exec', 'User', 'Group',
  'Cron', 'Mount', 'Yumrepo', 'Apt::Source', 'Firewall',
  'Concat', 'Concat::Fragment', 'Augeas', 'Notify',
  'Ini_setting', 'File_line',
];

/* ═══════════════════════════════════════════════════════════════
   RESOURCE-O-MATIC 9000 — the resource sorting machine
   ═══════════════════════════════════════════════════════════════ */
function ResourceOMatic() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="rm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#rm-sky)" rx="8" />

      {/* Stars */}
      <circle cx="80" cy="22" r="1" fill="#fff" opacity="0.4" />
      <circle cx="300" cy="15" r="0.9" fill="#fff" opacity="0.3" />
      <circle cx="460" cy="28" r="1.1" fill="#fff" opacity="0.5" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Conveyor belt */}
      <rect x="30" y="168" width="460" height="10" fill="#334455" rx="5" />
      <circle cx="50" cy="173" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 50 173;360 50 173" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="470" cy="173" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 470 173;360 470 173" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Resource packages on conveyor */}
      <g>
        <animateMotion dur="8s" repeatCount="indefinite" path="M0,0 L400,0" />
        <rect x="60" y="148" width="30" height="20" fill="#4488ff" rx="3" stroke="#5599ff" strokeWidth="1" />
        <text x="75" y="161" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">Package</text>
      </g>
      <g>
        <animateMotion dur="8s" repeatCount="indefinite" path="M0,0 L400,0" begin="2s" />
        <rect x="60" y="148" width="30" height="20" fill="#ff8844" rx="3" stroke="#ffaa66" strokeWidth="1" />
        <text x="75" y="161" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">Service</text>
      </g>
      <g>
        <animateMotion dur="8s" repeatCount="indefinite" path="M0,0 L400,0" begin="4s" />
        <rect x="60" y="148" width="30" height="20" fill="#44cc44" rx="3" stroke="#66dd66" strokeWidth="1" />
        <text x="75" y="161" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">File</text>
      </g>
      <g>
        <animateMotion dur="8s" repeatCount="indefinite" path="M0,0 L400,0" begin="6s" />
        <rect x="60" y="148" width="30" height="20" fill="#cc44cc" rx="3" stroke="#dd66dd" strokeWidth="1" />
        <text x="75" y="161" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">User</text>
      </g>

      {/* The sorting machine */}
      <rect x="195" y="55" width="130" height="100" fill="#3d4d5d" rx="5" stroke="#667788" strokeWidth="1.5" />
      <rect x="210" y="65" width="100" height="18" fill="#223344" rx="2" />
      <text x="260" y="77" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">RESOURCE-O-MATIC</text>
      <text x="260" y="88" textAnchor="middle" fill="#667788" fontSize="6" fontFamily="monospace">9000</text>

      {/* Gears */}
      <circle cx="230" cy="115" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="5 3">
        <animateTransform attributeName="transform" type="rotate" values="0 230 115;360 230 115" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="285" cy="115" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="5 3">
        <animateTransform attributeName="transform" type="rotate" values="360 285 115;0 285 115" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Status lights on machine */}
      <circle cx="205" cy="142" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="215" cy="142" r="3" fill="#ffaa22" />
      <circle cx="225" cy="142" r="3" fill="#44aaff" />

      {/* Sorted output bins */}
      <rect x="380" y="65" width="55" height="30" fill="#223344" rx="3" stroke="#4488ff" strokeWidth="1" />
      <text x="407" y="76" textAnchor="middle" fill="#4488ff" fontSize="5" fontFamily="monospace">Packages</text>
      <text x="407" y="89" textAnchor="middle" fill="#667788" fontSize="9" fontFamily="monospace" fontWeight="bold">42</text>

      <rect x="445" y="65" width="55" height="30" fill="#223344" rx="3" stroke="#ff8844" strokeWidth="1" />
      <text x="472" y="76" textAnchor="middle" fill="#ff8844" fontSize="5" fontFamily="monospace">Services</text>
      <text x="472" y="89" textAnchor="middle" fill="#667788" fontSize="9" fontFamily="monospace" fontWeight="bold">18</text>

      <rect x="380" y="105" width="55" height="30" fill="#223344" rx="3" stroke="#44cc44" strokeWidth="1" />
      <text x="407" y="116" textAnchor="middle" fill="#44cc44" fontSize="5" fontFamily="monospace">Files</text>
      <text x="407" y="129" textAnchor="middle" fill="#667788" fontSize="9" fontFamily="monospace" fontWeight="bold">156</text>

      <rect x="445" y="105" width="55" height="30" fill="#223344" rx="3" stroke="#cc44cc" strokeWidth="1" />
      <text x="472" y="116" textAnchor="middle" fill="#cc44cc" fontSize="5" fontFamily="monospace">Users</text>
      <text x="472" y="129" textAnchor="middle" fill="#667788" fontSize="9" fontFamily="monospace" fontWeight="bold">7</text>

      {/* Input hopper */}
      <polygon points="230,55 290,55 280,35 240,35" fill="#556677" stroke="#667788" strokeWidth="1" />
      <text x="260" y="48" textAnchor="middle" fill="#aabbcc" fontSize="6" fontFamily="monospace">INPUT</text>

      {/* Caption */}
      <text x="260" y="195" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Resource Sorting Machine</text>
      <text x="260" y="209" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">cataloging everything puppet manages</text>
    </svg>
  );
}

export function ResourceExplorerPage() {
  const { isFormal } = useAppTheme();
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
      let q = 'resources { type = "' + resourceType + '"';
      if (titleFilter.trim()) {
        q += ' and title ~ "' + titleFilter.trim() + '"';
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

      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 7 }}>
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
                getCreateLabel={(q) => '+ Search "' + q + '"'}
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
        </Grid.Col>

        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
              <ResourceOMatic />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {error && <Alert color="red" title="Search Error">{error}</Alert>}

      {!loading && results.length > 0 && (
        <Card withBorder shadow="sm" padding="md" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 450px)', minHeight: 400 }}>
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

          <Box style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <ScrollArea h="100%" offsetScrollbars scrollbarSize={8}>
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
                      <Table.Td>
                        <Code style={{ fontSize: 12, maxWidth: 400, display: 'inline-block', wordBreak: 'break-word' }}>
                          {r.title}
                        </Code>
                      </Table.Td>
                      <Table.Td><Badge variant="outline" size="xs">{r.environment || 'N/A'}</Badge></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed" style={{ maxWidth: 300, wordBreak: 'break-word' }}>{r.file || '\u2014'}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{r.line || '\u2014'}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Box>
        </Card>
      )}

      {!loading && results.length === 0 && resourceType && (
        <Text c="dimmed" ta="center" py="xl">
          Click Search to find {resourceType} resources across your fleet.
        </Text>
      )}
    </Stack>
  );
}
