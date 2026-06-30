/**
 * OpenVox GUI - Logs.tsx
 *
 * Log viewer page — browse Puppet, PuppetDB, openvox-gui, and system
 * logs without shell access. Fetches from journalctl via the backend.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Alert, Loader, Center,
  Tabs, ScrollArea, Code, Select, TextInput, Button, Badge,
  Switch, ActionIcon, Tooltip,
} from '@mantine/core';
import {
  IconFileText, IconRefresh, IconSearch, IconDownload, IconPlayerStop,
} from '@tabler/icons-react';
import { logs } from '../services/api';

/** Fallback labels when /logs/sources has not loaded yet (OpenVox-oriented defaults). */
const DEFAULT_LOG_SOURCES = [
  { value: 'openvox-gui', label: 'OpenVox GUI', color: 'blue' },
  { value: 'puppet', label: 'OpenVox Agent', color: 'orange' },
  { value: 'puppetserver', label: 'OpenVox Server', color: 'green' },
  { value: 'puppetdb', label: 'OpenVoxDB', color: 'cyan' },
  { value: 'syslog', label: 'System Log', color: 'gray' },
];

const SOURCE_COLORS: Record<string, string> = {
  'openvox-gui': 'blue',
  puppet: 'orange',
  puppetserver: 'green',
  puppetdb: 'cyan',
  syslog: 'gray',
};

export function LogsPage() {
  const [activeTab, setActiveTab] = useState<string>('openvox-gui');
  const [logSources, setLogSources] = useState(DEFAULT_LOG_SOURCES);
  const [logData, setLogData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState<string>('200');
  const [grepFilter, setGrepFilter] = useState('');
  const [sinceFilter, setSinceFilter] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stack-aware tab labels (OpenVox vs Puppet OSS) from backend package detection
  useEffect(() => {
    logs.getSources()
      .then((res) => {
        const labels: Record<string, string> = res?.labels || {};
        const meta: Array<{ id: string; label: string }> = res?.source_meta || [];
        if (meta.length) {
          setLogSources(
            meta.map((s) => ({
              value: s.id,
              label: s.label || labels[s.id] || s.id,
              color: SOURCE_COLORS[s.id] || 'gray',
            }))
          );
        } else if (labels && Object.keys(labels).length) {
          setLogSources((prev) =>
            prev.map((s) => ({
              ...s,
              label: labels[s.value] || s.label,
            }))
          );
        }
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  const fetchLogs = useCallback(async (source?: string) => {
    const src = source || activeTab;
    setLoading(true);
    setError(null);
    try {
      const result = await logs.get(src, {
        lines: parseInt(lineCount) || 200,
        since: sinceFilter || undefined,
        grep: grepFilter || undefined,
      });
      setLogData(prev => ({ ...prev, [src]: result }));
      // Auto-scroll to bottom
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [activeTab, lineCount, sinceFilter, grepFilter]);

  // Fetch on tab change
  useEffect(() => {
    fetchLogs();
  }, [activeTab]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchLogs(), 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  const handleDownload = () => {
    const data = logData[activeTab];
    if (!data?.lines) return;
    const blob = new Blob([data.lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTab}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentData = logData[activeTab];
  // Prefer backend-surfaced empty-read hints (sudo/file) over a silent blank pane
  const backendHint = currentData?.error as string | undefined;

  /**
   * Render a single log line with visual enhancements:
   * - FQDNs / certnames (e.g. agent1.example.com) in bold bright blue
   * - Command strings being executed (puppet agent, bolt runs, sudo commands, etc.)
   *   in bold red
   * - API calls and responses (e.g. "GET /api/dashboard/data HTTP/1.1" 200 OK)
   *   in bold red for easy visibility of what the GUI is doing
   */
  function renderHighlightedLine(line: string, key: number): React.ReactNode {
    const nodes: React.ReactNode[] = [];

    // FQDN / hostname regex (matches Puppet certnames and similar)
    const fqdnRegex = /\b([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)\b/g;

    // Heuristic for "the command run":
    // 1. Capture the actual command string after common patterns like `command run "..."` or `running "..."`.
    // 2. Fallback: highlight segments that start with known command binaries used in this ecosystem.
    const commandInvocationRegex = /(?:command\s+run\s+["']?|executing\s+["']?|running\s+["']?)([^"'\n]+?)(?:["']|$)/gi;
    const commandBinaryRegex = /\b(puppet(?:-agent)?|bolt|sudo|systemctl|journalctl|r10k|certbot)\s+[^\s].*?(?=\s{2,}|$|\s--targets|\s-i\s|\s--project)/gi;

    // Regex for API calls and results in logs (e.g. "GET /api/... HTTP/1.1" 200 OK)
    // This catches uvicorn/fastapi style access logs and similar entries common in the openvox-gui service logs.
    const apiCallRegex = /(?:"?(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s"]+)(?:\s+HTTP\/[\d.]+)?"?)\s+(\d{3})(?:\s+([^\s"]+))?/gi;

    // Split the line on FQDNs (keeping the delimiters via capturing group)
    const segments = line.split(fqdnRegex);

    segments.forEach((segment, segIndex) => {
      if (!segment) return;

      // Reset regex states for this segment (exec is stateful)
      fqdnRegex.lastIndex = 0;
      commandInvocationRegex.lastIndex = 0;
      commandBinaryRegex.lastIndex = 0;
      apiCallRegex.lastIndex = 0;

      // If this segment looks like an FQDN we split on, highlight it bold black
      if (fqdnRegex.test(segment) && segment.includes('.')) {
        nodes.push(
          <span
            key={`fqdn-${key}-${segIndex}`}
            style={{ fontWeight: 700, color: '#4dabf7' }}
          >
            {segment}
          </span>
        );
        fqdnRegex.lastIndex = 0;
        commandInvocationRegex.lastIndex = 0;
        commandBinaryRegex.lastIndex = 0;
        apiCallRegex.lastIndex = 0;
        return;
      }

      // Not an FQDN — look for command content inside this segment
      let processed = segment;
      let cmdMatch = commandInvocationRegex.exec(processed);

      if (cmdMatch && cmdMatch[1]) {
        // We found a "command run '...'" style invocation — highlight the captured command in bold red
        const fullMatch = cmdMatch[0];
        const cmdText = cmdMatch[1];
        const start = processed.indexOf(fullMatch);

        if (start > 0) {
          nodes.push(processed.substring(0, start));
        }

        nodes.push(
          <span
            key={`cmd-${key}-${segIndex}`}
            style={{ fontWeight: 700, color: '#e03131' }}
          >
            {cmdText}
          </span>
        );

        const after = processed.substring(start + fullMatch.length);
        if (after) nodes.push(after);

        commandInvocationRegex.lastIndex = 0;
        apiCallRegex.lastIndex = 0;
        return;
      }

      // Fallback command highlighting: any line segment containing a known binary + arguments
      cmdMatch = commandBinaryRegex.exec(processed);
      if (cmdMatch) {
        const full = cmdMatch[0];
        const start = processed.indexOf(full);

        if (start > 0) nodes.push(processed.substring(0, start));

        nodes.push(
          <span
            key={`cmd-bin-${key}-${segIndex}`}
            style={{ fontWeight: 700, color: '#e03131' }}
          >
            {full}
          </span>
        );

        const after = processed.substring(start + full.length);
        if (after) nodes.push(after);

        commandBinaryRegex.lastIndex = 0;
        apiCallRegex.lastIndex = 0;
        return;
      }

      // API call / response highlighting (e.g. "GET /api/... HTTP/1.1" 200 OK)
      // We do this on the remaining text after FQDN and command handling.
      let apiMatch = apiCallRegex.exec(processed);
      if (apiMatch) {
        const fullMatch = apiMatch[0];
        const start = processed.indexOf(fullMatch);

        if (start > 0) {
          nodes.push(processed.substring(0, start));
        }

        nodes.push(
          <span
            key={`api-${key}-${segIndex}`}
            style={{ fontWeight: 700, color: '#e03131' }}
          >
            {fullMatch}
          </span>
        );

        const after = processed.substring(start + fullMatch.length);
        if (after) nodes.push(after);

        commandInvocationRegex.lastIndex = 0;
        commandBinaryRegex.lastIndex = 0;
        apiCallRegex.lastIndex = 0;
        return;
      }

      // Plain text
      nodes.push(segment);
      commandInvocationRegex.lastIndex = 0;
      commandBinaryRegex.lastIndex = 0;
      apiCallRegex.lastIndex = 0;
    });

    // Final cleanup of regex state
    fqdnRegex.lastIndex = 0;
    commandInvocationRegex.lastIndex = 0;
    commandBinaryRegex.lastIndex = 0;
    apiCallRegex.lastIndex = 0;

    return nodes;
  }

  return (
    <Stack>
      <Group>
        <IconFileText size={28} />
        <Title order={2}>Logs</Title>
      </Group>

      <Card withBorder shadow="sm" padding="md">
        <Tabs value={activeTab} onChange={(v) => v && setActiveTab(v)}>
          <Tabs.List>
            {logSources.map(src => (
              <Tabs.Tab key={src.value} value={src.value}>
                <Group gap={6}>
                  <Text size="sm">{src.label}</Text>
                  {currentData && activeTab === src.value && (
                    <Badge size="xs" variant="light" color={src.color}>{currentData.count ?? 0}</Badge>
                  )}
                </Group>
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {/* Controls */}
        <Group mt="md" gap="sm" wrap="wrap">
          <Select
            size="xs"
            label="Lines"
            data={['50', '100', '200', '500', '1000', '2000']}
            value={lineCount}
            onChange={(v) => setLineCount(v || '200')}
            style={{ width: 90 }}
          />
          <Select
            size="xs"
            label="Since"
            data={[
              { value: '', label: 'All available' },
              { value: '5m ago', label: 'Last 5 minutes' },
              { value: '15m ago', label: 'Last 15 minutes' },
              { value: '1h ago', label: 'Last hour' },
              { value: '4h ago', label: 'Last 4 hours' },
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Since yesterday' },
            ]}
            value={sinceFilter || ''}
            onChange={(v) => setSinceFilter(v || null)}
            style={{ width: 160 }}
            clearable
          />
          <TextInput
            size="xs"
            label="Filter"
            placeholder="Search log text..."
            leftSection={<IconSearch size={14} />}
            value={grepFilter}
            onChange={(e) => setGrepFilter(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
            style={{ width: 200 }}
          />
          <Group gap="xs" mt={22}>
            <Button size="xs" leftSection={<IconRefresh size={14} />} onClick={() => fetchLogs()} loading={loading}>
              Refresh
            </Button>
            <Tooltip label={autoRefresh ? 'Stop auto-refresh' : 'Auto-refresh every 5s'}>
              <ActionIcon
                size="lg"
                variant={autoRefresh ? 'filled' : 'light'}
                color={autoRefresh ? 'green' : 'gray'}
                onClick={() => setAutoRefresh(prev => !prev)}
              >
                {autoRefresh ? <IconPlayerStop size={16} /> : <IconRefresh size={16} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Download as .log file">
              <ActionIcon size="lg" variant="light" onClick={handleDownload} disabled={!currentData?.lines?.length}>
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {error && <Alert color="red" mt="sm" withCloseButton onClose={() => setError(null)}>{error}</Alert>}

        {/* Log output */}
        <ScrollArea h="calc(100vh - 340px)" mih={300} mah={800} mt="sm" viewportRef={scrollRef}>
          {loading && !currentData ? (
            <Center h={200}><Loader /></Center>
          ) : currentData?.lines?.length > 0 ? (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.55,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                backgroundColor: '#1e1e1e',
                color: '#d4d4d4',
                padding: '10px 12px',
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                border: '1px solid #333',
              }}
            >
              {currentData.lines.map((line: string, index: number) => (
                <div key={index} style={{ minHeight: '1.35em' }}>
                  {renderHighlightedLine(line, index)}
                </div>
              ))}
            </div>
          ) : (
            <Center h={200}>
              <Stack gap={4} align="center">
                <Text c="dimmed" size="sm">No log entries found for the selected filters.</Text>
                {backendHint && (
                  <Text c="orange" size="xs" maw={640} ta="center">{backendHint}</Text>
                )}
              </Stack>
            </Center>
          )}
        </ScrollArea>
      </Card>
    </Stack>
  );
}
