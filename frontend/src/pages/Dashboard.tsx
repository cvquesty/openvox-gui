import { useState, useEffect, useCallback } from 'react';
import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Alert, Loader, Center,
  Badge, Tooltip, Table, ActionIcon, Select, Switch,
} from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { dashboard, nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { useAppTheme } from '../hooks/ThemeContext';
import type { DashboardStats, NodeSummary } from '../types';

/* ═══════════════════════════════════════════════════════════════
   COMMAND-CENTER-O-TRON 9000 — mission control cartoon
   ═══════════════════════════════════════════════════════════════ */
function CommandCenterOTron() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="cc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#cc-sky)" rx="8" />

      {/* Stars */}
      <circle cx="40" cy="15" r="1" fill="#fff" opacity="0.5" />
      <circle cx="120" cy="28" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="200" cy="10" r="1.1" fill="#fff" opacity="0.4" />
      <circle cx="320" cy="22" r="0.7" fill="#fff" opacity="0.6" />
      <circle cx="430" cy="12" r="1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="32" r="0.9" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Big mission control desk */}
      <rect x="60" y="130" width="400" height="80" fill="#3d4d5d" rx="6" stroke="#667788" strokeWidth="1.5" />

      {/* Monitor bank - left */}
      <rect x="80" y="55" width="90" height="72" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="85" y="60" width="80" height="55" fill="#0a1628" rx="2" />
      {/* Node status ring mock */}
      <circle cx="110" cy="82" r="16" fill="none" stroke="#44ff44" strokeWidth="4" strokeDasharray="30 70" strokeDashoffset="-10" />
      <circle cx="110" cy="82" r="16" fill="none" stroke="#ffaa22" strokeWidth="4" strokeDasharray="10 90" strokeDashoffset="-40" />
      <circle cx="110" cy="82" r="16" fill="none" stroke="#ff4444" strokeWidth="4" strokeDasharray="5 95" strokeDashoffset="-50" />
      <text x="110" y="86" textAnchor="middle" fill="#44ff88" fontSize="8" fontFamily="monospace" fontWeight="bold">5</text>
      <text x="148" y="72" fill="#888" fontSize="5" fontFamily="monospace">nodes</text>
      <text x="148" y="82" fill="#44ff44" fontSize="5" fontFamily="monospace">4 ok</text>
      <text x="148" y="92" fill="#ff4444" fontSize="5" fontFamily="monospace">1 fail</text>
      <text x="125" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">FLEET STATUS</text>

      {/* Monitor bank - center */}
      <rect x="185" y="42" width="150" height="85" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="190" y="47" width="140" height="68" fill="#0a1628" rx="2" />
      {/* Sparkline chart mock */}
      <polyline points="200,90 215,85 230,88 245,70 260,72 275,65 290,68 305,55 320,60"
        fill="none" stroke="#44ff88" strokeWidth="1.5" />
      <polyline points="200,95 215,92 230,96 245,88 260,90 275,85 290,92 305,80 320,82"
        fill="none" stroke="#ffaa22" strokeWidth="1" opacity="0.6" />
      <line x1="200" y1="100" x2="320" y2="100" stroke="#334455" strokeWidth="0.5" />
      <text x="260" y="62" textAnchor="middle" fill="#44aaff" fontSize="6" fontFamily="monospace">REPORT TRENDS</text>
      {/* Scanning line */}
      <line x1="200" y1="50" x2="200" y2="110" stroke="#44aaff" strokeWidth="0.5" opacity="0.5">
        <animate attributeName="x1" values="200;325;200" dur="4s" repeatCount="indefinite" />
        <animate attributeName="x2" values="200;325;200" dur="4s" repeatCount="indefinite" />
      </line>
      <text x="260" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">REPORT MONITOR</text>

      {/* Monitor bank - right */}
      <rect x="350" y="55" width="90" height="72" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="355" y="60" width="80" height="55" fill="#0a1628" rx="2" />
      {/* Server rack lines */}
      <rect x="362" y="65" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="69" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="380" y="72" fill="#44ff88" fontSize="5" fontFamily="monospace">puppetserver</text>
      <rect x="362" y="77" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="81" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <text x="380" y="84" fill="#44ff88" fontSize="5" fontFamily="monospace">puppetdb</text>
      <rect x="362" y="89" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="93" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.6s" />
      </circle>
      <text x="380" y="96" fill="#44ff88" fontSize="5" fontFamily="monospace">r10k</text>
      <rect x="362" y="101" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="105" r="2" fill="#44aaff" />
      <text x="380" y="108" fill="#44aaff" fontSize="5" fontFamily="monospace">bolt</text>
      <text x="395" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">SERVICES</text>

      {/* Console desk details */}
      <rect x="100" y="140" width="320" height="20" fill="#334455" rx="3" />
      <text x="260" y="154" textAnchor="middle" fill="#EC8622" fontSize="9" fontFamily="monospace" fontWeight="bold">COMMAND-CENTER-O-TRON 9000</text>

      {/* Status lights row */}
      <circle cx="120" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="135" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.15s" />
      </circle>
      <circle cx="150" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <circle cx="165" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.45s" />
      </circle>
      <circle cx="180" cy="175" r="4" fill="#ffaa22" />
      <circle cx="195" cy="175" r="4" fill="#44aaff" />

      {/* Dial */}
      <circle cx="350" cy="180" r="15" fill="#334455" stroke="#667788" strokeWidth="1.5" />
      <line x1="350" y1="180" x2="350" y2="168" stroke="#EC8622" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" values="0 350 180;360 350 180" dur="6s" repeatCount="indefinite" />
      </line>
      <circle cx="350" cy="180" r="3" fill="#556677" />

      {/* Antenna with signal */}
      <line x1="260" y1="42" x2="260" y2="20" stroke="#667788" strokeWidth="2" />
      <circle cx="260" cy="16" r="4" fill="#EC8622" />
      <circle cx="260" cy="16" r="8" fill="none" stroke="#EC8622" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values="8;18;8" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Caption */}
      <text x="260" y="232" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">Mission Control</text>
      <text x="260" y="246" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">all systems nominal (probably)</text>
    </svg>
  );
}

function nodeTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const { isFormal } = useAppTheme();
  const navigate = useNavigate();
  const { data: stats, loading, error, refetch: refetchStats } = useApi<DashboardStats>(dashboard.getStats);
  const { data: nodeList, refetch: refetchNodes } = useApi<NodeSummary[]>(nodes.list);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => {
      refetchStats();
      refetchNodes();
      setLastRefresh(new Date());
    }, parseInt(refreshInterval) * 1000);
    return () => clearInterval(iv);
  }, [autoRefresh, refreshInterval]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!stats) return null;

  const ns = stats.node_status;
  const ringData = [
    { value: ns.total ? (ns.unchanged / ns.total) * 100 : 0, color: 'green', tooltip: `Unchanged: ${ns.unchanged}` },
    { value: ns.total ? (ns.changed / ns.total) * 100 : 0, color: 'yellow', tooltip: `Changed: ${ns.changed}` },
    { value: ns.total ? (ns.failed / ns.total) * 100 : 0, color: 'red', tooltip: `Failed: ${ns.failed}` },
    { value: ns.total ? (ns.noop / ns.total) * 100 : 0, color: 'blue', tooltip: `Noop: ${ns.noop}` },
    { value: ns.total ? (ns.unreported / ns.total) * 100 : 0, color: 'gray', tooltip: `Unreported: ${ns.unreported}` },
  ].filter(d => d.value > 0);

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={2}>Dashboard</Title>
          {autoRefresh && (
            <Badge variant="dot" color="green" size="sm">Live</Badge>
          )}
        </Group>
        <Group gap="sm">
          <Text size="xs" c="dimmed">Updated {lastRefresh.toLocaleTimeString()}</Text>
          <Select size="xs"
            data={[{value:'10',label:'10s'},{value:'30',label:'30s'},{value:'60',label:'1m'},{value:'300',label:'5m'}]}
            value={refreshInterval} onChange={(v) => setRefreshInterval(v || '30')}
            style={{ width: 70 }} />
          <Switch size="sm" label="Auto" checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)} />
        </Group>
      </Group>

      {/* Casual theme illustration */}
      {!isFormal && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <CommandCenterOTron />
        </Card>
      )}

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Node Status</Title>
            <Center>
              <RingProgress
                size={220}
                thickness={24}
                roundCaps
                label={
                  <Text ta="center" fw={700} size="xl">{ns.total}</Text>
                }
                sections={ringData}
              />
            </Center>
            <Group justify="center" mt="md" gap="lg">
              <Group gap={4}><Badge color="green" size="xs" circle /> <Text size="xs">Unchanged</Text></Group>
              <Group gap={4}><Badge color="yellow" size="xs" circle /> <Text size="xs">Changed</Text></Group>
              <Group gap={4}><Badge color="red" size="xs" circle /> <Text size="xs">Failed</Text></Group>
              <Group gap={4}><Badge color="blue" size="xs" circle /> <Text size="xs">Noop</Text></Group>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Report Trends</Title>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={stats.report_trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v.slice(11) || v} />
                <YAxis allowDecimals={false} />
                <ReTooltip />
                <Legend />
                <Line type="monotone" dataKey="unchanged" stroke="#40c057" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="changed" stroke="#fab005" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failed" stroke="#fa5252" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Grid.Col>
      </Grid>

      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>Nodes</Title>
          <Badge variant="light" size="lg">{nodeList?.length || 0} total</Badge>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Last Report</Table.Th>
              <Table.Th style={{ width: 60 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(nodeList || []).map((node) => (
              <Table.Tr key={node.certname} style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/nodes/${node.certname}`)}>
                <Table.Td><Text fw={500} size="sm">{node.certname}</Text></Table.Td>
                <Table.Td><StatusBadge status={node.latest_report_status} /></Table.Td>
                <Table.Td><Text size="sm">{node.report_environment || '\u2014'}</Text></Table.Td>
                <Table.Td><Text size="sm">{nodeTimeAgo(node.report_timestamp)}</Text></Table.Td>
                <Table.Td>
                  <Tooltip label="View details">
                    <ActionIcon variant="subtle" onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      navigate(`/nodes/${node.certname}`);
                    }}>
                      <IconEye size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {(!nodeList || nodeList.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" py="md">No nodes found</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
