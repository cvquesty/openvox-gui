import { useState, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Textarea, Alert, Loader, Center,
  Code, Badge, Select, Table, ScrollArea, Paper, ActionIcon, Tooltip, Grid,
} from '@mantine/core';
import { IconTerminal, IconPlayerPlay, IconTrash, IconCopy } from '@tabler/icons-react';
import { pql, nodes as nodesApi } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { PrettyJson } from '../components/PrettyJson';

/* ═══════════════════════════════════════════════════════════════
   QUERY-O-TRON 7000 — the PQL query machine
   ═══════════════════════════════════════════════════════════════ */
function QueryOTron() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="qt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#qt-sky)" rx="8" />

      {/* Stars */}
      <circle cx="50" cy="20" r="1" fill="#fff" opacity="0.4" />
      <circle cx="150" cy="35" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="380" cy="15" r="1.2" fill="#fff" opacity="0.5" />
      <circle cx="470" cy="30" r="0.7" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Giant Database cylinder */}
      <ellipse cx="260" cy="80" rx="65" ry="18" fill="#3a4a66" stroke="#5577aa" strokeWidth="1.5" />
      <rect x="195" y="80" width="130" height="90" fill="#2a3a55" stroke="#5577aa" strokeWidth="1.5" />
      <ellipse cx="260" cy="170" rx="65" ry="18" fill="#334466" stroke="#5577aa" strokeWidth="1.5" />

      {/* Data rows scrolling inside */}
      <rect x="205" y="95" width="110" height="8" rx="2" fill="#223344" />
      <text x="215" y="102" fill="#44aaff" fontSize="6" fontFamily="monospace">SELECT * FROM nodes</text>
      <rect x="205" y="108" width="110" height="8" rx="2" fill="#223344" />
      <text x="215" y="115" fill="#44ff88" fontSize="6" fontFamily="monospace">{"facts { name = \"os\" }"}</text>
      <rect x="205" y="121" width="110" height="8" rx="2" fill="#223344" />
      <text x="215" y="128" fill="#ffaa44" fontSize="6" fontFamily="monospace">{"reports { status }"}</text>
      <rect x="205" y="134" width="110" height="8" rx="2" fill="#223344">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
      </rect>
      <text x="215" y="141" fill="#ff6688" fontSize="6" fontFamily="monospace">
        {"resources[certname]"}
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
      </text>

      {/* Lightning bolts = queries */}
      <polyline points="185,40 198,65 190,65 205,80" fill="none" stroke="#44aaff" strokeWidth="2" opacity="0.8">
        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" repeatCount="indefinite" />
      </polyline>
      <polyline points="335,40 322,65 330,65 315,80" fill="none" stroke="#44aaff" strokeWidth="2" opacity="0.6">
        <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.8s" repeatCount="indefinite" begin="0.5s" />
      </polyline>
      <polyline points="260,25 257,55 263,55 259,75" fill="none" stroke="#ffaa44" strokeWidth="2.5" opacity="0.9">
        <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.2s" repeatCount="indefinite" begin="0.3s" />
      </polyline>

      {/* Input query scroll (left) */}
      <rect x="30" y="90" width="100" height="70" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="40" y="105" fill="#888" fontSize="6" fontFamily="monospace">PQL INPUT</text>
      <line x1="35" y1="109" x2="120" y2="109" stroke="#334455" strokeWidth="0.5" />
      <text x="40" y="121" fill="#44aaff" fontSize="5" fontFamily="monospace">{"nodes {"}</text>
      <text x="44" y="129" fill="#44aaff" fontSize="5" fontFamily="monospace">  certname</text>
      <text x="44" y="137" fill="#44aaff" fontSize="5" fontFamily="monospace">  = "web01"</text>
      <text x="40" y="145" fill="#44aaff" fontSize="5" fontFamily="monospace">{"}"}</text>

      {/* Arrow to brain */}
      <text x="142" y="125" fill="#556677" fontSize="14">{"\u2192"}</text>

      {/* Output results (right) */}
      <rect x="390" y="90" width="100" height="70" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="400" y="105" fill="#888" fontSize="6" fontFamily="monospace">RESULTS</text>
      <line x1="395" y1="109" x2="480" y2="109" stroke="#334455" strokeWidth="0.5" />
      <text x="400" y="121" fill="#44ff88" fontSize="5" fontFamily="monospace">web01.lab</text>
      <text x="400" y="131" fill="#44ff88" fontSize="5" fontFamily="monospace">  os: Rocky</text>
      <text x="400" y="141" fill="#44ff88" fontSize="5" fontFamily="monospace">  env: prod</text>
      <circle cx="400" cy="152" r="2" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
      </circle>
      <text x="407" y="155" fill="#44ff88" fontSize="5" fontFamily="monospace">5 rows</text>

      {/* Arrow from brain */}
      <text x="365" y="125" fill="#556677" fontSize="14">{"\u2192"}</text>

      {/* Label plate */}
      <rect x="200" y="178" width="120" height="16" fill="#334455" rx="2" />
      <text x="260" y="189" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">QUERY-O-TRON 7000</text>

      {/* Status lights */}
      <circle cx="215" cy="200" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="225" cy="200" r="3" fill="#44aaff" />
      <circle cx="235" cy="200" r="3" fill="#ffaa22" />

      {/* Caption */}
      <text x="260" y="232" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Query Machine</text>
      <text x="260" y="246" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">{"questions in \u2192 answers out (usually)"}</text>
    </svg>
  );
}

export function PQLConsolePage() {
  const { isFormal } = useAppTheme();
  const [query, setQuery] = useState('nodes {}');
  const [results, setResults] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<any[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [certnames, setCertnames] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    pql.getExamples().then((d) => setExamples(d.examples || [])).catch(() => {});
    nodesApi.list().then((ns: any[]) => setCertnames(ns.map((n) => n.certname).sort())).catch(() => {});
  }, []);

  const handleNodeSelect = (certname: string | null) => {
    setSelectedNode(certname);
    if (certname && query.includes('NODENAME')) {
      setQuery(query.replace(/NODENAME/g, certname));
    }
  };

  const handleExampleSelect = (exampleQuery: string | null) => {
    if (!exampleQuery) return;
    let q = exampleQuery;
    if (selectedNode) {
      q = q.replace(/NODENAME/g, selectedNode);
    }
    setQuery(q);
  };

  const handleRun = async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const r = await pql.query(query.trim());
      setResults(r);
      setHistory((prev) => [query.trim(), ...prev.filter((h) => h !== query.trim())].slice(0, 20));
    } catch (e: any) {
      // Parse error message to extract a human-readable PuppetDB error
      let msg = e.message || 'Unknown error';
      // Try to extract the detail from JSON error responses like: API Error 400: {"detail":"..."}
      const jsonMatch = msg.match(/\{[^]*"detail"\s*:\s*"([^"]*)"/);
      if (jsonMatch) {
        msg = jsonMatch[1];
      }
      setError(msg);
    }
    setRunning(false);
  };

  const columns: string[] = [];
  if (results?.results?.length > 0) {
    const first = results.results[0];
    if (typeof first === 'object' && first !== null) {
      Object.keys(first).forEach((k) => {
        if (!columns.includes(k)) columns.push(k);
      });
    }
  }

  return (
    <Stack>
      <Group>
        <IconTerminal size={28} />
        <Title order={2}>PQL Console</Title>
      </Group>

      <Alert variant="light" color="blue">
        Execute <Text span fw={700}>Puppet Query Language</Text> queries directly against PuppetDB.
        PQL provides full access to nodes, facts, resources, reports, and events.
      </Alert>

      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 7 }}>
          <Card withBorder shadow="sm" padding="md">
            <Group align="flex-end" mb="sm" grow>
              <Select
                label="Examples"
                placeholder="Load an example query..."
                data={examples.map((e: any) => ({ value: e.query, label: e.label }))}
                onChange={handleExampleSelect}
                clearable
                searchable
                style={{ flex: 1 }}
              />
              <Select
                label="Certname"
                placeholder="Select a node..."
                data={certnames.map((n) => ({ value: n, label: n }))}
                value={selectedNode}
                onChange={handleNodeSelect}
                clearable
                searchable
                nothingFoundMessage="No matching nodes"
                style={{ flex: 1 }}
                description={query.includes('NODENAME') ? 'Replaces NODENAME in query' : undefined}
              />
            </Group>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder='nodes { latest_report_status = "failed" }'
              autosize
              minRows={3}
              maxRows={8}
              styles={{ input: { fontFamily: 'monospace', fontSize: 14 } }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun(); }}
            />
            <Group mt="sm" justify="space-between">
              <Text size="xs" c="dimmed">Ctrl+Enter to run</Text>
              <Group gap="xs">
                <Button variant="subtle" color="gray" size="sm" onClick={() => { setQuery(''); setResults(null); setError(null); }}>
                  Clear
                </Button>
                <Button
                  leftSection={running ? <Loader size={14} color="white" /> : <IconPlayerPlay size={16} />}
                  onClick={handleRun}
                  loading={running}
                  disabled={!query.trim()}
                  color="green"
                >
                  Run Query
                </Button>
              </Group>
            </Group>
          </Card>
        </Grid.Col>

        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
              <QueryOTron />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {error && (
        <Alert color="red" title="Query Error" withCloseButton onClose={() => setError(null)}>
          <Text size="sm" mb="xs">{error}</Text>
          <Text size="xs" c="dimmed">Check the PQL syntax and try again. PuppetDB requires valid PQL entity names and ISO 8601 timestamps (relative time strings like "2 hours ago" are not supported).</Text>
        </Alert>
      )}

      {results && (
        <Card withBorder shadow="sm" padding="md">
          <Group justify="space-between" mb="md">
            <Group gap="sm">
              <Title order={4}>Results</Title>
              <Badge color="blue" size="lg">{results.count} rows</Badge>
            </Group>
            <Tooltip label="Copy as JSON">
              <ActionIcon variant="subtle" onClick={() => navigator.clipboard.writeText(JSON.stringify(results.results, null, 2))}>
                <IconCopy size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {columns.length > 0 ? (
            <ScrollArea style={{ maxHeight: "calc(100vh - 200px)" }}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    {columns.map((col) => (
                      <Table.Th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {results.results.map((row: any, i: number) => (
                    <Table.Tr key={i}>
                      {columns.map((col) => (
                        <Table.Td key={col}>
                          <Text size="xs" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                          </Text>
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : (
            <ScrollArea style={{ maxHeight: "calc(100vh - 200px)" }}>
              <PrettyJson data={results.results} maxHeight="calc(100vh - 200px)" />
            </ScrollArea>
          )}
        </Card>
      )}

      {history.length > 0 && (
        <Card withBorder shadow="sm" padding="md">
          <Group justify="space-between" mb="sm">
            <Title order={5}>Query History</Title>
            <Button variant="subtle" size="xs" color="gray" onClick={() => setHistory([])}>Clear</Button>
          </Group>
          <Stack gap={4}>
            {history.map((h, i) => (
              <Paper key={i} withBorder p="xs" style={{ cursor: 'pointer' }} onClick={() => setQuery(h)}>
                <Code style={{ fontSize: 11 }}>{h}</Code>
              </Paper>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
