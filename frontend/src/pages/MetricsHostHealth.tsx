/**
 * Insights | Host Health — OS metrics for the OpenVox serving estate.
 *
 * Scope: GUI host, catalog compilers, OpenVoxDB nodes, CA members
 * (from Settings → Cluster). Agent fleet is intentionally excluded.
 *
 * Data: /proc always; sar/pidstat when sysstat is installed; Bolt for remotes.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Grid, Button, Select, Table, ThemeIcon, SimpleGrid,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import {
  IconServer2, IconRefresh, IconCpu, IconDatabase, IconShield,
  IconDeviceDesktop, IconAlertTriangle,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { metrics } from '../services/api';

const REFRESH_OPTIONS = [
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1m' },
];

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 } as const,
  itemStyle: { color: '#e0e0e0' } as const,
};

function satColor(level?: string) {
  if (level === 'red') return 'red';
  if (level === 'yellow') return 'yellow';
  return 'teal';
}

function roleIcon(roles: string[] = []) {
  if (roles.includes('ca')) return IconShield;
  if (roles.includes('puppetdb')) return IconDatabase;
  if (roles.includes('compiler')) return IconCpu;
  return IconDeviceDesktop;
}

function StatCard({ label, value, color, description }: {
  label: string; value: string | number; color?: string; description?: string;
}) {
  return (
    <Card withBorder shadow="sm" padding="md" ta="center">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700} c={color}>{value}</Text>
      {description && <Text size="xs" c="dimmed" mt={2}>{description}</Text>}
    </Card>
  );
}

export function MetricsHostHealthPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [refreshRate, setRefreshRate] = useState('30');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, loading, refreshing, error, refetch } = useApi(
    () => metrics.hostHealth(true, true),
    [],
    { cacheKey: 'openvox_metrics_host_health_v1' },
  );

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => { refetch(); }, Number(refreshRate) * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshRate, refetch]);

  const hosts = data?.hosts || [];
  const activeHost = useMemo(() => {
    if (!hosts.length) return null;
    const name = selectedHost || hosts[0]?.host;
    return hosts.find((h: any) => h.host === name) || hosts[0];
  }, [hosts, selectedHost]);

  const history = (activeHost?.history || []).map((p: any) => ({
    ...p,
    label: p.time ? String(p.time).slice(11, 19) : '',
  }));
  const latest = activeHost?.latest || {};
  const sat = latest.saturation || {};

  if (loading && !data) {
    return <Center h={280}><Loader /></Center>;
  }

  return (
    <Stack gap="md">
      {!embedded && (
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="sm">
              <ThemeIcon size="lg" variant="light" color="cyan">
                <IconServer2 size={22} />
              </ThemeIcon>
              <Title order={2}>Host Health</Title>
              <Badge variant="light" color="cyan">Serving estate</Badge>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              OS saturation for OpenVox control-plane hosts (GUI, compilers, OpenVoxDB, CA).
              Agent fleet metrics are not collected.
            </Text>
          </div>
          <Group>
            <Select
              size="xs"
              w={90}
              data={REFRESH_OPTIONS}
              value={refreshRate}
              onChange={(v) => setRefreshRate(v || '30')}
              allowDeselect={false}
            />
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              loading={refreshing}
              onClick={() => refetch()}
            >
              Refresh
            </Button>
          </Group>
        </Group>
      )}

      <Alert variant="light" color="blue" title="Serving estate only">
        {data?.scope_note ||
          'Targets come from Settings → Cluster (plus this GUI host). Install sysstat on the GUI host for richer sar/pidstat samples. Remotes use Bolt when inventory reaches them.'}
        {data?.tools_hint?.install && (
          <Text size="xs" mt="xs" ff="monospace">{data.tools_hint.install}</Text>
        )}
      </Alert>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>
      )}

      {/* Estate overview cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {hosts.map((h: any) => {
          const Icon = roleIcon(h.roles || []);
          const lv = h.latest?.saturation?.level || 'green';
          const l = h.latest || {};
          return (
            <Card
              key={h.host}
              withBorder
              padding="md"
              style={{
                cursor: 'pointer',
                borderColor: selectedHost === h.host || (!selectedHost && h === hosts[0])
                  ? 'var(--mantine-color-cyan-5)'
                  : undefined,
              }}
              onClick={() => setSelectedHost(h.host)}
            >
              <Group justify="space-between" mb={6}>
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color={satColor(lv)}>
                    <Icon size={14} />
                  </ThemeIcon>
                  <Text size="sm" fw={600} lineClamp={1}>{h.host}</Text>
                </Group>
                <Badge size="sm" color={satColor(lv)} variant="filled">{lv}</Badge>
              </Group>
              <Group gap={4} mb={6}>
                {(h.roles || []).map((r: string) => (
                  <Badge key={r} size="xs" variant="outline">{r}</Badge>
                ))}
                {h.is_local && <Badge size="xs" color="gray">local</Badge>}
              </Group>
              <Text size="xs" c="dimmed">
                CPU {l.cpu_used_pct ?? '—'}% · load {l.load1 ?? '—'} · mem {l.mem_used_pct ?? '—'}%
                {l.cpu_iowait_pct != null ? ` · iowait ${l.cpu_iowait_pct}%` : ''}
              </Text>
              {l.source && (
                <Text size="xs" c="dimmed" mt={2}>source: {l.source}</Text>
              )}
            </Card>
          );
        })}
      </SimpleGrid>

      {activeHost && (
        <>
          <Group justify="space-between">
            <Title order={4}>{activeHost.host}</Title>
            <Group gap="xs">
              {(sat.reasons || []).map((r: string, i: number) => (
                <Badge key={i} size="sm" color={satColor(sat.level)} variant="light">{r}</Badge>
              ))}
            </Group>
          </Group>

          <Grid>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <StatCard label="CPU used" value={`${latest.cpu_used_pct ?? '—'}%`} color={satColor(sat.level)} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <StatCard label="I/O wait" value={`${latest.cpu_iowait_pct ?? '—'}%`} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <StatCard label="Load (1m)" value={latest.load1 ?? '—'} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <StatCard
                label="Memory"
                value={`${latest.mem_used_pct ?? '—'}%`}
                description={latest.mem_used_mb != null ? `${latest.mem_used_mb} / ${latest.mem_total_mb} MiB` : undefined}
              />
            </Grid.Col>
          </Grid>

          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder padding="sm">
                <Text size="sm" fw={700} mb="xs">CPU &amp; load</Text>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                    <ReTooltip {...TOOLTIP_STYLE} />
                    <Legend />
                    <Area type="monotone" dataKey="cpu_used_pct" name="CPU %" stroke="#228be6" fill="#228be6" fillOpacity={0.25} />
                    <Area type="monotone" dataKey="cpu_iowait_pct" name="iowait %" stroke="#fd7e14" fill="#fd7e14" fillOpacity={0.15} />
                    <Line type="monotone" dataKey="load1" name="load1" stroke="#ae3ec9" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder padding="sm">
                <Text size="sm" fw={700} mb="xs">Memory</Text>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <ReTooltip {...TOOLTIP_STYLE} />
                    <Legend />
                    <Line type="monotone" dataKey="mem_used_pct" name="Mem %" stroke="#12b886" dot={false} />
                    <Line type="monotone" dataKey="swap_used_mb" name="Swap MiB" stroke="#fa5252" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </Grid.Col>
          </Grid>

          <Card withBorder padding="sm">
            <Text size="sm" fw={700} mb="xs">
              OpenVox-related processes
              {latest.tools?.pidstat ? ' (pidstat)' : ' (/proc fallback)'}
            </Text>
            {(latest.processes || []).length === 0 ? (
              <Text size="sm" c="dimmed">No matching processes in this sample.</Text>
            ) : (
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>PID</Table.Th>
                    <Table.Th>Command</Table.Th>
                    <Table.Th>CPU %</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(latest.processes || []).map((p: any) => (
                    <Table.Tr key={`${p.pid}-${p.command}`}>
                      <Table.Td>{p.pid}</Table.Td>
                      <Table.Td><Text size="sm" ff="monospace">{p.command}</Text></Table.Td>
                      <Table.Td>{p.cpu_pct ?? '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>

          {(latest.errors || []).length > 0 && (
            <Alert color="yellow" title="Collector notes">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {latest.errors.map((e: string, i: number) => (
                  <li key={i}><Text size="sm">{e}</Text></li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      )}

      {!hosts.length && !loading && (
        <Alert color="gray">No serving-estate hosts discovered. Is the GUI running?</Alert>
      )}
    </Stack>
  );
}

export default MetricsHostHealthPage;
