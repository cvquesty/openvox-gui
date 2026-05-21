/**
 * OpenVox GUI - MetricsCompliance.tsx
 *
 * Fleet Compliance & Drift visualization. Shows a donut chart of current
 * compliance status, a trend area chart over the selected time window,
 * summary stat cards, and expandable per-category node lists.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Select, Table, Paper, ScrollArea, Grid, Collapse, ActionIcon,
} from '@mantine/core';
import {
  IconShieldCheck, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

const STATUS_COLORS: Record<string, string> = {
  compliant: '#28a745',
  drifted: '#fd7e14',
  failed: '#dc3545',
  noop: '#ffc107',
  unreported: '#6c757d',
};

const HOURS_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '4', label: '4 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '168', label: '7 days' },
];

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NodeList({ title, nodes, color }: { title: string; nodes: any[]; color: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!nodes || nodes.length === 0) return null;

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group
        justify="space-between"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <Group gap="xs">
          <ActionIcon variant="subtle" size="sm">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <Badge color={color} variant="light">{title}</Badge>
          <Text size="sm" c="dimmed">{nodes.length} node{nodes.length !== 1 ? 's' : ''}</Text>
        </Group>
      </Group>
      <Collapse in={open}>
        <ScrollArea mah={400} mt="xs">
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Certname</Table.Th>
                <Table.Th>Environment</Table.Th>
                <Table.Th>Last Report</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...nodes].sort((a: any, b: any) => (a.certname || '').localeCompare(b.certname || '')).map((n: any, i: number) => (
                <Table.Tr key={i}>
                  <Table.Td><Text size="sm" fw={500} c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => navigate(`/nodes/${n.certname}`)}>{n.certname}</Text></Table.Td>
                  <Table.Td><Text size="sm">{n.environment || '\u2014'}</Text></Table.Td>
                  <Table.Td><Text size="sm">{n.report_timestamp ? timeAgo(n.report_timestamp) : '\u2014'}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Collapse>
    </Paper>
  );
}

export function MetricsCompliancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState('24');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await metrics.compliance(parseInt(hours));
      setData(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load compliance data');
    }
    setLoading(false);
  }, [hours]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const donutData = [
    { name: 'Compliant', value: data.compliant || 0, color: STATUS_COLORS.compliant },
    { name: 'Drifted', value: data.drifted || 0, color: STATUS_COLORS.drifted },
    { name: 'Failed', value: data.failed || 0, color: STATUS_COLORS.failed },
    { name: 'Noop', value: data.noop || 0, color: STATUS_COLORS.noop },
    { name: 'Unreported', value: data.unreported || 0, color: STATUS_COLORS.unreported },
  ].filter((d) => d.value > 0);

  const compliantPct = data.total ? Math.round((data.compliant / data.total) * 100) : 0;

  const trendData = (data.trend || []).map((t: any) => ({
    ...t,
    timestamp: t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
  }));

  const statCards = [
    { label: 'Total Nodes', value: data.total, color: 'blue' },
    { label: 'Compliant', value: data.compliant, color: 'green' },
    { label: 'Drifted', value: data.drifted, color: 'orange' },
    { label: 'Failed', value: data.failed, color: 'red' },
    { label: 'Noop', value: data.noop, color: 'yellow' },
    { label: 'Unreported', value: data.unreported, color: 'gray' },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconShieldCheck size={28} />
          <Title order={2}>Fleet Compliance &amp; Drift</Title>
        </Group>
        <Select
          size="sm"
          data={HOURS_OPTIONS}
          value={hours}
          onChange={(v) => setHours(v || '24')}
          style={{ width: 130 }}
        />
      </Group>

      {/* Stat cards */}
      <Grid>
        {statCards.map((s) => (
          <Grid.Col span={{ base: 6, sm: 4, md: 2 }} key={s.label}>
            <Card withBorder shadow="sm" padding="md" ta="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{s.label}</Text>
              <Text size="xl" fw={700} c={s.color}>{s.value ?? 0}</Text>
            </Card>
          </Grid.Col>
        ))}
      </Grid>

      <Grid>
        {/* Compliance distribution bar chart */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Group justify="space-between" mb="md">
              <Title order={4}>Compliance Distribution</Title>
              <Badge size="lg" variant="filled" color={compliantPct >= 90 ? 'green' : compliantPct >= 70 ? 'yellow' : 'red'}>
                {compliantPct}% Compliant
              </Badge>
            </Group>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={donutData.filter(d => d.value > 0)} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#8899aa' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12, fill: '#8899aa' }} />
                <ReTooltip
                  contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', padding: '10px 14px', fontSize: 12, color: '#e0e0e0' }}
                  labelStyle={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}
                  itemStyle={{ color: '#e0e0e0' }}
                  formatter={(value: number) => [`${value} nodes`, 'Count']}
                />
                <Bar dataKey="value" name="Nodes" radius={[0, 4, 4, 0]}>
                  {donutData.filter(d => d.value > 0).map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Grid.Col>

        {/* Trend area chart */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Compliance Trend</Title>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis dataKey="timestamp" type="category" tick={{ fontSize: 10, fill: '#8899aa' }}
                  tickFormatter={(v) => {
                    const s = String(v || '');
                    if (!s || s.length < 4) return s;
                    const hourMatch = s.match(/T(\d{2})$/);
                    if (hourMatch) return `${hourMatch[1]}:00`;
                    const timeMatch = s.match(/T(\d{2}:\d{2})/);
                    if (timeMatch) return timeMatch[1];
                    return s.length > 10 ? s.substring(11, 16) : s;
                  }} />
                <YAxis allowDecimals={false} />
                <ReTooltip contentStyle={{ backgroundColor: "rgba(20,20,33,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", padding: "10px 14px", fontSize: 12, color: "#e0e0e0" }} labelStyle={{ fontWeight: 600, color: "#fff", marginBottom: 4 }} />
                <Legend />
                <Area type="monotone" dataKey="compliant" stroke={STATUS_COLORS.compliant} fill={STATUS_COLORS.compliant} fillOpacity={0.4} strokeWidth={2} name="Compliant" />
                <Area type="monotone" dataKey="drifted" stroke={STATUS_COLORS.drifted} fill={STATUS_COLORS.drifted} fillOpacity={0.4} strokeWidth={2} name="Drifted" />
                <Area type="monotone" dataKey="failed" stroke={STATUS_COLORS.failed} fill={STATUS_COLORS.failed} fillOpacity={0.4} strokeWidth={2} name="Failed" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Expandable node lists per category */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Nodes by Category</Title>
        <Stack gap="xs">
          <NodeList title="Compliant" nodes={data.nodes?.compliant} color="green" />
          <NodeList title="Drifted" nodes={data.nodes?.drifted} color="orange" />
          <NodeList title="Failed" nodes={data.nodes?.failed} color="red" />
          <NodeList title="Noop" nodes={data.nodes?.noop} color="yellow" />
          <NodeList title="Unreported" nodes={data.nodes?.unreported} color="gray" />
        </Stack>
      </Card>
    </Stack>
  );
}
