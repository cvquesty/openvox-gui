/**
 * OpenVox GUI - MetricsPuppetDBHealth.tsx
 *
 * PuppetDB Health Dashboard — shows service status, JVM heap usage with
 * a color-coded progress bar, command queue stats, active node count,
 * and server time. Auto-refreshes every 10 seconds.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Progress, Grid,
} from '@mantine/core';
import { IconDatabase, IconRefresh } from '@tabler/icons-react';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

function heapColor(pct: number): string {
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'yellow';
  return 'green';
}

function formatUptime(serverTime: string | undefined): string {
  if (!serverTime) return '\u2014';
  try {
    return new Date(serverTime).toLocaleString();
  } catch {
    return serverTime;
  }
}

interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  description?: string;
}

function StatCard({ label, value, color, description }: StatCardProps) {
  return (
    <Card withBorder shadow="sm" padding="md" ta="center">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700} c={color}>{value}</Text>
      {description && <Text size="xs" c="dimmed" mt={2}>{description}</Text>}
    </Card>
  );
}

export function MetricsPuppetDBHealthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.puppetdbHealth();
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load PuppetDB health');
    }
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  // Initial fetch
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(fetchData, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const jvm = data.jvm_heap || {};
  const heapPct = jvm.pct ?? 0;
  const hColor = heapColor(heapPct);

  const statusColor = data.status === 'running' ? 'green' : 'red';

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconDatabase size={28} />
          <Title order={2}>PuppetDB Health</Title>
          <Badge
            color={statusColor}
            variant="filled"
            size="lg"
          >
            {data.status || 'unknown'}
          </Badge>
        </Group>
        <Group gap="xs">
          <IconRefresh size={14} style={{ opacity: 0.5 }} />
          <Text size="xs" c="dimmed">
            Auto-refresh 10s &middot; Updated {lastRefresh.toLocaleTimeString()}
          </Text>
          {error && <Badge color="orange" variant="light" size="sm">Refresh error</Badge>}
        </Group>
      </Group>

      {/* JVM Heap Usage */}
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" mb="xs">
          <Title order={4}>JVM Heap Usage</Title>
          <Badge color={hColor} variant="light" size="lg">{heapPct.toFixed(1)}%</Badge>
        </Group>
        <Progress
          value={heapPct}
          color={hColor}
          size="xl"
          radius="md"
          striped={heapPct >= 70}
          animated={heapPct >= 90}
        />
        <Group justify="space-between" mt="xs">
          <Text size="sm" c="dimmed">
            Used: {jvm.used_mb ?? 0} MB
          </Text>
          <Text size="sm" c="dimmed">
            Committed: {jvm.committed_mb ?? 0} MB
          </Text>
          <Text size="sm" c="dimmed">
            Max: {jvm.max_mb ?? 0} MB
          </Text>
        </Group>
      </Card>

      {/* Stat cards */}
      <Grid>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Queue Depth"
            value={data.queue_depth ?? 0}
            color={data.queue_depth > 100 ? 'red' : data.queue_depth > 10 ? 'yellow' : 'green'}
            description="Pending commands"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Processed"
            value={(data.processed ?? 0).toLocaleString()}
            color="blue"
            description="Total commands"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Retried"
            value={data.retried ?? 0}
            color={data.retried > 0 ? 'orange' : 'green'}
            description="Retry attempts"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Discarded"
            value={data.discarded ?? 0}
            color={data.discarded > 0 ? 'red' : 'green'}
            description="Dropped commands"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Active Nodes"
            value={data.active_nodes ?? 0}
            color="blue"
            description="Reporting in"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Server Time"
            value={data.server_time ? new Date(data.server_time).toLocaleTimeString() : '\u2014'}
            color="gray"
            description={data.server_time ? new Date(data.server_time).toLocaleDateString() : ''}
          />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
