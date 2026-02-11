import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, TextInput, Textarea, Select, Badge, Code, Grid, Divider,
  Paper, ThemeIcon, Box, SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconTerminal2, IconListDetails, IconRoute, IconSettings, IconPlayerPlay,
  IconBolt,
} from '@tabler/icons-react';
import { bolt, nodes as nodesApi } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import AnsiToHtml from 'ansi-to-html';

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
function ResultPane({ result, format }: { result: any; format: string }) {
  if (!result) return null;

  const outputHtml = useMemo(() => {
    if (!result.output) return '';
    if (format === 'rainbow') {
      return ansiConverter.toHtml(result.output);
    }
    return '';
  }, [result.output, format]);

  return (
    <Card withBorder shadow="sm">
      <Group mb="sm">
        <Text fw={700}>Result</Text>
        <Badge color={result.returncode === 0 ? 'green' : 'red'}>
          {result.returncode === 0 ? 'Success' : `Exit ${result.returncode}`}
        </Badge>
        <Badge variant="light" color="gray">{format} format</Badge>
      </Group>
      {result.output && (
        format === 'rainbow' ? (
          <Box
            style={{
              backgroundColor: '#1e1e1e',
              borderRadius: 6,
              padding: '12px 16px',
              maxHeight: 500,
              overflow: 'auto',
              fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: outputHtml }}
          />
        ) : (
          <Code block style={{ fontSize: 12, maxHeight: 500, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {result.output}
          </Code>
        )
      )}
      {result.error && (
        <Alert color="red" mt="sm">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{result.error}</Text>
        </Alert>
      )}
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
      <text x="260" y="294" textAnchor="middle" fill="#445566" fontSize="6" fontFamily="monospace">(powered by Puppet Bolt)</text>
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
              <Text fw={700} mb="sm">Puppet Bolt Status</Text>
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
                  <Text size="sm">Puppet Bolt is not installed on this server.</Text>
                  <Text size="xs" c="dimmed" mt="xs">
                    Install with: <Code>sudo yum install puppet-bolt</Code> or <Code>sudo apt install puppet-bolt</Code>
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
                  <Text size="sm">Agentless — no Puppet agent required on targets</Text>
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
  const [format, setFormat] = useState('human');
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    nodesApi.list().then((ns: any[]) => setPuppetNodes(ns.map((n) => n.certname))).catch(() => {});
  }, []);

  const handleRun = async () => {
    if (!command || !targets) return;
    setRunning(true); setResult(null);
    try {
      const r = await bolt.runCommand({ command, targets, format });
      setResult(r);
    } catch (e: any) {
      setResult({ returncode: -1, output: '', error: e.message });
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
          <Select label="Targets" required searchable data={[
            { value: 'all', label: 'All nodes' },
            ...puppetNodes.map((n) => ({ value: n, label: n })),
          ]} value={targets} onChange={(v) => setTargets(v || '')}
            placeholder="Select target nodes" />
          <div>
            <Text size="sm" fw={500} mb={4}>Output Format</Text>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              data={[
                { label: '📄 Human', value: 'human' },
                { label: '🔣 JSON', value: 'json' },
                { label: '🌈 Rainbow', value: 'rainbow' },
              ]}
              fullWidth
            />
          </div>
          <Button onClick={handleRun} loading={running} disabled={!command || !targets}
            leftSection={<IconPlayerPlay size={16} />} color="green">
            Run Command
          </Button>
        </Stack>
      </Card>
      <ResultPane result={result} format={format} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: RUN TASK
   ═══════════════════════════════════════════════════════════════ */
function RunTaskTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState('');
  const [targets, setTargets] = useState('');
  const [format, setFormat] = useState('human');
  const [params, setParams] = useState<Array<{ key: string; val: string }>>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      bolt.getTasks().catch(() => ({ tasks: [] })),
      nodesApi.list().catch(() => []),
    ]).then(([t, ns]) => {
      setTasks(t.tasks || []);
      setPuppetNodes((ns as any[]).map((n: any) => n.certname));
      setLoading(false);
    });
  }, []);

  const handleRun = async () => {
    if (!selectedTask || !targets) return;
    setRunning(true); setResult(null);
    const paramDict: Record<string, string> = {};
    params.forEach((p) => { if (p.key.trim()) paramDict[p.key.trim()] = p.val; });
    try {
      const r = await bolt.runTask({ task: selectedTask, targets, params: paramDict, format });
      setResult(r);
    } catch (e: any) {
      setResult({ returncode: -1, output: '', error: e.message });
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
          <Select label="Targets" required searchable data={[
            { value: 'all', label: 'All nodes' },
            ...puppetNodes.map((n) => ({ value: n, label: n })),
          ]} value={targets} onChange={(v) => setTargets(v || '')} />
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
          <div>
            <Text size="sm" fw={500} mb={4}>Output Format</Text>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              data={[
                { label: '📄 Human', value: 'human' },
                { label: '🔣 JSON', value: 'json' },
                { label: '🌈 Rainbow', value: 'rainbow' },
              ]}
              fullWidth
            />
          </div>
          <Button onClick={handleRun} loading={running} disabled={!selectedTask || !targets}
            leftSection={<IconPlayerPlay size={16} />} color="green">Run Task</Button>
        </Stack>
      </Card>
      <ResultPane result={result} format={format} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: RUN PLAN
   ═══════════════════════════════════════════════════════════════ */
function RunPlanTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [format, setFormat] = useState('human');
  const [params, setParams] = useState<Array<{ key: string; val: string }>>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bolt.getPlans().then((p) => setPlans(p.plans || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleRun = async () => {
    if (!selectedPlan) return;
    setRunning(true); setResult(null);
    const paramDict: Record<string, string> = {};
    params.forEach((p) => { if (p.key.trim()) paramDict[p.key.trim()] = p.val; });
    try {
      const r = await bolt.runPlan({ plan: selectedPlan, params: paramDict, format });
      setResult(r);
    } catch (e: any) {
      setResult({ returncode: -1, output: '', error: e.message });
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
          <div>
            <Text size="sm" fw={500} mb={4}>Output Format</Text>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              data={[
                { label: '📄 Human', value: 'human' },
                { label: '🔣 JSON', value: 'json' },
                { label: '🌈 Rainbow', value: 'rainbow' },
              ]}
              fullWidth
            />
          </div>
          <Button onClick={handleRun} loading={running} disabled={!selectedPlan}
            leftSection={<IconPlayerPlay size={16} />} color="green">Run Plan</Button>
        </Stack>
      </Card>
      <ResultPane result={result} format={format} />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5: CONFIGURATION
   ═══════════════════════════════════════════════════════════════ */
function ConfigTab() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bolt.getConfig().then(setCfg).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Bolt configuration files control transport settings, inventory, and project defaults.
      </Alert>

      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">bolt-project.yaml</Text>
        {cfg?.config?.path ? (
          <>
            <Group gap="sm" mb="sm">
              <Text size="sm" c="dimmed">Path:</Text>
              <Code>{cfg.config.path}</Code>
            </Group>
            <Code block style={{ fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
              {cfg.config.content || '(empty)'}
            </Code>
          </>
        ) : (
          <Alert variant="light" color="yellow">
            <Text size="sm">No bolt-project.yaml found.</Text>
            <Text size="xs" c="dimmed" mt="xs">
              Create one at <Code>/etc/puppetlabs/bolt/bolt-project.yaml</Code> or
              <Code>~/.puppetlabs/bolt/bolt-project.yaml</Code>
            </Text>
          </Alert>
        )}
      </Card>

      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">inventory.yaml</Text>
        {cfg?.inventory?.path ? (
          <>
            <Group gap="sm" mb="sm">
              <Text size="sm" c="dimmed">Path:</Text>
              <Code>{cfg.inventory.path}</Code>
            </Group>
            <Code block style={{ fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
              {cfg.inventory.content || '(empty)'}
            </Code>
          </>
        ) : (
          <Alert variant="light" color="yellow">
            <Text size="sm">No inventory.yaml found.</Text>
            <Text size="xs" c="dimmed" mt="xs">
              Create one to define your target nodes and connection settings.
            </Text>
            <Code block mt="xs" style={{ fontSize: 11 }}>
{`# Example inventory.yaml
groups:
  - name: webservers
    targets:
      - web01.example.com
      - web02.example.com
    config:
      transport: ssh
      ssh:
        user: root
        host-key-check: false
  - name: databases
    targets:
      - db01.example.com`}
            </Code>
          </Alert>
        )}
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
          <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>Configuration</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="command" pt="md"><RunCommandTab /></Tabs.Panel>
        <Tabs.Panel value="task" pt="md"><RunTaskTab /></Tabs.Panel>
        <Tabs.Panel value="plan" pt="md"><RunPlanTab /></Tabs.Panel>
        <Tabs.Panel value="config" pt="md"><ConfigTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
