/**
 * OpenVox GUI - MetricsFactDist.tsx
 *
 * Fact Distribution Charts — pre-built tabs for common Puppet facts
 * (os.family, os.release.full, kernelrelease, processors.count,
 * memory.system.total) displayed as PieChart + BarChart pairs.
 * Includes a custom fact input for querying arbitrary fact paths.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  TextInput, Tabs, Grid, Paper,
} from '@mantine/core';
import { IconChartPie, IconSearch } from '@tabler/icons-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

const COMMON_FACTS = [
  { key: 'os.family', label: 'OS Family' },
  { key: 'os.release.full', label: 'OS Release' },
  { key: 'kernelrelease', label: 'Kernel Release' },
  { key: 'processors.count', label: 'Processor Count' },
  { key: 'memory.system.total', label: 'System Memory' },
];

interface FactDistData {
  fact: string;
  total_nodes: number;
  unique_values: number;
  distribution: { value: string; count: number }[];
}

function DistributionCharts({ data }: { data: FactDistData }) {
  const dist = (data.distribution || []).slice(0, 20); // Cap at 20 slices

  if (dist.length === 0) {
    return <Alert color="yellow">No distribution data available for this fact.</Alert>;
  }

  const chartData = dist.map((d) => ({
    name: String(d.value ?? 'null'),
    value: d.count,
  }));

  return (
    <Stack>
      <Group gap="lg" mb="xs">
        <Badge variant="light" color="blue" size="lg">{data.total_nodes} nodes</Badge>
        <Badge variant="light" color="cyan" size="lg">{data.unique_values} unique values</Badge>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="md" radius="sm">
            <Text fw={600} mb="sm">Distribution (Pie)</Text>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) =>
                    percent > 0.05 ? `${name} (${(percent * 100).toFixed(0)}%)` : ''
                  }
                >
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <ReTooltip contentStyle={{ backgroundColor: "rgba(20,20,33,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", padding: "10px 14px", fontSize: 12, color: "#e0e0e0" }} labelStyle={{ fontWeight: 600, color: "#fff", marginBottom: 4 }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="md" radius="sm">
            <Text fw={600} mb="sm">Distribution (Bar)</Text>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={75} />
                <ReTooltip contentStyle={{ backgroundColor: "rgba(20,20,33,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", padding: "10px 14px", fontSize: 12, color: "#e0e0e0" }} labelStyle={{ fontWeight: 600, color: "#fff", marginBottom: 4 }} />
                <Bar dataKey="value" name="Nodes" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function FactTab({ factPath }: { factPath: string }) {
  const [data, setData] = useState<FactDistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    metrics.factDistribution(factPath)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e: any) => { if (!cancelled) setError(e.message || 'Failed to load distribution'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [factPath]);

  if (loading) return <Center h={300}><Loader size="lg" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  return <DistributionCharts data={data} />;
}

export function MetricsFactDistPage() {
  const [activeTab, setActiveTab] = useState<string>(COMMON_FACTS[0].key);
  const [customFact, setCustomFact] = useState('');
  const [customData, setCustomData] = useState<FactDistData | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const fetchCustom = useCallback(async () => {
    const fact = customFact.trim();
    if (!fact) return;
    setCustomLoading(true);
    setCustomError(null);
    setCustomData(null);
    try {
      const result = await metrics.factDistribution(fact);
      setCustomData(result);
    } catch (e: any) {
      setCustomError(e.message || 'Failed to load distribution');
    }
    setCustomLoading(false);
  }, [customFact]);

  return (
    <Stack>
      <Group gap="sm">
        <IconChartPie size={28} />
        <Title order={2}>Fact Distribution Charts</Title>
      </Group>

      <Card withBorder shadow="sm" padding="lg">
        <Tabs value={activeTab} onChange={(v) => setActiveTab(v || COMMON_FACTS[0].key)}>
          <Tabs.List>
            {COMMON_FACTS.map((f) => (
              <Tabs.Tab key={f.key} value={f.key}>{f.label}</Tabs.Tab>
            ))}
          </Tabs.List>

          {COMMON_FACTS.map((f) => (
            <Tabs.Panel key={f.key} value={f.key} pt="md">
              <FactTab factPath={f.key} />
            </Tabs.Panel>
          ))}
        </Tabs>
      </Card>

      {/* Custom fact query */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Query Custom Fact</Title>
        <Group align="flex-end" mb="md">
          <TextInput
            label="Fact Path"
            placeholder="e.g., networking.ip, uptime_hours, os.architecture"
            leftSection={<IconSearch size={14} />}
            value={customFact}
            onChange={(e) => setCustomFact(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchCustom(); }}
            style={{ flex: 1, minWidth: 300 }}
          />
          <Text
            size="sm"
            fw={600}
            c="blue"
            style={{ cursor: 'pointer' }}
            onClick={fetchCustom}
          >
            Query
          </Text>
        </Group>

        {customLoading && <Center h={200}><Loader size="lg" /></Center>}
        {customError && <Alert color="red" title="Error">{customError}</Alert>}
        {customData && <DistributionCharts data={customData} />}
      </Card>
    </Stack>
  );
}
