import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, TextInput, Textarea, Select, Badge, Code, Grid, Divider,
  Paper, ThemeIcon, Box, SegmentedControl, ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconTerminal2, IconListDetails, IconRoute, IconSettings, IconPlayerPlay,
  IconBolt, IconHistory, IconFileUpload, IconFileDownload, IconFiles, IconUpload, IconX,
} from '@tabler/icons-react';
import { bolt, nodes as nodesApi, enc } from '../services/api';
import { IconScript } from '@tabler/icons-react';
import { useAppTheme } from '../hooks/ThemeContext';
import AnsiToHtml from 'ansi-to-html';
import { ExecutionHistory } from '../components/ExecutionHistory';
import { PrettyJson } from '../components/PrettyJson';

/* ── ANSI color converter (singleton) ──────────────────────── */
const ansiConverter = new AnsiToHtml({
  fg: '#d4d4d4',
  bg: 'transparent',
  newline: true,
  escapeXML: true,
  colors: {
    0: '#1e1e1e', 1: '#e06c75', 2: '#98c379', 3: '#e5c07b',
    4: '#61afef', 5: '#c678dd', 6: '#56b6c2', 7: '#d4d4d4',
    8: '#5c6370', 9: '#e06c75', 10: '#98c379', 11: '#e5c07b',
    12: '#61afef', 13: '#c678dd', 14: '#56b6c2', 15: '#ffffff',
  },
});

/* ── Shared result pane with ANSI color support ────────────── */
function ResultPane({ results }: { results: { human?: any; json?: any; rainbow?: any } | null }) {
  const [activeTab, setActiveTab] = useState<string>('human');
  
  if (!results) return null;
  
  // Get the first available result to check status
  const firstResult = results.human || results.json || results.rainbow;
  if (!firstResult) return null;

  const renderOutput = (result: any, format: string) => {
    if (!result || !result.output) return null;
    
    if (format === 'rainbow') {
      const outputHtml = ansiConverter.toHtml(result.output);
      return (
        <Box
          style={{
            backgroundColor: '#1e1e1e',
            borderRadius: 6,
            padding: '12px 16px',
            fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
          dangerouslySetInnerHTML={{ __html: outputHtml }}
        />
      );
    }
    
    if (format === 'json') {
      // Try to parse and pretty print JSON
      try {
        const parsed = JSON.parse(result.output);
        return <PrettyJson data={parsed} withBorder={false} />;
      } catch {
        // If not valid JSON, show as regular code
        return (
          <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {result.output}
          </Code>
        );
      }
    }
    
    // Default (human format)
    return (
      <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {result.output}
      </Code>
    );
  };

  return (
    <Card withBorder shadow="sm">
      <Group mb="sm">
        <Text fw={700}>Result</Text>
        <Badge color={firstResult.returncode === 0 ? 'green' : 'red'}>
          {firstResult.returncode === 0 ? 'Success' : `Exit ${firstResult.returncode}`}
        </Badge>
      </Group>
      
      <Tabs value={activeTab} onChange={(v) => setActiveTab(v || 'human')}>
        <Tabs.List>
          <Tabs.Tab value="human" disabled={!results.human}>
            📄 Human
          </Tabs.Tab>
          <Tabs.Tab value="json" disabled={!results.json}>
            🔣 JSON
          </Tabs.Tab>
          <Tabs.Tab value="rainbow" disabled={!results.rainbow}>
            🌈 Rainbow
          </Tabs.Tab>
        </Tabs.List>
        
        <Tabs.Panel value="human" pt="sm" style={{ height: '65vh', overflow: 'hidden' }}>
          <ScrollArea style={{ height: '100%' }}>
            {results.human && renderOutput(results.human, 'human')}
            {results.human?.error && (
              <Alert color="red" mt="sm">
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{results.human.error}</Text>
              </Alert>
            )}
          </ScrollArea>
        </Tabs.Panel>
        
        <Tabs.Panel value="json" pt="sm" style={{ height: '65vh', overflow: 'hidden' }}>
          <ScrollArea style={{ height: '100%' }}>
            {results.json && renderOutput(results.json, 'json')}
            {results.json?.error && (
              <Alert color="red" mt="sm">
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{results.json.error}</Text>
              </Alert>
            )}
          </ScrollArea>
        </Tabs.Panel>
        
        <Tabs.Panel value="rainbow" pt="sm" style={{ height: '65vh', overflow: 'hidden' }}>
          <ScrollArea style={{ height: '100%' }}>
            {results.rainbow && renderOutput(results.rainbow, 'rainbow')}
            {results.rainbow?.error && (
              <Alert color="red" mt="sm">
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{results.rainbow.error}</Text>
              </Alert>
            )}
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOLT-O-MATIC 4000 — orchestration machine cartoon
   ═══════════════════════════════════════════════════════════════ */
function BoltOMatic() {
  return (
    <svg viewBox="0 0 520 300" width="100%" style={{ maxHeight: 320 }}>
      <defs>
        <linearGradient id="bo-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="bo-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
      </defs>

      <rect width="520" height="300" fill="url(#bo-sky)" rx="8" />

      {/* Stars */}
      <circle cx="30" cy="20" r="1" fill="#ffffff" opacity="0.6" />
      <circle cx="90" cy="45" r="0.8" fill="#ffffff" opacity="0.4" />
      <circle cx="150" cy="15" r="1.2" fill="#ffffff" opacity="0.5" />
      <circle cx="250" cy="30" r="0.7" fill="#ffffff" opacity="0.3" />
      <circle cx="350" cy="20" r="1" fill="#ffffff" opacity="0.5" />
      <circle cx="420" cy="40" r="0.8" fill="#ffffff" opacity="0.4" />
      <circle cx="480" cy="25" r="1.1" fill="#ffffff" opacity="0.6" />
      <circle cx="60" cy="55" r="0.6" fill="#ffffff" opacity="0.3" />
      <circle cx="500" cy="55" r="0.9" fill="#ffffff" opacity="0.4" />

      {/* Ground */}
      <rect x="0" y="248" width="520" height="52" fill="#1a1a2e" />
      <rect x="0" y="248" width="520" height="2" fill="#333355" />

      {/* Central Control Console */}
      <rect x="170" y="100" width="180" height="150" fill="url(#bo-metal)" rx="8" stroke="#7788aa" strokeWidth="1.5" />
      <rect x="185" y="110" width="150" height="50" fill="#0a1628" rx="4" stroke="#334466" strokeWidth="1" />
      <rect x="185" y="110" width="150" height="2" fill="#44aaff" opacity="0.3">
        <animate attributeName="y" values="110;158;110" dur="3s" repeatCount="indefinite" />
      </rect>
      <text x="195" y="128" fill="#44ff88" fontSize="7" fontFamily="monospace" opacity="0.9">$ bolt task run</text>
      <text x="195" y="138" fill="#44aaff" fontSize="6" fontFamily="monospace" opacity="0.7">Running on 5 targets...</text>
      <text x="195" y="148" fill="#44ff44" fontSize="6" fontFamily="monospace">✓ 5 succeeded | 0 failed</text>

      <rect x="195" y="168" width="130" height="18" fill="#334455" rx="3" />
      <text x="260" y="180" textAnchor="middle" fill="#EC8622" fontSize="8" fontFamily="monospace" fontWeight="bold">BOLT-O-MATIC 4000</text>

      <circle cx="210" cy="200" r="6" fill="#44ff44" stroke="#22aa22" strokeWidth="1">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="210" y="203" textAnchor="middle" fill="#1a1a2e" fontSize="5" fontWeight="bold">▶</text>
      <circle cx="230" cy="200" r="6" fill="#ffaa22" stroke="#cc8811" strokeWidth="1" />
      <text x="230" y="203" textAnchor="middle" fill="#1a1a2e" fontSize="5" fontWeight="bold">⏸</text>
      <circle cx="250" cy="200" r="6" fill="#ff4444" stroke="#cc2222" strokeWidth="1" />
      <text x="250" y="203" textAnchor="middle" fill="#1a1a2e" fontSize="5" fontWeight="bold">■</text>

      <circle cx="300" cy="200" r="12" fill="#334455" stroke="#667788" strokeWidth="1.5" />
      <line x1="300" y1="200" x2="300" y2="190" stroke="#EC8622" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" values="0 300 200;360 300 200" dur="4s" repeatCount="indefinite" />
      </line>
      <circle cx="300" cy="200" r="3" fill="#556677" />

      <circle cx="200" cy="225" r="3" fill="#44ff44"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" /></circle>
      <circle cx="212" cy="225" r="3" fill="#44ff44"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.2s" /></circle>
      <circle cx="224" cy="225" r="3" fill="#44ff44"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.4s" /></circle>
      <circle cx="236" cy="225" r="3" fill="#ffaa22"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" /></circle>
      <circle cx="248" cy="225" r="3" fill="#44aaff"><animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" /></circle>

      {/* Lightning bolts */}
      <polyline points="170,150 130,140 140,155 100,148" fill="none" stroke="#EC8622" strokeWidth="2" opacity="0.8">
        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="0.8s" repeatCount="indefinite" />
      </polyline>
      <polyline points="350,150 390,140 380,155 420,148" fill="none" stroke="#EC8622" strokeWidth="2" opacity="0.8">
        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="0.8s" repeatCount="indefinite" begin="0.3s" />
      </polyline>
      <polyline points="170,170 110,180 120,190 60,185" fill="none" stroke="#ffaa22" strokeWidth="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite" begin="0.5s" />
      </polyline>
      <polyline points="350,170 410,180 400,190 460,185" fill="none" stroke="#ffaa22" strokeWidth="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite" begin="0.8s" />
      </polyline>

      {/* Target servers */}
      <rect x="35" y="160" width="50" height="35" fill="#445566" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="40" y="165" width="40" height="8" fill="#0a1628" rx="1" />
      <text x="60" y="172" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">web01</text>
      <circle cx="45" cy="185" r="2" fill="#44ff44" /><circle cx="52" cy="185" r="2" fill="#44ff44" />
      <text x="60" y="192" textAnchor="middle" fill="#44ff44" fontSize="8">✓</text>

      <rect x="80" y="120" width="50" height="35" fill="#445566" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="85" y="125" width="40" height="8" fill="#0a1628" rx="1" />
      <text x="105" y="132" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">web02</text>
      <circle cx="90" cy="145" r="2" fill="#44ff44" /><circle cx="97" cy="145" r="2" fill="#44ff44" />
      <text x="105" y="152" textAnchor="middle" fill="#44ff44" fontSize="8">✓</text>

      <rect x="395" y="120" width="50" height="35" fill="#445566" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="400" y="125" width="40" height="8" fill="#0a1628" rx="1" />
      <text x="420" y="132" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">db01</text>
      <circle cx="405" cy="145" r="2" fill="#44ff44" /><circle cx="412" cy="145" r="2" fill="#44ff44" />
      <text x="420" y="152" textAnchor="middle" fill="#44ff44" fontSize="8">✓</text>

      <rect x="435" y="160" width="50" height="35" fill="#445566" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="440" y="165" width="40" height="8" fill="#0a1628" rx="1" />
      <text x="460" y="172" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">app01</text>
      <circle cx="445" cy="185" r="2" fill="#44ff44" /><circle cx="452" cy="185" r="2" fill="#44ff44" />
      <text x="460" y="192" textAnchor="middle" fill="#44ff44" fontSize="8">✓</text>

      {/* Antenna */}
      <line x1="260" y1="100" x2="260" y2="70" stroke="#667788" strokeWidth="2" />
      <circle cx="260" cy="65" r="5" fill="none" stroke="#EC8622" strokeWidth="1.5">
        <animate attributeName="r" values="5;12;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="260" cy="65" r="3" fill="#EC8622" />

      <text x="260" y="268" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Orchestration Engine</text>
      <text x="260" y="282" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">lightning-fast task execution across your fleet</text>
      <text x="260" y="294" textAnchor="middle" fill="#445566" fontSize="6" fontFamily="monospace">(powered by OpenBolt)</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 1: OVERVIEW + CARTOON
   ═══════════════════════════════════════════════════════════════ */
function OverviewTab() {
  const { isFormal } = useAppTheme();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bolt.getStatus().then(setStatus).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Grid>
        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
              <BoltOMatic />
            </Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 5 }}>
          <Stack>
            <Card withBorder shadow="sm" padding="md">
              <Text fw={700} mb="sm">OpenBolt Status</Text>
              <Group gap="sm" mb="md">
                <Text size="sm" c="dimmed">Installed:</Text>
                <Badge color={status?.installed ? 'green' : 'red'} size="lg">
                  {status?.installed ? 'Yes' : 'No'}
                </Badge>
              </Group>
              {status?.installed ? (
                <>
                  <Group gap="sm" mb="xs">
                    <Text size="sm" c="dimmed">Version:</Text>
                    <Code>{status.version || 'unknown'}</Code>
                  </Group>
                  <Group gap="sm">
                    <Text size="sm" c="dimmed">Path:</Text>
                    <Code>{status.path}</Code>
                  </Group>
                </>
              ) : (
                <Alert color="yellow" variant="light">
                  <Text size="sm">OpenBolt is not installed on this server.</Text>
                  <Text size="xs" c="dimmed" mt="xs">
                    Install with: <Code>sudo yum install openbolt</Code> or <Code>sudo apt install openbolt</Code>
                  </Text>
                </Alert>
              )}
            </Card>

            <Card withBorder shadow="sm" padding="md">
              <Text fw={700} mb="sm">Capabilities</Text>
              <Stack gap="xs">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="blue"><IconTerminal2 size={12} /></ThemeIcon>
                  <Text size="sm">Run ad-hoc commands on remote nodes</Text>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="orange"><IconListDetails size={12} /></ThemeIcon>
                  <Text size="sm">Execute tasks (pre-packaged scripts)</Text>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="grape"><IconRoute size={12} /></ThemeIcon>
                  <Text size="sm">Run plans (multi-step workflows)</Text>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="green"><IconBolt size={12} /></ThemeIcon>
                  <Text size="sm">Agentless — no OpenVox agent required on targets</Text>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2: RUN COMMAND
   ═══════════════════════════════════════════════════════════════ */
function RunCommandTab() {
  const [command, setCommand] = useState('');
  const [targets, setTargets] = useState('');
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [encGroups, setEncGroups] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ human?: any; json?: any; rainbow?: any } | null>(null);

  useEffect(() => {
    nodesApi.list().then((ns: any[]) => setPuppetNodes(ns.map((n) => n.certname))).catch(() => {});
    enc.listGroups().then(setEncGroups).catch(() => {});
  }, []);

  const handleRun = async () => {
    if (!command || !targets) return;
    setRunning(true); 
    setResults(null);
    
    try {
      // Fetch all three formats in parallel
      const [humanResult, jsonResult, rainbowResult] = await Promise.all([
        bolt.runCommand({ command, targets, format: 'human' }),
        bolt.runCommand({ command, targets, format: 'json' }),
        bolt.runCommand({ command, targets, format: 'rainbow' }),
      ]);
      
      setResults({
        human: humanResult,
        json: jsonResult,
        rainbow: rainbowResult,
      });
    } catch (e: any) {
      // If any request fails, store error in all formats
      const errorResult = { returncode: -1, output: '', error: e.message };
      setResults({
        human: errorResult,
        json: errorResult,
        rainbow: errorResult,
      });
    }
    setRunning(false);
  };

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Run an ad-hoc shell command across one or more targets via SSH.
      </Alert>
      <Card withBorder shadow="sm">
        <Stack>
          <TextInput label="Command" required value={command} onChange={(e) => setCommand(e.currentTarget.value)}
            placeholder="e.g. uptime, df -h, systemctl status puppet" />
          <Select label="Targets" required searchable
            data={[
              { group: 'Groups', items: [
                { value: 'all', label: '🌐 All nodes' },
                ...encGroups.map((g) => ({ value: g.name, label: `📁 ${g.name}` })),
              ]},
              { group: 'Nodes', items: puppetNodes.map((n) => ({ value: n, label: n })) },
            ]}
            value={targets} onChange={(v) => setTargets(v || '')}
            placeholder="Select a group or node" />
          <Button onClick={handleRun} loading={running} disabled={!command || !targets}
            leftSection={<IconPlayerPlay size={16} />} color="green">
            Run Command
          </Button>
        </Stack>
      </Card>
      <ResultPane results={results} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: RUN TASK
   ═══════════════════════════════════════════════════════════════ */
function RunTaskTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [encGroups, setEncGroups] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState('');
  const [targets, setTargets] = useState('');
  const [params, setParams] = useState<Array<{ key: string; val: string }>>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ human?: any; json?: any; rainbow?: any } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      bolt.getTasks().catch(() => ({ tasks: [] })),
      nodesApi.list().catch(() => []),
      enc.listGroups().catch(() => []),
    ]).then(([t, ns, g]) => {
      setTasks(t.tasks || []);
      setPuppetNodes((ns as any[]).map((n: any) => n.certname));
      setEncGroups(g as any[]);
      setLoading(false);
    });
  }, []);

  const handleRun = async () => {
    if (!selectedTask || !targets) return;
    setRunning(true); 
    setResults(null);
    
    const paramDict: Record<string, string> = {};
    params.forEach((p) => { if (p.key.trim()) paramDict[p.key.trim()] = p.val; });
    
    try {
      // Fetch all three formats in parallel
      const [humanResult, jsonResult, rainbowResult] = await Promise.all([
        bolt.runTask({ task: selectedTask, targets, params: paramDict, format: 'human' }),
        bolt.runTask({ task: selectedTask, targets, params: paramDict, format: 'json' }),
        bolt.runTask({ task: selectedTask, targets, params: paramDict, format: 'rainbow' }),
      ]);
      
      setResults({
        human: humanResult,
        json: jsonResult,
        rainbow: rainbowResult,
      });
    } catch (e: any) {
      // If any request fails, store error in all formats
      const errorResult = { returncode: -1, output: '', error: e.message };
      setResults({
        human: errorResult,
        json: errorResult,
        rainbow: errorResult,
      });
    }
    setRunning(false);
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Run a Bolt task — a pre-packaged script from your modules with defined parameters.
      </Alert>
      <Card withBorder shadow="sm">
        <Stack>
          <Select label="Task" required searchable
            data={tasks.map((t: any) => ({ value: t.name || t, label: t.name || t }))}
            value={selectedTask} onChange={(v) => setSelectedTask(v || '')}
            placeholder={tasks.length > 0 ? 'Select a task' : 'No tasks available'}
            nothingFoundMessage="No matching tasks" />
          <Select label="Targets" required searchable
            data={[
              { group: 'Groups', items: [
                { value: 'all', label: '🌐 All nodes' },
                ...encGroups.map((g) => ({ value: g.name, label: `📁 ${g.name}` })),
              ]},
              { group: 'Nodes', items: puppetNodes.map((n) => ({ value: n, label: n })) },
            ]}
            value={targets} onChange={(v) => setTargets(v || '')}
            placeholder="Select a group or node" />
          <div>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>Task Parameters</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => setParams([...params, { key: '', val: '' }])}>+ Add</Button>
            </Group>
            {params.map((p, i) => (
              <Group key={i} gap="xs" mb={4}>
                <TextInput size="xs" placeholder="Key" value={p.key} style={{ flex: 1 }}
                  onChange={(e) => { const u = [...params]; u[i] = { ...u[i], key: e.currentTarget.value }; setParams(u); }} />
                <TextInput size="xs" placeholder="Value" value={p.val} style={{ flex: 2 }}
                  onChange={(e) => { const u = [...params]; u[i] = { ...u[i], val: e.currentTarget.value }; setParams(u); }} />
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => setParams(params.filter((_, j) => j !== i))}>×</Button>
              </Group>
            ))}
          </div>
          <Button onClick={handleRun} loading={running} disabled={!selectedTask || !targets}
            leftSection={<IconPlayerPlay size={16} />} color="green">Run Task</Button>
        </Stack>
      </Card>
      <ResultPane results={results} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: RUN PLAN
   ═══════════════════════════════════════════════════════════════ */
function RunPlanTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [params, setParams] = useState<Array<{ key: string; val: string }>>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ human?: any; json?: any; rainbow?: any } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bolt.getPlans().then((p) => setPlans(p.plans || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleRun = async () => {
    if (!selectedPlan) return;
    setRunning(true); 
    setResults(null);
    
    const paramDict: Record<string, string> = {};
    params.forEach((p) => { if (p.key.trim()) paramDict[p.key.trim()] = p.val; });
    
    try {
      // Fetch all three formats in parallel
      const [humanResult, jsonResult, rainbowResult] = await Promise.all([
        bolt.runPlan({ plan: selectedPlan, params: paramDict, format: 'human' }),
        bolt.runPlan({ plan: selectedPlan, params: paramDict, format: 'json' }),
        bolt.runPlan({ plan: selectedPlan, params: paramDict, format: 'rainbow' }),
      ]);
      
      setResults({
        human: humanResult,
        json: jsonResult,
        rainbow: rainbowResult,
      });
    } catch (e: any) {
      // If any request fails, store error in all formats
      const errorResult = { returncode: -1, output: '', error: e.message };
      setResults({
        human: errorResult,
        json: errorResult,
        rainbow: errorResult,
      });
    }
    setRunning(false);
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Run a Bolt plan — a multi-step orchestrated workflow that can chain tasks, commands,
        and scripts together with logic.
      </Alert>
      <Card withBorder shadow="sm">
        <Stack>
          <Select label="Plan" required searchable
            data={plans.map((p: any) => ({ value: p.name || p, label: p.name || p }))}
            value={selectedPlan} onChange={(v) => setSelectedPlan(v || '')}
            placeholder={plans.length > 0 ? 'Select a plan' : 'No plans available'} />
          <div>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>Plan Parameters</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => setParams([...params, { key: '', val: '' }])}>+ Add</Button>
            </Group>
            {params.map((p, i) => (
              <Group key={i} gap="xs" mb={4}>
                <TextInput size="xs" placeholder="Key" value={p.key} style={{ flex: 1 }}
                  onChange={(e) => { const u = [...params]; u[i] = { ...u[i], key: e.currentTarget.value }; setParams(u); }} />
                <TextInput size="xs" placeholder="Value" value={p.val} style={{ flex: 2 }}
                  onChange={(e) => { const u = [...params]; u[i] = { ...u[i], val: e.currentTarget.value }; setParams(u); }} />
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => setParams(params.filter((_, j) => j !== i))}>×</Button>
              </Group>
            ))}
          </div>
          <Button onClick={handleRun} loading={running} disabled={!selectedPlan}
            leftSection={<IconPlayerPlay size={16} />} color="green">Run Plan</Button>
        </Stack>
      </Card>
      <ResultPane results={results} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5: EXECUTION HISTORY
   ═══════════════════════════════════════════════════════════════ */
function ExecutionHistoryTab() {
  return <ExecutionHistory />;
}

/* ═══════════════════════════════════════════════════════════════
   TAB 6: CONFIGURATION
   ═══════════════════════════════════════════════════════════════ */
function EditableConfigFile({ label, description, fileKey, path, content, placeholder, onSaved }: {
  label: string;
  description: string;
  fileKey: string;
  path: string | null;
  content: string | null;
  placeholder: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await bolt.saveConfig(fileKey, editContent);
      notifications.show({ title: `${label} Saved`, message: `${label} saved successfully`, color: 'green' });
      setEditing(false);
      onSaved();
    } catch (err: any) {
      let msg = err.message || 'Save failed';
      const jsonMatch = msg.match(/"detail"\s*:\s*"([^"]*)"/);
      if (jsonMatch) msg = jsonMatch[1];
      notifications.show({ title: 'Save Failed', message: msg, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(content || '');
    setEditing(false);
  };

  return (
    <Card withBorder shadow="sm">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={700}>{label}</Text>
          <Text size="xs" c="dimmed">{description}</Text>
        </div>
        {!editing ? (
          <Button variant="light" size="xs" onClick={() => { setEditContent(content || placeholder); setEditing(true); }}>
            Edit
          </Button>
        ) : (
          <Group gap="xs">
            <Button variant="subtle" size="xs" color="gray" onClick={handleCancel}>Cancel</Button>
            <Button size="xs" color="green" onClick={handleSave} loading={saving}>Save</Button>
          </Group>
        )}
      </Group>
      {path && (
        <Group gap="sm" mb="sm">
          <Text size="xs" c="dimmed">Path:</Text>
          <Code style={{ fontSize: 11 }}>{path}</Code>
        </Group>
      )}
      {editing ? (
        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.currentTarget.value)}
          autosize
          minRows={8}
          maxRows={24}
          styles={{ input: { fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace', fontSize: 12 } }}
        />
      ) : content ? (
        <ScrollArea style={{ maxHeight: 400 }}>
          <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {content}
          </Code>
        </ScrollArea>
      ) : (
        <Alert variant="light" color="yellow">
          <Text size="sm">No {label} found. Click Edit to create one.</Text>
        </Alert>
      )}
    </Card>
  );
}

function ConfigTab() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(() => {
    setLoading(true);
    bolt.getConfig().then(setCfg).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadConfig(); }, []);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Bolt configuration files control transport settings, inventory, and project defaults. Edit the YAML files directly and save.
      </Alert>

      <EditableConfigFile
        label="bolt-project.yaml"
        description="Project settings, module paths, and default options for Bolt operations."
        fileKey="config"
        path={cfg?.config?.path}
        content={cfg?.config?.content}
        onSaved={loadConfig}
        placeholder={`---\n# Bolt project configuration\nname: openvox\nmodulepath:\n  - /etc/puppetlabs/code/modules\n  - /etc/puppetlabs/code/environments/production/modules\n`}
      />

      <EditableConfigFile
        label="inventory.yaml"
        description="Target nodes, groups, connection settings (SSH/WinRM), and transport configuration."
        fileKey="inventory"
        path={cfg?.inventory?.path}
        content={cfg?.inventory?.content}
        onSaved={loadConfig}
        placeholder={`---\n# Bolt inventory\ngroups:\n  - name: local\n    targets:\n      - localhost\n    config:\n      transport: local\n  - name: webservers\n    targets:\n      - web01.example.com\n    config:\n      transport: ssh\n      ssh:\n        user: root\n        host-key-check: false\n`}
      />

      {/* Debug Log (read-only) */}
      {cfg?.debug_log?.content && (
        <Card withBorder shadow="sm">
          <Group justify="space-between" mb="xs">
            <div>
              <Text fw={700}>bolt-debug.log</Text>
              <Text size="xs" c="dimmed">Most recent Bolt debug output — useful for troubleshooting.</Text>
            </div>
            {cfg?.debug_log?.path && <Code style={{ fontSize: 11 }}>{cfg.debug_log.path}</Code>}
          </Group>
          <ScrollArea style={{ maxHeight: 300 }}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {cfg.debug_log.content}
            </Code>
          </ScrollArea>
        </Card>
      )}

      {/* Last Rerun (read-only) */}
      {cfg?.rerun?.content && (
        <Card withBorder shadow="sm">
          <Group justify="space-between" mb="xs">
            <div>
              <Text fw={700}>.rerun.json</Text>
              <Text size="xs" c="dimmed">Last Bolt command that was executed — used by <Code style={{ fontSize: 11 }}>bolt plan run --rerun</Code>.</Text>
            </div>
            {cfg?.rerun?.path && <Code style={{ fontSize: 11 }}>{cfg.rerun.path}</Code>}
          </Group>
          <ScrollArea style={{ maxHeight: 200 }}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {cfg.rerun.content}
            </Code>
          </ScrollArea>
        </Card>
      )}
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB: FILES (Upload / Download)
   ═══════════════════════════════════════════════════════════════ */
function FilesTab() {
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [encGroups, setEncGroups] = useState<any[]>([]);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTargets, setUploadTargets] = useState('');
  const [uploadDest, setUploadDest] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);

  // Script run state
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptTargets, setScriptTargets] = useState('');
  const [scriptArgs, setScriptArgs] = useState('');
  const [runningScript, setRunningScript] = useState(false);
  const [scriptResult, setScriptResult] = useState<any>(null);
  const [scriptDragActive, setScriptDragActive] = useState(false);

  // Download state
  const [downloadSource, setDownloadSource] = useState('');
  const [downloadDest, setDownloadDest] = useState('/opt/openvox-gui/data/bolt-downloads');
  const [downloadTargets, setDownloadTargets] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<any>(null);

  useEffect(() => {
    nodesApi.list().then((ns: any[]) => setPuppetNodes(ns.map((n) => n.certname))).catch(() => {});
    enc.listGroups().then(setEncGroups).catch(() => {});
  }, []);

  const targetSelectData = [
    { group: 'Groups', items: [
      { value: 'all', label: '🌐 All nodes' },
      ...encGroups.map((g) => ({ value: g.name, label: `📁 ${g.name}` })),
    ]},
    { group: 'Nodes', items: puppetNodes.map((n) => ({ value: n, label: n })) },
  ];

  // ─── Upload handlers ─────────────────────────────────────
  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) setUploadFile(files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadTargets || !uploadDest) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await bolt.uploadFile(uploadFile, uploadTargets, uploadDest);
      setUploadResult(result);
      if (result.success) {
        notifications.show({ title: 'Upload Complete', message: `${uploadFile.name} uploaded to ${uploadTargets}`, color: 'green' });
      } else {
        notifications.show({ title: 'Upload Failed', message: `Exit code ${result.returncode}`, color: 'red' });
      }
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setUploadResult({ success: false, error: e.message });
    }
    setUploading(false);
  };

  // ─── Download handler ────────────────────────────────────
  const handleDownload = async () => {
    if (!downloadSource || !downloadTargets || !downloadDest) return;
    setDownloading(true);
    setDownloadResult(null);
    try {
      const result = await bolt.downloadFile({
        source: downloadSource, destination: downloadDest, targets: downloadTargets,
      });
      setDownloadResult(result);
      if (result.success) {
        notifications.show({ title: 'Download Complete', message: `${result.files?.length || 0} file(s) retrieved`, color: 'green' });
      } else {
        notifications.show({ title: 'Download Failed', message: `Exit code ${result.returncode}`, color: 'red' });
      }
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setDownloadResult({ success: false, error: e.message });
    }
    setDownloading(false);
  };

  // ─── Script run handler ───────────────────────────────
  const handleScriptRun = async () => {
    if (!scriptFile || !scriptTargets) return;
    setRunningScript(true);
    setScriptResult(null);
    try {
      const result = await bolt.runScript(scriptFile, scriptTargets, scriptArgs);
      setScriptResult(result);
      if (result.success) {
        notifications.show({ title: 'Script Complete', message: `${scriptFile.name} executed on ${scriptTargets}`, color: 'green' });
      } else {
        notifications.show({ title: 'Script Failed', message: `Exit code ${result.returncode}`, color: 'red' });
      }
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setScriptResult({ success: false, error: e.message });
    }
    setRunningScript(false);
  };

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Transfer files and execute scripts on managed nodes using Puppet Bolt.
        Upload pushes files, Download retrieves files, and Run Script uploads
        and executes a script in one step.
      </Alert>

      <Grid>
        {/* ── Upload Panel ─────────────────────────────────── */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="md" h="100%">
            <Group mb="md">
              <ThemeIcon size="lg" variant="light" color="green"><IconFileUpload size={20} /></ThemeIcon>
              <div>
                <Text fw={700}>Upload File to Targets</Text>
                <Text size="xs" c="dimmed">Push a file from your browser to remote nodes</Text>
              </div>
            </Group>
            <Stack>
              {/* Drag & drop zone */}
              <Box
                onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragActive ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-gray-5)'}`,
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                  backgroundColor: dragActive ? 'var(--mantine-color-green-0)' : 'transparent',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                }}
                onClick={() => document.getElementById('file-upload-input')?.click()}
              >
                <input
                  id="file-upload-input"
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
                <IconUpload size={32} color="var(--mantine-color-dimmed)" style={{ marginBottom: 8 }} />
                {uploadFile ? (
                  <Group justify="center" gap="xs">
                    <Badge color="green" size="lg">{uploadFile.name}</Badge>
                    <Text size="xs" c="dimmed">({(uploadFile.size / 1024).toFixed(1)} KB)</Text>
                    <Button variant="subtle" color="red" size="compact-xs"
                      onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}>
                      <IconX size={12} />
                    </Button>
                  </Group>
                ) : (
                  <>
                    <Text size="sm" c="dimmed">Drag a file here or click to browse</Text>
                    <Text size="xs" c="dimmed">Any file type, up to 100 MB</Text>
                  </>
                )}
              </Box>

              <Select label="Targets" required searchable data={targetSelectData}
                value={uploadTargets} onChange={(v) => setUploadTargets(v || '')}
                placeholder="Select group or node" />
              <TextInput label="Remote Destination Path" required
                value={uploadDest} onChange={(e) => setUploadDest(e.currentTarget.value)}
                placeholder="/tmp/myfile.conf or /etc/myapp/config.yaml" />
              <Button onClick={handleUpload} loading={uploading}
                disabled={!uploadFile || !uploadTargets || !uploadDest}
                leftSection={<IconFileUpload size={16} />} color="green">
                Upload File
              </Button>

              {uploadResult && (
                <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                  {uploadResult.output || uploadResult.error || 'No output'}
                </Code>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* ── Download Panel ───────────────────────────────── */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="md" h="100%">
            <Group mb="md">
              <ThemeIcon size="lg" variant="light" color="blue"><IconFileDownload size={20} /></ThemeIcon>
              <div>
                <Text fw={700}>Download File from Targets</Text>
                <Text size="xs" c="dimmed">Retrieve a file from remote nodes to this server</Text>
              </div>
            </Group>
            <Stack>
              <TextInput label="Remote Source Path" required
                value={downloadSource} onChange={(e) => setDownloadSource(e.currentTarget.value)}
                placeholder="/etc/hosts or /var/log/messages" />
              <Select label="Targets" required searchable data={targetSelectData}
                value={downloadTargets} onChange={(v) => setDownloadTargets(v || '')}
                placeholder="Select group or node" />
              <TextInput label="Local Destination Directory" required
                value={downloadDest} onChange={(e) => setDownloadDest(e.currentTarget.value)}
                placeholder="/opt/openvox-gui/data/bolt-downloads" />
              <Button onClick={handleDownload} loading={downloading}
                disabled={!downloadSource || !downloadTargets || !downloadDest}
                leftSection={<IconFileDownload size={16} />} color="blue">
                Download File
              </Button>

              {downloadResult && (
                <>
                  <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {downloadResult.output || downloadResult.error || 'No output'}
                  </Code>
                  {downloadResult.files && downloadResult.files.length > 0 && (
                    <Card withBorder padding="xs">
                      <Text size="sm" fw={600} mb="xs">Retrieved Files:</Text>
                      {downloadResult.files.map((f: any, i: number) => (
                        <Group key={i} gap="xs">
                          <Badge variant="outline" size="sm">{f.target}</Badge>
                          <Text size="xs" style={{ fontFamily: 'monospace' }}>{f.path}</Text>
                          <Text size="xs" c="dimmed">({(f.size / 1024).toFixed(1)} KB)</Text>
                        </Group>
                      ))}
                    </Card>
                  )}
                </>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── Run Script Panel (full width below) ──────────── */}
      <Card withBorder shadow="sm" padding="md">
        <Group mb="md">
          <ThemeIcon size="lg" variant="light" color="violet"><IconPlayerPlay size={20} /></ThemeIcon>
          <div>
            <Text fw={700}>Run Script on Targets</Text>
            <Text size="xs" c="dimmed">Upload a script and execute it on remote nodes in one step — Bolt copies, runs, and cleans up automatically</Text>
          </div>
        </Group>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack>
              <Box
                onDragOver={(e: React.DragEvent) => { e.preventDefault(); setScriptDragActive(true); }}
                onDragLeave={() => setScriptDragActive(false)}
                onDrop={(e: React.DragEvent) => { e.preventDefault(); setScriptDragActive(false); if (e.dataTransfer.files?.length) setScriptFile(e.dataTransfer.files[0]); }}
                style={{
                  border: `2px dashed ${scriptDragActive ? 'var(--mantine-color-violet-5)' : 'var(--mantine-color-gray-5)'}`,
                  borderRadius: 8, padding: 20, textAlign: 'center',
                  backgroundColor: scriptDragActive ? 'var(--mantine-color-violet-0)' : 'transparent',
                  transition: 'all 0.2s', cursor: 'pointer',
                }}
                onClick={() => document.getElementById('script-upload-input')?.click()}
              >
                <input id="script-upload-input" type="file" style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files?.length) setScriptFile(e.target.files[0]); }} />
                <IconUpload size={28} color="var(--mantine-color-dimmed)" style={{ marginBottom: 4 }} />
                {scriptFile ? (
                  <Group justify="center" gap="xs">
                    <Badge color="violet" size="lg">{scriptFile.name}</Badge>
                    <Text size="xs" c="dimmed">({(scriptFile.size / 1024).toFixed(1)} KB)</Text>
                    <Button variant="subtle" color="red" size="compact-xs"
                      onClick={(e) => { e.stopPropagation(); setScriptFile(null); }}><IconX size={12} /></Button>
                  </Group>
                ) : (
                  <Text size="sm" c="dimmed">Drag a script here or click to browse (.sh, .py, .rb, .ps1)</Text>
                )}
              </Box>
              <Select label="Targets" required searchable data={targetSelectData}
                value={scriptTargets} onChange={(v) => setScriptTargets(v || '')}
                placeholder="Select group or node" />
              <TextInput label="Script Arguments (optional)"
                value={scriptArgs} onChange={(e) => setScriptArgs(e.currentTarget.value)}
                placeholder="--flag1 value1 --flag2 value2" />
              <Button onClick={handleScriptRun} loading={runningScript}
                disabled={!scriptFile || !scriptTargets}
                leftSection={<IconPlayerPlay size={16} />} color="violet">
                Run Script
              </Button>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            {scriptResult ? (
              <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto' }}>
                {scriptResult.output || scriptResult.error || 'No output'}
              </Code>
            ) : (
              <Center h={200}><Text c="dimmed" size="sm">Script output will appear here</Text></Center>
            )}
          </Grid.Col>
        </Grid>
      </Card>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export function OrchestrationPage() {
  return (
    <Stack>
      <Title order={2}>Orchestration</Title>
      
      <Tabs defaultValue="overview" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconBolt size={16} />}>Overview</Tabs.Tab>
          <Tabs.Tab value="command" leftSection={<IconTerminal2 size={16} />}>Run Command</Tabs.Tab>
          <Tabs.Tab value="task" leftSection={<IconListDetails size={16} />}>Run Task</Tabs.Tab>
          <Tabs.Tab value="plan" leftSection={<IconRoute size={16} />}>Run Plan</Tabs.Tab>
          <Tabs.Tab value="files" leftSection={<IconFiles size={16} />}>Files</Tabs.Tab>
          <Tabs.Tab value="history" leftSection={<IconHistory size={16} />}>Execution History</Tabs.Tab>
          <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>Configuration</Tabs.Tab>
        </Tabs.List>
        
        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="command" pt="md"><RunCommandTab /></Tabs.Panel>
        <Tabs.Panel value="task" pt="md"><RunTaskTab /></Tabs.Panel>
        <Tabs.Panel value="plan" pt="md"><RunPlanTab /></Tabs.Panel>
        <Tabs.Panel value="files" pt="md"><FilesTab /></Tabs.Panel>
        <Tabs.Panel value="history" pt="md"><ExecutionHistoryTab /></Tabs.Panel>
        <Tabs.Panel value="config" pt="md"><ConfigTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
