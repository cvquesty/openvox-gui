import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Badge,
  Table, Tabs, Grid, Code, Paper, Button,
} from '@mantine/core';
import { IconServer, IconFileReport, IconList, IconCode, IconPlayerPlay } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PrettyJson } from '../components/PrettyJson';
import { bolt } from '../services/api';
import { notifications } from '@mantine/notifications';
import { useAppTheme } from '../hooks/ThemeContext';

/* ═══════════════════════════════════════════════════════════════
   INSPECT-O-BOT 2000 — the node inspection robot
   ═══════════════════════════════════════════════════════════════ */
function InspectOBot() {
  return (
    <svg viewBox="0 0 200 220" width="100%" style={{ maxHeight: 240 }}>
      <defs>
        <linearGradient id="ib-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="200" height="220" fill="url(#ib-sky)" rx="8" />

      {/* Stars */}
      <circle cx="20" cy="12" r="0.8" fill="#fff" opacity="0.4" />
      <circle cx="80" cy="18" r="0.6" fill="#fff" opacity="0.3" />
      <circle cx="150" cy="10" r="0.9" fill="#fff" opacity="0.5" />
      <circle cx="180" cy="25" r="0.7" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="185" width="200" height="35" fill="#1a1a2e" />
      <rect x="0" y="185" width="200" height="2" fill="#333355" />

      {/* Robot body */}
      <rect x="70" y="100" width="60" height="70" fill="#556677" rx="5" stroke="#778899" strokeWidth="1.5" />

      {/* Robot head */}
      <rect x="78" y="62" width="44" height="36" fill="#667788" rx="4" stroke="#8899bb" strokeWidth="1" />
      {/* Eyes — friendly amber */}
      <rect x="86" y="72" width="9" height="6" fill="#ddaa33" rx="1">
        <animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite" />
      </rect>
      <rect x="105" y="72" width="9" height="6" fill="#ddaa33" rx="1">
        <animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite" />
      </rect>
      {/* Mouth — happy arc */}
      <path d="M90,86 Q100,92 110,86" fill="none" stroke="#aabbcc" strokeWidth="1.5" />

      {/* Antenna */}
      <line x1="100" y1="62" x2="100" y2="45" stroke="#8899bb" strokeWidth="2" />
      <circle cx="100" cy="42" r="4" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="100" cy="42" r="8" fill="none" stroke="#44aaff" strokeWidth="0.8" opacity="0.4">
        <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Chest display */}
      <rect x="80" y="110" width="40" height="25" fill="#0a1628" rx="2" stroke="#334466" strokeWidth="0.5" />
      <text x="100" y="120" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">STATUS</text>
      <text x="100" y="128" textAnchor="middle" fill="#44aaff" fontSize="4" fontFamily="monospace">SCANNING...</text>
      <rect x="85" y="131" width="30" height="2" fill="#334455" rx="1" />
      <rect x="85" y="131" width="18" height="2" fill="#44ff44" rx="1">
        <animate attributeName="width" values="5;30;5" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Arms */}
      {/* Left arm holding magnifying glass */}
      <rect x="40" y="108" width="30" height="10" fill="#445566" rx="3" />
      <circle cx="70" cy="113" r="5" fill="#556677" stroke="#667788" strokeWidth="1" />
      {/* Magnifying glass */}
      <circle cx="30" cy="100" r="12" fill="none" stroke="#88aacc" strokeWidth="2" />
      <circle cx="30" cy="100" r="9" fill="#0a1628" opacity="0.4" />
      <line x1="39" y1="109" x2="45" y2="113" stroke="#88aacc" strokeWidth="2.5" strokeLinecap="round" />
      {/* Lens glint */}
      <circle cx="30" cy="100" r="6" fill="none" stroke="#44aaff" strokeWidth="0.5" opacity="0.5">
        <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Right arm with clipboard */}
      <rect x="130" y="108" width="30" height="10" fill="#445566" rx="3" />
      <circle cx="130" cy="113" r="5" fill="#556677" stroke="#667788" strokeWidth="1" />
      <rect x="155" y="95" width="22" height="30" fill="#ddd8cc" rx="2" stroke="#bbaa88" strokeWidth="0.5" />
      <text x="166" y="105" textAnchor="middle" fill="#776655" fontSize="4" fontFamily="monospace">{"\u2713"} os</text>
      <text x="166" y="111" textAnchor="middle" fill="#776655" fontSize="4" fontFamily="monospace">{"\u2713"} mem</text>
      <text x="166" y="117" textAnchor="middle" fill="#776655" fontSize="4" fontFamily="monospace">{"\u2713"} cpu</text>
      <text x="166" y="123" textAnchor="middle" fill="#776655" fontSize="4" fontFamily="monospace">_ net</text>

      {/* Legs */}
      <rect x="78" y="170" width="14" height="18" fill="#445566" rx="2" />
      <rect x="108" y="170" width="14" height="18" fill="#445566" rx="2" />
      <rect x="74" y="185" width="22" height="5" fill="#334455" rx="2" />
      <rect x="104" y="185" width="22" height="5" fill="#334455" rx="2" />

      {/* Label */}
      <rect x="50" y="192" width="100" height="10" fill="#334455" rx="2" />
      <text x="100" y="200" textAnchor="middle" fill="#EC8622" fontSize="5" fontFamily="monospace" fontWeight="bold">INSPECT-O-BOT 2000</text>

      {/* Caption */}
      <text x="100" y="213" textAnchor="middle" fill="#556677" fontSize="6" fontFamily="monospace">thorough inspections</text>
    </svg>
  );
}

export function NodeDetailPage() {
  const { isFormal } = useAppTheme();
  const { certname } = useParams<{ certname: string }>();
  const navigate = useNavigate();
  const { data: node, loading, error } = useApi(() => nodes.get(certname!), [certname]);
  const { data: reportList } = useApi(() => nodes.getReports(certname!, 10), [certname]);

  const [runningPuppet, setRunningPuppet] = useState(false);
  const [puppetResult, setPuppetResult] = useState<any>(null);

  const handleRunPuppet = async () => {
    if (!certname) return;
    setRunningPuppet(true);
    setPuppetResult(null);
    try {
      const r = await bolt.runTask({
        task: 'puppet_agent::run',
        targets: certname,
        params: {},
      });
      setPuppetResult(r);
      if (r.returncode === 0) {
        notifications.show({ title: 'Puppet Run Complete', message: `Agent run completed on ${certname}`, color: 'green' });
      } else {
        notifications.show({ title: 'Puppet Run', message: `Agent run finished with exit code ${r.returncode}`, color: 'yellow' });
      }
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setRunningPuppet(false);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!node) return <Alert color="yellow">Node not found</Alert>;

  const keyFacts = ['os', 'networking', 'kernel', 'kernelrelease', 'processors',
    'memorysize', 'uptime', 'virtual', 'is_virtual', 'fqdn', 'ipaddress',
    'operatingsystem', 'operatingsystemrelease', 'architecture'];

  return (
    <Stack>
      <Group>
        <Title order={2}>{node.certname}</Title>
        <StatusBadge status={node.latest_report_status} size="lg" />
        <Button
          leftSection={runningPuppet ? <Loader size={14} color="white" /> : <IconPlayerPlay size={14} />}
          color="green" size="sm" variant="outline"
          onClick={handleRunPuppet} loading={runningPuppet}>
          Run Puppet
        </Button>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 4 : 3 }}>
          <Stack>
            <Card withBorder shadow="sm" padding="md">
              <Text fw={700} mb="sm">Overview</Text>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Environment</Text>
                  <Badge variant="outline">{node.report_environment || 'N/A'}</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Resources</Text>
                  <Text size="sm" fw={500}>{node.resources_count}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Last Report</Text>
                  <Text size="sm">{node.report_timestamp ? new Date(node.report_timestamp).toLocaleString() : 'Never'}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Last Catalog</Text>
                  <Text size="sm">{node.catalog_timestamp ? new Date(node.catalog_timestamp).toLocaleString() : 'Never'}</Text>
                </Group>
              </Stack>
            </Card>

            {/* Casual robot illustration */}
            {!isFormal && (
              <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
                <InspectOBot />
              </Card>
            )}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: isFormal ? 8 : 9 }}>
          <Card withBorder shadow="sm" padding="md">
            <Text fw={700} mb="sm">Applied Classes ({node.classes.length})</Text>
            <Group gap="xs">
              {node.classes.map((cls: string) => (
                <Badge key={cls} variant="light" size="sm">{cls}</Badge>
              ))}
              {node.classes.length === 0 && <Text c="dimmed" size="sm">No classes applied</Text>}
            </Group>
          </Card>
        </Grid.Col>
      </Grid>

      <Tabs defaultValue="facts">
        <Tabs.List>
          <Tabs.Tab value="facts" leftSection={<IconList size={16} />}>Key Facts</Tabs.Tab>
          <Tabs.Tab value="allfacts" leftSection={<IconCode size={16} />}>All Facts</Tabs.Tab>
          <Tabs.Tab value="reports" leftSection={<IconFileReport size={16} />}>Recent Reports</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="facts" pt="md">
          <Card withBorder>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fact</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {keyFacts.map((fact) => (
                  node.facts[fact] !== undefined ? (
                    <Table.Tr key={fact}>
                      <Table.Td><Text fw={500} size="sm">{fact}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {typeof node.facts[fact] === 'object'
                            ? JSON.stringify(node.facts[fact]).slice(0, 120)
                            : String(node.facts[fact])}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : null
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="allfacts" pt="md">
          <Paper withBorder p="md">
            <PrettyJson data={node.facts} maxHeight={500} withBorder={false} />
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="reports" pt="md">
          <Card withBorder>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Environment</Table.Th>
                  <Table.Th>Puppet Version</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reportList?.map((r: any) => (
                  <Table.Tr
                    key={r.hash}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/reports/${r.hash}`)}
                  >
                    <Table.Td><StatusBadge status={r.status} /></Table.Td>
                    <Table.Td>{new Date(r.start_time).toLocaleString()}</Table.Td>
                    <Table.Td>{r.environment}</Table.Td>
                    <Table.Td>{r.puppet_version}</Table.Td>
                  </Table.Tr>
                )) || <Table.Tr><Table.Td colSpan={4}><Text c="dimmed">No reports</Text></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
