/**
 * OpenVox GUI - MetricsFactDist.tsx
 *
 * Fleet Fact Overview — auto-detects interesting facts across the fleet,
 * displays as a thumbnail grid with click-to-expand. Highlights outliers.
 * All charts are horizontal bar charts — no donuts.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid,
  TextInput, Button, Table, Tooltip,
} from '@mantine/core';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Cell,
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
  itemStyle: { color: '#e0e0e0' } as const,
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 } as const,
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

function DistributionBar({ data, height, maxItems }: { data: Array<{ value: string; count: number }>; height: number; maxItems: number }) {
  const chartData = data.slice(0, maxItems).map(d => ({
    name: String(d.value ?? 'null'),
    count: d.count,
  }));
  const barHeight = Math.max(height, chartData.length * 28 + 40);

  return (
    <ResponsiveContainer width="100%" height={barHeight}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#8899aa' }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={120}
          tick={{ fontSize: 11, fill: '#8899aa' }}
          tickFormatter={(v: string) => v.length > 22 ? v.substring(0, 20) + '...' : v} />
        <ReTooltip {...TOOLTIP_STYLE}
          formatter={(value: number) => [`${value} nodes`, 'Count']} />
        <Bar dataKey="count" name="Nodes" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FactThumbnail({ data, expanded, onClick }: {
  data: FactCard; expanded: boolean; onClick: () => void;
}) {
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
        <>
          <Group gap="xs" mb={4}>
            <Text size="xs" c="dimmed">{data.unique_values} values / {data.total_nodes} nodes</Text>
            {data.dominant && (
              <Badge size="xs" variant="light">{data.dominant.value}: {data.dominant_pct}%</Badge>
            )}
          </Group>
          <DistributionBar data={data.chart_distribution} height={120} maxItems={5} />
        </>
      )}

      {expanded && (
        <Stack gap="md" onClick={(e) => e.stopPropagation()}>
          <Group gap="lg">
            <Badge variant="light" color="blue" size="lg">{data.total_nodes} nodes</Badge>
            <Badge variant="light" color="cyan" size="lg">{data.unique_values} unique values</Badge>
            {data.dominant && (
              <Badge variant="light" color="green" size="lg">
                Dominant: {data.dominant.value} ({data.dominant_pct}%)
              </Badge>
            )}
          </Group>

          <DistributionBar data={data.distribution} height={350} maxItems={20} />

          {data.outliers.length > 0 && (
            <Card withBorder padding="sm" style={{ borderColor: 'var(--mantine-color-orange-6)' }}>
              <Group gap="xs" mb="xs">
                <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />
                <Text size="sm" fw={700} c="orange">Outliers — unusual values ({data.outliers.length})</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                These values appear on only 1-2 nodes. They may indicate legacy systems,
                misconfigured nodes, or systems pending upgrade.
              </Text>
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

          <Button variant="subtle" color="gray" size="xs" onClick={onClick}>Collapse</Button>
        </Stack>
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
        Uniform facts (same value on every node) are hidden. Outliers (values on 1-2 nodes)
        are highlighted — these often indicate legacy systems or misconfigured nodes.
      </Alert>

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
            <DistributionBar
              data={customData.chart_distribution || customData.distribution || []}
              height={300}
              maxItems={15}
            />
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
