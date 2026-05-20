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

const LOG_SOURCES = [
  { value: 'openvox-gui', label: 'OpenVox GUI', color: 'blue' },
  { value: 'puppet', label: 'Puppet Agent', color: 'orange' },
  { value: 'puppetserver', label: 'PuppetServer', color: 'green' },
  { value: 'puppetdb', label: 'PuppetDB', color: 'cyan' },
  { value: 'syslog', label: 'System Log', color: 'gray' },
];

export function LogsPage() {
  const [activeTab, setActiveTab] = useState<string>('openvox-gui');
  const [logData, setLogData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState<string>('200');
  const [grepFilter, setGrepFilter] = useState('');
  const [sinceFilter, setSinceFilter] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <Stack>
      <Group>
        <IconFileText size={28} />
        <Title order={2}>Logs</Title>
      </Group>

      <Card withBorder shadow="sm" padding="md">
        <Tabs value={activeTab} onChange={(v) => v && setActiveTab(v)}>
          <Tabs.List>
            {LOG_SOURCES.map(src => (
              <Tabs.Tab key={src.value} value={src.value}>
                <Group gap={6}>
                  <Text size="sm">{src.label}</Text>
                  {currentData && activeTab === src.value && (
                    <Badge size="xs" variant="light" color={src.color}>{currentData.count}</Badge>
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
            <Code block style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {currentData.lines.join('\n')}
            </Code>
          ) : (
            <Center h={200}>
              <Text c="dimmed" size="sm">No log entries found for the selected filters.</Text>
            </Center>
          )}
        </ScrollArea>
      </Card>
    </Stack>
  );
}
