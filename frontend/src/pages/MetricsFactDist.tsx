/**
 * OpenVox GUI - MetricsFactDist.tsx
 *
 * Fleet Fact Overview — auto-detects interesting facts across the fleet,
 * displays as a thumbnail grid with click-to-expand. Highlights outliers
 * (nodes with unusual values). Includes a custom fact explorer.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper,
  TextInput, Button, Table, Collapse, ActionIcon, Tooltip,
} from '@mantine/core';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
} from 'recharts';
import {
  IconChartPie, IconArrowsMaximize, IconArrowsMinimize,
  IconSearch, IconAlertTriangle,
} from '@tabler/icons-react';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63', '#95a5a6'];

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  itemStyle: { color: '#e0e0e0' },
};

interface FactCard {
  fact: string;
  total_nodes: number;
  unique_values: number;
  dominant: { value: string; count: number } | null;
  dominant_pct: number;
  chart_distribution: Array<{ value: string; count: number }>;
  distribution: Array<{ value: string; count: number }>;
  outliers: Array<{ value: string; count: number; nodes: string[] }>;
}

function FactThumbnail({ data, expanded, onClick }: {
  data: FactCard; expanded: boolean; onClick: () => void;
}) {
  const chartData = data.chart_distribution.map(d => ({ name: d.value, value: d.count }));
  const pieSize = expanded ? 160 : 70;

  return (
    <Card withBorder shadow="sm" padding="sm" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
      onClick={onClick}>
      <Group justify="space-between" mb={4}>
        <Group gap="xs">
          <Text size={expanded ? 'md' : 'sm'} fw={700}>{data.fact}</Text>
          {data.outliers.length > 0 && (
            <Tooltip label={`${data.outliers.length} outlier${data.outliers.length > 1 ? 's' : ''}`}>
              <Badge size="xs" color="orange" variant="filled">{data.outliers.length}</Badge>
            </Tooltip>
          )}
        </Group>
        {expanded ? <IconArrowsMinimize size={14} color="#8899aa" /> : <IconArrowsMaximize size={14} color="#8899aa" />}
      </Group>

      {!expanded && (
        <Group gap="xs" mb={4}>
          <Text size="xs" c="dimmed">{data.unique_values} values across {data.total_nodes} nodes</Text>
          {data.dominant && (
            <Badge size="xs" variant="light">{data.dominant.value}: {data.dominant_pct}%</Badge>
          )}
        </Group>
      )}

      {expanded ? (
        <Stack gap="md">
          <Group gap="lg" mb="xs">
            <Badge variant="light" color="blue" size="lg">{data.total_nodes} nodes</Badge>
            <Badge variant="light" color="cyan" size="lg">{data.unique_values} unique values</Badge>
            {data.dominant && (
              <Badge variant="light" color="green" size="lg">
                Dominant: {data.dominant.value} ({data.dominant_pct}%)
              </Badge>
            )}
          </Group>

          <Grid>
            <Grid.Col span={5}>
              <Text size="sm" fw={600} mb="xs">Distribution</Text>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={pieSize / 2 + 40}
                    dataKey="value" label={false}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <ReTooltip {...TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [
                      `${value} nodes (${((value / data.total_nodes) * 100).toFixed(1)}%)`, name
                    ]} />
                </PieChart>
              </ResponsiveContainer>
            </Grid.Col>
            <Grid.Col span={7}>
              <Text size="sm" fw={600} mb="xs">Values ({data.distribution.length})</Text>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.distribution.slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#8899aa' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="value" tick={{ fontSize: 10, fill: '#8899aa' }} width={75}
                    tickFormatter={(v: string) => v.length > 18 ? v.substring(0, 16) + '...' : v} />
                  <ReTooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Nodes" radius={[0, 4, 4, 0]}>
                    {data.distribution.slice(0, 15).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Grid.Col>
          </Grid>

          {data.outliers.length > 0 && (
            <Card withBorder padding="sm" style={{ borderColor: 'var(--mantine-color-orange-6)' }}>
              <Group gap="xs" mb="xs">
                <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />
                <Text size="sm" fw={700} c="orange">Outliers — unusual values ({data.outliers.length})</Text>
              </Group>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Value</Table.Th>
                    <Table.Th>Count</Table.Th>
                    <Table.Th>Nodes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.outliers.map((o, i) => (
                    <Table.Tr key={i}>
                      <Table.Td><Badge size="sm" variant="light" color="orange">{o.value}</Badge></Table.Td>
                      <Table.Td>{o.count}</Table.Td>
                      <Table.Td><Text size="xs">{o.nodes.join(', ')}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
        </Stack>
      ) : (
        <ResponsiveContainer width="100%" height={100}>
          <PieChart>
            <Pie data={chartData} cx="50%" cy="50%" innerRadius={20} outerRadius={40}
              dataKey="value" label={false}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function MetricsFactDistPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customFact, setCustomFact] = useState('');
  const [customData, setCustomData] = useState<any>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const result = await metrics.factOverview();
      setData(result);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const handleCustomQuery = async () => {
    if (!customFact.trim()) return;
    setCustomLoading(true);
    setCustomError(null);
    setCustomData(null);
    try {
      const result = await metrics.factDistribution(customFact.trim());
      setCustomData(result);
    } catch (e: any) {
      setCustomError(e.message);
    }
    setCustomLoading(false);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const facts: FactCard[] = data?.facts || [];

  return (
    <Stack>
      <Group gap="sm">
        <IconChartPie size={28} />
        <Title order={2}>Fleet Fact Overview</Title>
        <Badge variant="light" color="blue" size="lg">{facts.length} facts analyzed</Badge>
      </Group>

      <Alert variant="light" color="blue" mb="xs">
        Auto-detected facts with variety across your fleet, ranked by interestingness.
        Facts where every node has the same value are hidden. Outliers (values on 1-2 nodes)
        are highlighted in orange — these are often misconfigured or legacy systems.
      </Alert>

      {/* Fact grid or expanded view */}
      {expanded ? (
        (() => {
          const fact = facts.find(f => f.fact === expanded);
          if (!fact) return null;
          return <FactThumbnail data={fact} expanded={true} onClick={() => setExpanded(null)} />;
        })()
      ) : (
        <Grid>
          {facts.map(fact => (
            <Grid.Col key={fact.fact} span={6}>
              <FactThumbnail data={fact} expanded={false} onClick={() => setExpanded(fact.fact)} />
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Custom fact explorer */}
      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Custom Fact Explorer</Text>
        <Text size="xs" c="dimmed" mb="sm">
          Query any fact path to see its distribution. Use dot notation for nested facts
          (e.g., networking.ip, disks.sda.size, processors.models).
        </Text>
        <Group>
          <TextInput
            placeholder="Type a fact path... (e.g., networking.domain)"
            leftSection={<IconSearch size={14} />}
            value={customFact}
            onChange={(e) => setCustomFact(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomQuery()}
            style={{ flex: 1 }}
          />
          <Button onClick={handleCustomQuery} loading={customLoading}>Query</Button>
        </Group>
        {customError && <Alert color="red" mt="sm">{customError}</Alert>}
        {customData && (
          <Stack mt="md">
            <Group gap="lg">
              <Badge variant="light" color="blue">{customData.total_nodes} nodes</Badge>
              <Badge variant="light" color="cyan">{customData.unique_values} unique values</Badge>
            </Group>
            <Grid>
              <Grid.Col span={5}>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={(customData.chart_distribution || customData.distribution || []).map((d: any) => ({ name: d.value, value: d.count }))}
                      cx="50%" cy="50%" innerRadius={40} outerRadius={90} dataKey="value" label={false}>
                      {(customData.chart_distribution || customData.distribution || []).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip {...TOOLTIP_STYLE}
                      formatter={(value: number, name: string) => [
                        `${value} nodes (${((value / (customData.total_nodes || 1)) * 100).toFixed(1)}%)`, name
                      ]} />
                  </PieChart>
                </ResponsiveContainer>
              </Grid.Col>
              <Grid.Col span={7}>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={(customData.distribution || []).slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#8899aa' }} allowDecimals={false} />
                    <YAxis type="category" dataKey="value" tick={{ fontSize: 10, fill: '#8899aa' }} width={75}
                      tickFormatter={(v: string) => v.length > 18 ? v.substring(0, 16) + '...' : v} />
                    <ReTooltip {...TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Nodes" radius={[0, 4, 4, 0]}>
                      {(customData.distribution || []).slice(0, 15).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Grid.Col>
            </Grid>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
