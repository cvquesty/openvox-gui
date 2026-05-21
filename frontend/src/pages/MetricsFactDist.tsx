/**
 * OpenVox GUI - MetricsFactDist.tsx
 *
 * Fleet Fact Overview — auto-detects interesting facts, chooses the right
 * visualization: scatter plots for numeric data, stacked area for categorical.
 * Highlights outliers across the fleet.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid,
  TextInput, Button, Table, Tooltip,
} from '@mantine/core';
import {
  ResponsiveContainer, ScatterChart, Scatter, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Cell, Legend,
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
  is_numeric: boolean;
  dominant: { value: string; count: number } | null;
  dominant_pct: number;
  chart_distribution: Array<{ value: string; count: number }>;
  distribution: Array<{ value: string; count: number }>;
  outliers: Array<{ value: string; count: number; nodes: string[] }>;
  scatter: Array<{ certname: string; value: number }>;
}

/* Scatter plot for numeric facts — each dot is a node */
function NumericScatter({ data, height }: { data: Array<{ certname: string; value: number }>; height: number }) {
  // Add index for X axis positioning
  const plotData = data.map((d, i) => ({ ...d, idx: i }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis type="number" dataKey="idx" tick={false} label={{ value: `Nodes (${data.length})`, position: 'bottom', offset: -5, style: { fontSize: 10, fill: '#8899aa' } }} />
        <YAxis type="number" dataKey="value" tick={{ fontSize: 10, fill: '#8899aa' }} />
        <ReTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload;
            return d ? (
              <div style={TOOLTIP_STYLE.contentStyle}>
                <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{d.certname}</div>
                <div>{d.value}</div>
              </div>
            ) : null;
          }}
        />
        <Scatter data={plotData} fill="#0D6EFD" fillOpacity={0.7}>
          {plotData.map((_, i) => (
            <Cell key={i} fill={COLORS[0]} fillOpacity={0.7} r={height > 200 ? 5 : 3} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/* Stacked area for categorical facts — rare values in foreground */
function CategoricalArea({ distribution, total, height }: {
  distribution: Array<{ value: string; count: number }>; total: number; height: number;
}) {
  // Build data: one point per category, stacked to show proportion
  // Sort so smallest (rarest) are last = rendered on top (foreground)
  const sorted = [...distribution].sort((a, b) => b.count - a.count);
  // Create cumulative data for area stacking
  const areaData = sorted.map((d, i) => ({
    name: d.value.length > 20 ? d.value.substring(0, 18) + '...' : d.value,
    fullName: d.value,
    count: d.count,
    pct: Number(((d.count / total) * 100).toFixed(1)),
    idx: i,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={areaData} margin={{ left: 10, right: 20, top: 5, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8899aa' }} angle={-30} textAnchor="end" height={60} />
        <YAxis tick={{ fontSize: 10, fill: '#8899aa' }} allowDecimals={false}
          label={{ value: 'Nodes', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#8899aa' } }} />
        <ReTooltip {...TOOLTIP_STYLE}
          formatter={(value: number, name: string, props: any) => [
            `${value} nodes (${props.payload.pct}%)`, props.payload.fullName
          ]} />
        <Bar dataKey="count" name="Nodes" radius={[4, 4, 0, 0]}>
          {areaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
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
          <Badge size="xs" variant="outline" color={data.is_numeric ? 'blue' : 'grape'}>
            {data.is_numeric ? 'numeric' : 'categorical'}
          </Badge>
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
          {data.is_numeric && data.scatter.length > 0 ? (
            <NumericScatter data={data.scatter} height={100} />
          ) : (
            <CategoricalArea distribution={data.chart_distribution} total={data.total_nodes} height={100} />
          )}
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

          {data.is_numeric && data.scatter.length > 0 ? (
            <NumericScatter data={data.scatter} height={400} />
          ) : (
            <CategoricalArea distribution={data.distribution} total={data.total_nodes} height={350} />
          )}

          {data.outliers.length > 0 && (
            <Card withBorder padding="sm" style={{ borderColor: 'var(--mantine-color-orange-6)' }}>
              <Group gap="xs" mb="xs">
                <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />
                <Text size="sm" fw={700} c="orange">Outliers — unusual values ({data.outliers.length})</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                Values appearing on only 1-2 nodes. May indicate legacy systems or nodes pending upgrade.
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
    try { setData(await metrics.factOverview()); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const handleCustomQuery = async () => {
    if (!customFact.trim()) return;
    setCustomLoading(true); setCustomError(null); setCustomData(null);
    try { setCustomData(await metrics.factDistribution(customFact.trim())); }
    catch (e: any) { setCustomError(e.message); }
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
        <Badge variant="light" color="blue" size="lg">{facts.length} facts</Badge>
      </Group>

      <Alert variant="light" color="blue" mb="xs">
        Auto-detected facts with variety across your fleet. Numeric facts (uptime, memory, CPU)
        show as scatter plots — each dot is a node, sorted by value so outliers stand out.
        Categorical facts (OS, kernel, versions) show as bar charts ranked by count.
      </Alert>

      {expanded ? (
        (() => {
          const fact = facts.find(f => f.fact === expanded);
          return fact ? <FactThumbnail data={fact} expanded={true} onClick={() => setExpanded(null)} /> : null;
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

      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Custom Fact Explorer</Text>
        <Text size="xs" c="dimmed" mb="sm">
          Query any fact path (e.g., networking.domain, disks.sda.size, processors.models).
        </Text>
        <Group>
          <TextInput placeholder="Type a fact path..." leftSection={<IconSearch size={14} />}
            value={customFact} onChange={(e) => setCustomFact(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomQuery()} style={{ flex: 1 }} />
          <Button onClick={handleCustomQuery} loading={customLoading}>Query</Button>
        </Group>
        {customError && <Alert color="red" mt="sm">{customError}</Alert>}
        {customData && (
          <Stack mt="md">
            <Group gap="lg">
              <Badge variant="light" color="blue">{customData.total_nodes} nodes</Badge>
              <Badge variant="light" color="cyan">{customData.unique_values} unique values</Badge>
            </Group>
            <CategoricalArea
              distribution={customData.chart_distribution || customData.distribution || []}
              total={customData.total_nodes || 1}
              height={300}
            />
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
