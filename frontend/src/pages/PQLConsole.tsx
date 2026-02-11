import { useState, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Textarea, Alert, Loader, Center,
  Code, Badge, Select, Table, ScrollArea, Paper, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconTerminal, IconPlayerPlay, IconTrash, IconCopy } from '@tabler/icons-react';
import { pql, nodes as nodesApi } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';

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

  // When a node is selected, substitute NODENAME in the query
  const handleNodeSelect = (certname: string | null) => {
    setSelectedNode(certname);
    if (certname && query.includes('NODENAME')) {
      setQuery(query.replace(/NODENAME/g, certname));
    }
  };

  // When an example is selected, substitute NODENAME if a node is already chosen
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
      setError(e.message);
    }
    setRunning(false);
  };

  // Auto-detect columns from results
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

      {error && (
        <Alert color="red" title="Query Error" withCloseButton onClose={() => setError(null)}>
          <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{error}</Code>
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
              <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(results.results, null, 2)}
              </Code>
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
