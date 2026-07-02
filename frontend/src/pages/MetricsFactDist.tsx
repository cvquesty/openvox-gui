/**
 * OpenVox GUI - MetricsFactDist.tsx
 *
 * Fleet Fact Overview — auto-detects interesting facts, chooses the right
 * visualization: scatter plots for numeric data, stacked area for categorical.
 * Highlights outliers across the fleet.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid,
  TextInput, Button, Table, Tooltip,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Cell,
} from 'recharts';
import {
  IconChartPie, IconArrowsMaximize, IconArrowsMinimize,
  IconSearch, IconAlertTriangle,
} from '@tabler/icons-react';
import { metrics } from '../services/api';
import { useApi } from '../hooks/useApi';

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

/* Sorted distribution plot for numeric facts — clean curve showing spread.
   X = rank (sorted low to high), Y = value. Looks professional like other graphs. */
function NumericDistribution({ data, height }: { data: Array<{ certname: string; value: number }>; height: number }) {
  const sorted = [...data].sort((a, b) => a.value - b.value);
  const plotData = sorted.map((d, i) => ({
    rank: i + 1,
    value: d.value,
    certname: d.certname,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={plotData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gFactNum" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0D6EFD" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#0D6EFD" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis
          dataKey="rank"
          tick={{ fontSize: 9, fill: '#8899aa' }}
          label={{ value: `Nodes (sorted low → high, n=${data.length})`, position: 'bottom', offset: -2, style: { fontSize: 9, fill: '#8899aa' } }}
        />
        <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} />
        <ReTooltip
          {...TOOLTIP_STYLE}
          formatter={(v: number, _n: string, p: any) => [`${v}`, p.payload.certname]}
        />
        <Area isAnimationActive={false} animationDuration={0}
          type="natural"
          dataKey="value"
          stroke="#0D6EFD"
          fill="url(#gFactNum)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: height > 180 ? 4 : 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* Bar chart for categorical facts. Vertical for thumbnails (compact), horizontal for expanded (readable labels). */
function CategoricalBar({ distribution, total, height, horizontal = false }: {
  distribution: Array<{ value: string; count: number }>;
  total: number;
  height: number;
  horizontal?: boolean;
}) {
  const sorted = [...distribution].sort((a, b) => b.count - a.count);
  const barData = sorted.map((d) => ({
    name: d.value.length > 22 ? d.value.substring(0, 20) + '…' : d.value,
    fullName: d.value,
    count: d.count,
    pct: Number(((d.count / total) * 100).toFixed(1)),
  }));

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={barData} layout="vertical" margin={{ left: 5, right: 20, top: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
          <XAxis type="number" tick={{ fontSize: 9, fill: '#8899aa' }} />
          <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 9, fill: '#8899aa' }} />
          <ReTooltip {...TOOLTIP_STYLE}
            formatter={(value: number, _n: string, props: any) => [
              `${value} nodes (${props.payload.pct}%)`, props.payload.fullName
            ]} />
          <Bar isAnimationActive={false} animationDuration={0} dataKey="count" name="Nodes" radius={[0, 4, 4, 0]}>
            {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={barData} margin={{ left: 10, right: 15, top: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8899aa' }} angle={-25} textAnchor="end" height={55} />
        <YAxis tick={{ fontSize: 9, fill: '#8899aa' }} allowDecimals={false} />
        <ReTooltip {...TOOLTIP_STYLE}
          formatter={(value: number, _n: string, props: any) => [
            `${value} nodes (${props.payload.pct}%)`, props.payload.fullName
          ]} />
        <Bar isAnimationActive={false} animationDuration={0} dataKey="count" name="Nodes" radius={[3, 3, 0, 0]}>
          {barData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CertnameLink({ certname }: { certname: string }) {
  const navigate = useNavigate();
  return (
    <Text size="xs" c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
      onClick={(e) => { e.stopPropagation(); navigate(`/nodes/${certname}`); }}>
      {certname}
    </Text>
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
            <NumericDistribution data={data.scatter} height={120} />
          ) : (
            <CategoricalBar distribution={data.chart_distribution} total={data.total_nodes} height={120} />
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
            <NumericDistribution data={data.scatter} height={380} />
          ) : (
            <CategoricalBar distribution={data.distribution} total={data.total_nodes} height={340} horizontal />
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
                      <Table.Td>
                        <Group gap={4} wrap="wrap">
                          {o.nodes.map((cn: string) => <CertnameLink key={cn} certname={cn} />)}
                        </Group>
                      </Table.Td>
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customFact, setCustomFact] = useState('');
  const [customData, setCustomData] = useState<any>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const { data, loading, refreshing, error, refetch } = useApi(
    () => metrics.factOverview(),
    [],
    {
      cacheKey: 'openvox_metrics_fact_overview_v1',
      cacheValidate: (d) => d != null && Array.isArray((d as any).facts),
    },
  );

  const handleCustomQuery = async () => {
    if (!customFact.trim()) return;
    setCustomLoading(true); setCustomError(null); setCustomData(null);
    try { setCustomData(await metrics.factDistribution(customFact.trim())); }
    catch (e: any) { setCustomError(e.message); }
    setCustomLoading(false);
  };

  if (loading && !data) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;

  const facts: FactCard[] = data?.facts || [];

  return (
    <Stack>
      <Group gap="sm">
        <IconChartPie size={28} />
        <Title order={2}>Fleet Fact Overview</Title>
        <Badge variant="light" color="blue" size="lg">{facts.length} facts</Badge>
        {refreshing && <Badge variant="outline" color="gray" size="sm">Refreshing…</Badge>}
        <Button size="xs" variant="light" onClick={() => refetch()}>Refresh</Button>
      </Group>

      <Alert variant="light" color="blue" mb="xs">
        Auto-detected facts with meaningful variation. Numeric facts render as sorted distribution curves
        (rank vs value) so spread and outliers are immediately visible. Categorical facts use clean bar charts
        ranked by frequency. Expand any card for details and outliers.
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
            <CategoricalBar
              distribution={customData.chart_distribution || customData.distribution || []}
              total={customData.total_nodes || 1}
              height={320}
            />
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
