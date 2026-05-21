/**
 * OpenVox GUI - MetricsEnvironments.tsx
 *
 * Environment Comparison — time-series line chart showing node status
 * per environment over time. Accumulates in localStorage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Grid, Paper, Select,
} from '@mantine/core';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend,
} from 'recharts';
import { IconGitBranch, IconRefresh } from '@tabler/icons-react';
import { metrics } from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  unchanged: '#2ecc71',
  changed: '#0D6EFD',
  failed: '#e74c3c',
  noop: '#f39c12',
  unreported: '#95a5a6',
};

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px', fontSize: 12, color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff', marginBottom: 4 } as const,
  itemStyle: { color: '#e0e0e0' } as const,
};

const STORAGE_KEY = 'openvox_env_history';
const STORAGE_VER_KEY = 'openvox_env_history_v';
const HISTORY_VERSION = 1;
const MAX_POINTS = 240;

function loadHistory(): any[] {
  try {
    if (localStorage.getItem(STORAGE_VER_KEY) !== String(HISTORY_VERSION)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_VER_KEY, String(HISTORY_VERSION));
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHistory(pts: any[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pts)); } catch {}
}

interface EnvironmentData {
  name: string;
  total: number;
  changed: number;
  unchanged: number;
  failed: number;
  noop: number;
  unreported: number;
}

export function MetricsEnvironmentsPage() {
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>(loadHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.environments();
      setData(result);

      // Accumulate history point
      const envs: EnvironmentData[] = result.environments || [];
      const point: any = { time: new Date().toLocaleTimeString() };
      for (const env of envs) {
        point[`${env.name}_total`] = env.total;
        point[`${env.name}_unchanged`] = env.unchanged;
        point[`${env.name}_changed`] = env.changed;
        point[`${env.name}_failed`] = env.failed;
      }
      setHistory(prev => {
        const updated = [...prev, point];
        const trimmed = updated.length > MAX_POINTS ? updated.slice(-MAX_POINTS) : updated;
        saveHistory(trimmed);
        return trimmed;
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load environment data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(fetchData, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const environments: EnvironmentData[] = data.environments || [];
  const envNames = environments.map(e => e.name);
  const totalNodes = environments.reduce((sum, e) => sum + e.total, 0);
  const totalFailed = environments.reduce((sum, e) => sum + e.failed, 0);

  // Build per-environment charts or combined view
  const activeEnvs = selectedEnv ? [selectedEnv] : envNames;

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconGitBranch size={28} />
          <Title order={2}>Environment Comparison</Title>
          <Badge variant="light" size="lg">{environments.length} environments</Badge>
        </Group>
        <Group gap="xs">
          <Select size="xs" data={[{ value: '__all__', label: 'All Environments' }, ...envNames.map(n => ({ value: n, label: n }))]}
            value={selectedEnv || '__all__'} onChange={(v) => setSelectedEnv(v === '__all__' ? null : v)}
            style={{ width: 180 }} />
          <Text size="xs" c="dimmed"><IconRefresh size={12} /> 30s</Text>
        </Group>
      </Group>

      {/* Summary stats */}
      <Group grow>
        {environments.map(env => (
          <Paper key={env.name} withBorder p="sm" ta="center"
            style={{ cursor: 'pointer', border: selectedEnv === env.name ? '2px solid #0D6EFD' : undefined }}
            onClick={() => setSelectedEnv(selectedEnv === env.name ? null : env.name)}>
            <Text size="xs" c="dimmed" fw={700}>{env.name}</Text>
            <Text size="lg" fw={700}>{env.total} nodes</Text>
            <Group justify="center" gap={4} mt={2}>
              <Badge size="xs" color="green" variant="light">{env.unchanged}</Badge>
              <Badge size="xs" color="blue" variant="light">{env.changed}</Badge>
              {env.failed > 0 && <Badge size="xs" color="red" variant="filled">{env.failed}</Badge>}
            </Group>
          </Paper>
        ))}
      </Group>

      {/* Per-environment time-series charts */}
      {activeEnvs.map(envName => (
        <Card key={envName} withBorder shadow="sm" padding="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{envName} — Node Status Over Time</Title>
            <Text size="xs" c="dimmed">{history.length} data points</Text>
          </Group>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={history} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8899aa' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8899aa' }} allowDecimals={false} />
              <ReTooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area type="natural" dataKey={`${envName}_unchanged`} stroke={STATUS_COLORS.unchanged} fill="none" strokeWidth={2} dot={false} connectNulls name="Unchanged" />
              <Area type="natural" dataKey={`${envName}_changed`} stroke={STATUS_COLORS.changed} fill="none" strokeWidth={2} dot={false} connectNulls name="Changed" />
              <Area type="natural" dataKey={`${envName}_failed`} stroke={STATUS_COLORS.failed} fill="none" strokeWidth={2} dot={false} connectNulls name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
          {history.length < 3 && (
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              Chart populates as data is collected (one point every 30 seconds)
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  );
}
