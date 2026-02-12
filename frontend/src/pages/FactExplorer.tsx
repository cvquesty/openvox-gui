import { useState, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Alert, Loader, Center,
  Table, Badge, Select, TextInput, ScrollArea, Grid,
} from '@mantine/core';
import { IconSearch, IconFilter } from '@tabler/icons-react';
import { facts } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';

/* ═══════════════════════════════════════════════════════════════
   FACT-O-SCOPE 5000 — the giant magnifying glass
   ═══════════════════════════════════════════════════════════════ */
function FactOScope() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#fs-sky)" rx="8" />

      {/* Stars */}
      <circle cx="60" cy="25" r="1" fill="#fff" opacity="0.4" />
      <circle cx="200" cy="18" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="420" cy="30" r="1.1" fill="#fff" opacity="0.5" />
      <circle cx="480" cy="14" r="0.7" fill="#fff" opacity="0.4" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Giant magnifying glass */}
      <circle cx="260" cy="105" r="58" fill="none" stroke="#667788" strokeWidth="4" />
      <circle cx="260" cy="105" r="53" fill="#0a1628" opacity="0.6" />
      <line x1="300" y1="148" x2="348" y2="196" stroke="#667788" strokeWidth="6" strokeLinecap="round" />
      {/* Handle grip */}
      <rect x="342" y="190" width="18" height="8" fill="#556677" rx="3" transform="rotate(45 351 194)" />

      {/* Scan ring animation */}
      <circle cx="260" cy="105" r="35" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values="25;50;25" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Facts floating inside the lens */}
      <text x="225" y="82" fill="#44ff88" fontSize="7" fontFamily="monospace" opacity="0.9">os.family = RedHat</text>
      <text x="230" y="95" fill="#ffaa44" fontSize="7" fontFamily="monospace" opacity="0.9">kernel = Linux</text>
      <text x="220" y="108" fill="#44aaff" fontSize="7" fontFamily="monospace" opacity="0.9">memory = 4.0 GiB</text>
      <text x="235" y="121" fill="#ff6688" fontSize="7" fontFamily="monospace" opacity="0.9">uptime = 42 days</text>
      <text x="228" y="134" fill="#aabb44" fontSize="7" fontFamily="monospace">
        ipaddr = 10.0.1.5
        <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite" />
      </text>

      {/* Tiny servers being examined (left) */}
      <rect x="40" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="43" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="43" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="43" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="52" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">web01</text>

      <rect x="75" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="78" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="78" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="78" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="87" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">db01</text>

      <rect x="110" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="113" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="113" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="113" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="122" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">app01</text>

      {/* Analysis card (right) */}
      <rect x="400" y="80" width="95" height="70" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="410" y="95" fill="#888" fontSize="6" fontFamily="monospace">ANALYSIS</text>
      <line x1="405" y1="99" x2="488" y2="99" stroke="#334455" strokeWidth="0.5" />
      <text x="410" y="112" fill="#44ff88" fontSize="5" fontFamily="monospace">5 nodes scanned</text>
      <text x="410" y="122" fill="#44aaff" fontSize="5" fontFamily="monospace">125 facts found</text>
      <text x="410" y="132" fill="#ffaa44" fontSize="5" fontFamily="monospace">3 unique values</text>
      <text x="410" y="142" fill="#ff6688" fontSize="5" fontFamily="monospace">0 anomalies</text>

      {/* Label plate */}
      <rect x="195" y="188" width="130" height="16" fill="#334455" rx="2" />
      <text x="260" y="199" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">FACT-O-SCOPE 5000</text>

      {/* Status lights */}
      <circle cx="205" cy="210" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="215" cy="210" r="3" fill="#ffaa22" />
      <circle cx="225" cy="210" r="3" fill="#44aaff" />

      {/* Caption */}
      <text x="260" y="232" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Fact Finder</text>
      <text x="260" y="246" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">every fact. every node. every time.</text>
    </svg>
  );
}

export function FactExplorerPage() {
  const { isFormal } = useAppTheme();
  const [factNames, setFactNames] = useState<string[]>([]);
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factData, setFactData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [namesLoading, setNamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

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

      {/* Controls + illustration */}
      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 7 }}>
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
        </Grid.Col>

        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
              <FactOScope />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}

      {loading && <Center h={200}><Loader size="xl" /></Center>}

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

      {!loading && selectedFact && factData.length === 0 && !error && (
        <Alert color="yellow">No data found for fact "{selectedFact}".</Alert>
      )}
    </Stack>
  );
}
