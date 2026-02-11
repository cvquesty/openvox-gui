import { useState, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Button, Select, Alert, Table,
  Loader, Center, Code, Paper, ThemeIcon, Grid,
  ScrollArea, Divider,
} from '@mantine/core';
import {
  IconRocket, IconCheck, IconX, IconPlayerPlay, IconRefresh,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { deploy, config } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';

/* ── Giant Robot vs City – inline SVG comic ──────────────── */
function RobotComic({ attacking }: { attacking: boolean }) {
  return (
    <svg viewBox="0 0 400 360" width="100%" height="100%" style={{ maxHeight: 420 }}>
      {/* Sky gradient */}
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#2d3250" />
        </linearGradient>
        <linearGradient id="sky-attack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1520" />
          <stop offset="100%" stopColor="#3d2230" />
        </linearGradient>
        <radialGradient id="explosion">
          <stop offset="0%" stopColor="#ffdd44" />
          <stop offset="50%" stopColor="#ff6622" />
          <stop offset="100%" stopColor="#ff4444" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="360" fill={attacking ? "url(#sky-attack)" : "url(#sky)"} rx="8" />

      {/* Stars */}
      <circle cx="30" cy="25" r="1.5" fill="#ffffff" opacity="0.7" />
      <circle cx="90" cy="15" r="1" fill="#ffffff" opacity="0.5" />
      <circle cx="150" cy="35" r="1.5" fill="#ffffff" opacity="0.6" />
      <circle cx="250" cy="20" r="1" fill="#ffffff" opacity="0.8" />
      <circle cx="320" cy="30" r="1.5" fill="#ffffff" opacity="0.5" />
      <circle cx="370" cy="12" r="1" fill="#ffffff" opacity="0.7" />
      <circle cx="55" cy="50" r="1" fill="#ffffff" opacity="0.4" />
      <circle cx="200" cy="10" r="1" fill="#ffffff" opacity="0.6" />

      {/* Moon */}
      <circle cx="340" cy="55" r="22" fill="#e8e8e0" opacity={attacking ? 0.4 : 0.8} />
      <circle cx="332" cy="50" r="4" fill="#d0d0c8" opacity="0.5" />
      <circle cx="348" cy="60" r="3" fill="#d0d0c8" opacity="0.4" />
      <circle cx="340" cy="45" r="2" fill="#d0d0c8" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="280" width="400" height="80" fill="#1a1a2e" rx="0" />
      <rect x="0" y="280" width="400" height="3" fill="#333355" />

      {/* ── City buildings ── */}
      {/* Building 1 */}
      <rect x="220" y="220" width="28" height="60" fill="#2a2a4a" stroke="#444477" strokeWidth="0.5" />
      <rect x="224" y="226" width="4" height="4" fill="#ffee88" opacity="0.8" />
      <rect x="232" y="226" width="4" height="4" fill="#ffee88" opacity="0.6" />
      <rect x="240" y="226" width="4" height="4" fill="#ffee88" opacity="0.7" />
      <rect x="224" y="234" width="4" height="4" fill="#ffee88" opacity="0.5" />
      <rect x="240" y="234" width="4" height="4" fill="#ffee88" opacity="0.8" />
      <rect x="224" y="242" width="4" height="4" fill="#ffee88" opacity="0.6" />
      <rect x="232" y="242" width="4" height="4" fill="#ffee88" opacity="0.7" />
      <rect x="224" y="250" width="4" height="4" fill="#ffee88" opacity="0.4" />
      <rect x="240" y="250" width="4" height="4" fill="#ffee88" opacity="0.6" />

      {/* Building 2 - tall thin */}
      <rect x="255" y="200" width="20" height="80" fill="#252545" stroke="#444477" strokeWidth="0.5" />
      <rect x="259" y="206" width="3" height="3" fill="#ffee88" opacity="0.7" />
      <rect x="267" y="206" width="3" height="3" fill="#ffee88" opacity="0.5" />
      <rect x="259" y="214" width="3" height="3" fill="#ffee88" opacity="0.6" />
      <rect x="259" y="222" width="3" height="3" fill="#ffee88" opacity="0.8" />
      <rect x="267" y="222" width="3" height="3" fill="#ffee88" opacity="0.4" />
      <rect x="259" y="238" width="3" height="3" fill="#ffee88" opacity="0.5" />
      <rect x="267" y="238" width="3" height="3" fill="#ffee88" opacity="0.7" />

      {/* Building 3 - wide short */}
      <rect x="280" y="245" width="35" height="35" fill="#2e2e50" stroke="#444477" strokeWidth="0.5" />
      <rect x="284" y="250" width="4" height="4" fill="#ffee88" opacity="0.7" />
      <rect x="292" y="250" width="4" height="4" fill="#ffee88" opacity="0.5" />
      <rect x="300" y="250" width="4" height="4" fill="#ffee88" opacity="0.8" />
      <rect x="284" y="258" width="4" height="4" fill="#ffee88" opacity="0.6" />
      <rect x="300" y="258" width="4" height="4" fill="#ffee88" opacity="0.4" />
      <rect x="292" y="266" width="4" height="4" fill="#ffee88" opacity="0.7" />

      {/* Building 4 */}
      <rect x="322" y="230" width="24" height="50" fill="#282848" stroke="#444477" strokeWidth="0.5" />
      <rect x="326" y="236" width="3" height="3" fill="#ffee88" opacity="0.6" />
      <rect x="338" y="236" width="3" height="3" fill="#ffee88" opacity="0.8" />
      <rect x="326" y="244" width="3" height="3" fill="#ffee88" opacity="0.5" />
      <rect x="338" y="252" width="3" height="3" fill="#ffee88" opacity="0.7" />

      {/* Building 5 */}
      <rect x="352" y="255" width="22" height="25" fill="#2c2c4c" stroke="#444477" strokeWidth="0.5" />
      <rect x="356" y="260" width="3" height="3" fill="#ffee88" opacity="0.7" />
      <rect x="364" y="260" width="3" height="3" fill="#ffee88" opacity="0.5" />

      {/* ── GIANT ROBOT ── */}
      {/* Robot legs */}
      <rect x="80" y="250" width="18" height="30" fill="#556677" rx="2" />
      <rect x="110" y="250" width="18" height="30" fill="#556677" rx="2" />
      <rect x="74" y="274" width="28" height="8" fill="#445566" rx="2" />
      <rect x="106" y="274" width="28" height="8" fill="#445566" rx="2" />
      <circle cx="89" cy="252" r="5" fill="#667788" />
      <circle cx="119" cy="252" r="5" fill="#667788" />

      {/* Robot torso */}
      <rect x="70" y="175" width="68" height="80" fill="#667788" rx="4" stroke="#7788aa" strokeWidth="1" />
      <rect x="82" y="185" width="44" height="30" fill="#556677" rx="3" />
      <circle cx="104" cy="200" r="10" fill="#112233" stroke="#44aaff" strokeWidth="2" />
      <circle cx="104" cy="200" r="5" fill="#44aaff" opacity="0.8">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="78" cy="183" r="2" fill="#7788aa" />
      <circle cx="130" cy="183" r="2" fill="#7788aa" />
      <circle cx="78" cy="248" r="2" fill="#7788aa" />
      <circle cx="130" cy="248" r="2" fill="#7788aa" />

      {/* Robot left arm — raised when attacking, lowered when idle */}
      {attacking ? (
        <>
          <rect x="138" y="178" width="55" height="14" fill="#556677" rx="3" transform="rotate(-25, 138, 185)" />
          <circle cx="140" cy="185" r="7" fill="#667788" stroke="#7788aa" strokeWidth="1" />
          <rect x="183" y="158" width="16" height="20" fill="#445566" rx="3" />
          <rect x="186" y="150" width="10" height="12" fill="#334455" rx="2" />

          {/* Laser beam */}
          <line x1="191" y1="150" x2="270" y2="220" stroke="#ff4444" strokeWidth="3" opacity="0.9">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="0.3s" repeatCount="indefinite" />
          </line>
          <line x1="191" y1="150" x2="272" y2="218" stroke="#ff8844" strokeWidth="1.5" opacity="0.5" />

          {/* Explosion */}
          <circle cx="270" cy="220" r="18" fill="url(#explosion)" opacity="0.9">
            <animate attributeName="r" values="14;20;14" dur="0.5s" repeatCount="indefinite" />
          </circle>

          {/* Smoke */}
          <circle cx="265" cy="210" r="6" fill="#888888" opacity="0.4">
            <animate attributeName="cy" values="210;190;170" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.1;0" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="278" cy="215" r="4" fill="#888888" opacity="0.3">
            <animate attributeName="cy" values="215;195;175" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.1;0" dur="2.5s" repeatCount="indefinite" />
          </circle>

          {/* Falling debris */}
          <rect x="260" y="225" width="4" height="4" fill="#3a3a5a" transform="rotate(30,262,227)">
            <animate attributeName="y" values="225;280" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0" dur="1.5s" repeatCount="indefinite" />
          </rect>
          <rect x="275" y="222" width="3" height="3" fill="#3a3a5a" transform="rotate(45,276,223)">
            <animate attributeName="y" values="222;280" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0" dur="1.8s" repeatCount="indefinite" />
          </rect>
        </>
      ) : (
        <>
          {/* Arm lowered at rest */}
          <rect x="138" y="192" width="40" height="14" fill="#556677" rx="3" />
          <circle cx="140" cy="199" r="7" fill="#667788" stroke="#7788aa" strokeWidth="1" />
          <rect x="172" y="189" width="14" height="18" fill="#445566" rx="3" />
        </>
      )}

      {/* Robot right arm (always lowered) */}
      <rect x="20" y="190" width="52" height="14" fill="#556677" rx="3" />
      <circle cx="68" cy="197" r="7" fill="#667788" stroke="#7788aa" strokeWidth="1" />
      <rect x="12" y="187" width="14" height="18" fill="#445566" rx="3" />

      {/* Robot head */}
      <rect x="82" y="145" width="44" height="34" fill="#778899" rx="4" stroke="#8899bb" strokeWidth="1" />
      {/* Eyes — red when attacking, amber when idle */}
      {attacking ? (
        <>
          <rect x="90" y="154" width="10" height="6" fill="#ff3333" rx="1">
            <animate attributeName="fill" values="#ff3333;#ff6666;#ff3333" dur="0.4s" repeatCount="indefinite" />
          </rect>
          <rect x="108" y="154" width="10" height="6" fill="#ff3333" rx="1">
            <animate attributeName="fill" values="#ff3333;#ff6666;#ff3333" dur="0.4s" repeatCount="indefinite" />
          </rect>
        </>
      ) : (
        <>
          <rect x="90" y="154" width="10" height="6" fill="#ddaa33" rx="1">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
          </rect>
          <rect x="108" y="154" width="10" height="6" fill="#ddaa33" rx="1">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
          </rect>
        </>
      )}
      {/* Antenna */}
      <line x1="104" y1="145" x2="104" y2="130" stroke="#8899bb" strokeWidth="2" />
      <circle cx="104" cy="128" r="3" fill={attacking ? "#ff4444" : "#44aaff"}>
        <animate attributeName="fill" values={attacking ? "#ff4444;#ff8888;#ff4444" : "#44aaff;#88ccff;#44aaff"} dur={attacking ? "0.5s" : "2s"} repeatCount="indefinite" />
      </circle>
      {/* Jaw */}
      <rect x="90" y="165" width="28" height="6" fill="#667788" rx="1" />
      <rect x="93" y="166" width="3" height="4" fill="#556677" />
      <rect x="99" y="166" width="3" height="4" fill="#556677" />
      <rect x="105" y="166" width="3" height="4" fill="#556677" />
      <rect x="111" y="166" width="3" height="4" fill="#556677" />

      {/* Ground cracks */}
      <line x1="74" y1="282" x2="60" y2="290" stroke="#444466" strokeWidth="1" />
      <line x1="134" y1="282" x2="145" y2="295" stroke="#444466" strokeWidth="1" />
      <line x1="90" y1="282" x2="85" y2="300" stroke="#444466" strokeWidth="0.5" />

      {/* Caption */}
      {attacking ? (
        <>
          <text x="200" y="330" textAnchor="middle" fill="#ff6644" fontSize="11" fontFamily="monospace" fontWeight="bold">
            r10k deployment in progress...
          </text>
          <text x="200" y="348" textAnchor="middle" fill="#884433" fontSize="9" fontFamily="monospace">
            destroying legacy environments since 2014
          </text>
        </>
      ) : (
        <>
          <text x="200" y="330" textAnchor="middle" fill="#8899aa" fontSize="13" fontFamily="monospace" fontWeight="bold">
            impending doom
          </text>
          <text x="200" y="348" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">
            awaiting deployment orders...
          </text>
        </>
      )}
    </svg>
  );
}

export function CodeDeploymentPage() {
  const { isFormal } = useAppTheme();
  const { data: envsData, loading: envsLoading } = useApi(() => deploy.getEnvironments());
  const { data: statusData, loading: statusLoading, refetch: refetchStatus } = useApi(() => deploy.getStatus());

  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [outputLog, setOutputLog] = useState<string[]>([]);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [lastSuccess, setLastSuccess] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Services
  const { data: services, refetch: refetchServices } = useApi(config.getServices);
  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (service: string) => {
    setRestarting(service);
    try {
      await config.restartService(service);
      setTimeout(() => { refetchServices(); setRestarting(null); }, 3000);
    } catch (e: any) {
      alert(e.message);
      setRestarting(null);
    }
  };

  const environments = envsData?.environments || [];

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployError(null);
    setLastExitCode(null);
    setLastSuccess(null);

    const timestamp = new Date().toLocaleString();
    const env = selectedEnv || 'all';
    setOutputLog((prev) => [
      ...prev,
      '',
      `═══════════════════════════════════════════════════════`,
      `  Deploy started: ${timestamp}`,
      `  Environment: ${env}`,
      `═══════════════════════════════════════════════════════`,
      '',
    ]);

    try {
      const result = await deploy.run(selectedEnv || undefined);
      const lines = result.output || [];
      setOutputLog((prev) => [
        ...prev,
        ...lines,
        '',
        `── Exit code: ${result.exit_code} (${result.success ? 'SUCCESS' : 'FAILED'}) ──`,
        '',
      ]);
      setLastExitCode(result.exit_code);
      setLastSuccess(result.success);
      refetchStatus();
    } catch (e: any) {
      const errMsg = e.message || 'Deployment failed';
      setDeployError(errMsg);
      setOutputLog((prev) => [...prev, `ERROR: ${errMsg}`, '']);
    } finally {
      setDeploying(false);
      // Scroll to bottom after output updates
      setTimeout(() => {
        if (scrollRef.current) {
          const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') ||
                           scrollRef.current.querySelector('.mantine-ScrollArea-viewport');
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
        }
      }, 100);
    }
  };

  if (envsLoading) {
    return <Center h={400}><Loader size="xl" /></Center>;
  }

  return (
    <Stack>
      <Group>
        <ThemeIcon size="xl" color="#EC8622">
          <IconRocket size={24} />
        </ThemeIcon>
        <Title order={2}>Code Deployment</Title>
      </Group>

      <Grid>
        {/* Left half: Deploy controls + Services */}
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 6 }}>
          <Stack>
            <Card withBorder shadow="sm" padding="md">
              <Title order={4} mb="sm">Deploy with r10k</Title>
              <Group align="end">
                <Select
                  label="Environment"
                  placeholder="All environments"
                  data={[
                    { value: '', label: '\u2014 All Environments \u2014' },
                    ...environments.map((e: string) => ({ value: e, label: e })),
                  ]}
                  value={selectedEnv}
                  onChange={setSelectedEnv}
                  clearable
                  style={{ flex: 1 }}
                />
                <Button
                  leftSection={deploying ? <Loader size={16} color="white" /> : <IconPlayerPlay size={16} />}
                  color="#EC8622"
                  onClick={handleDeploy}
                  disabled={deploying}
                  loading={deploying}
                >
                  {deploying ? 'Deploying...' : 'Deploy Now'}
                </Button>
              </Group>

              {!statusLoading && statusData?.last_commit && statusData.last_commit !== 'unknown' && (
                <Text size="xs" c="dimmed" mt="sm">
                  Last production commit: {statusData.last_commit}
                </Text>
              )}
            </Card>

            {/* Services */}
            <Card withBorder shadow="sm" padding="md">
              <Title order={4} mb="sm">Services</Title>
              <Stack gap="xs">
                {services?.map((svc: any) => (
                  <Card key={svc.service} withBorder shadow="sm" padding="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <div>
                        <Text fw={600} size="sm">{svc.service}</Text>
                        <Group gap="xs" mt={4}>
                          <StatusBadge status={svc.status} />
                          {svc.pid && <Text size="xs" c="dimmed">PID {svc.pid}</Text>}
                        </Group>
                      </div>
                      <Button variant="outline" color="orange" size="xs"
                        leftSection={<IconRefresh size={14} />}
                        loading={restarting === svc.service}
                        onClick={() => handleRestart(svc.service)}>
                        Restart
                      </Button>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        {/* Right half: Robot comic (casual only) */}
        {!isFormal && (
          <Grid.Col span={{ base: 12, md: isFormal ? 12 : 6 }}>
            <Card withBorder shadow="sm" padding="sm" h="100%" style={{ overflow: 'hidden' }}>
              <RobotComic attacking={deploying} />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {/* Deploy error */}
      {deployError && (
        <Alert color="red" title="Deployment Error" icon={<IconX size={18} />}
          withCloseButton onClose={() => setDeployError(null)}>
          {deployError}
        </Alert>
      )}

      {/* Output window — always visible, full scrollback */}
      <Card withBorder shadow="sm" padding="lg">
        <Group mb="md" justify="space-between">
          <Title order={4}>Output</Title>
          <Group gap="sm">
            {lastSuccess !== null && (
              <Badge color={lastSuccess ? 'green' : 'red'} size="lg">
                {lastSuccess ? 'Success' : 'Failed'} (exit {lastExitCode})
              </Badge>
            )}
            {outputLog.length > 0 && (
              <Button variant="subtle" size="xs" color="gray"
                onClick={() => { setOutputLog([]); setLastExitCode(null); setLastSuccess(null); }}>
                Clear
              </Button>
            )}
          </Group>
        </Group>
        <Paper withBorder p="sm" bg="dark.8" radius="md" style={{ minHeight: 400 }}>
          <ScrollArea style={{ height: 400 }} ref={scrollRef}>
            {outputLog.length > 0 ? (
              <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {outputLog.join('\n')}
              </Code>
            ) : (
              <Text c="dimmed" size="sm" ta="center" py="xl">
                {deploying ? 'Deploying... please wait' : 'No deployment output yet. Click "Deploy Now" to run r10k.'}
              </Text>
            )}
          </ScrollArea>
        </Paper>
      </Card>
      {/* Deploy History */}
      <Divider my="md" />
      <DeployHistory />
    </Stack>
  );
}

function DeployHistory() {
  const { data: historyData } = useApi(() => deploy.getHistory());
  const history = historyData?.history || [];
  
  if (history.length === 0) return null;

  return (
    <Card withBorder shadow="sm" padding="md">
      <Title order={4} mb="sm">Deployment History</Title>
      <ScrollArea style={{ maxHeight: 300 }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Result</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.map((h: any, i: number) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Text size="sm">{h.timestamp ? new Date(h.timestamp).toLocaleString() : '—'}</Text>
                </Table.Td>
                <Table.Td><Badge variant="outline" size="sm">{h.environment || 'all'}</Badge></Table.Td>
                <Table.Td><Text size="sm">{h.triggered_by || '—'}</Text></Table.Td>
                <Table.Td>
                  <Badge color={h.success ? 'green' : 'red'} size="sm">
                    {h.success ? 'Success' : 'Failed'} (exit {h.exit_code})
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}
