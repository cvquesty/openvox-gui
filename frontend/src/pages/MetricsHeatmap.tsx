/**
 * OpenVox GUI - MetricsHeatmap.tsx
 *
 * Node Status Heatmap — colored grid of nodes grouped by environment.
 * Green = unchanged, Blue = changed, Red = failed, Yellow = noop, Gray = unreported.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Tooltip,
  Paper, ScrollArea, Select,
} from '@mantine/core';
import { IconLayoutGrid } from '@tabler/icons-react';
import { metrics } from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  unchanged: '#28a745',
  changed: '#0D6EFD',
  failed: '#dc3545',
  noop: '#ffc107',
  unreported: '#6c757d',
};

const STATUS_LABELS: Record<string, string> = {
  unchanged: 'Unchanged',
  changed: 'Changed',
  failed: 'Failed',
  noop: 'Noop',
  unreported: 'Unreported',
};

interface HeatmapNode {
  certname: string;
  status: string;
  environment: string;
  report_timestamp: string;
  corrective: boolean;
}

export function MetricsHeatmapPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await metrics.heatmap();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load heatmap data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error loading heatmap">{error}</Alert>;
  if (!data) return null;

  const allNodes: HeatmapNode[] = data.nodes || [];

  // Extract unique environments
  const environments = [...new Set(allNodes.map((n) => n.environment))].sort();

  // Filter by environment
  const filteredNodes = envFilter
    ? allNodes.filter((n) => n.environment === envFilter)
    : allNodes;

  // Group by environment
  const grouped: Record<string, HeatmapNode[]> = {};
  for (const node of filteredNodes) {
    const env = node.environment || 'unknown';
    if (!grouped[env]) grouped[env] = [];
    grouped[env].push(node);
  }

  // Status counts
  const statusCounts: Record<string, number> = {};
  for (const node of filteredNodes) {
    const s = node.status || 'unreported';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...environments.map((e) => ({ value: e, label: e })),
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconLayoutGrid size={28} />
          <Title order={2}>Node Status Heatmap</Title>
          <Badge variant="light" size="lg">{filteredNodes.length} nodes</Badge>
        </Group>
        <Select
          placeholder="Filter environment"
          data={envOptions}
          value={envFilter || ''}
          onChange={(v) => setEnvFilter(v || null)}
          clearable
          style={{ width: 200 }}
        />
      </Group>

      {/* Status legend */}
      <Paper withBorder p="sm">
        <Group gap="lg">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <Group gap={6} key={key}>
              <div style={{
                width: 16, height: 16, borderRadius: 3,
                backgroundColor: STATUS_COLORS[key],
              }} />
              <Text size="sm">{label}: {statusCounts[key] || 0}</Text>
            </Group>
          ))}
        </Group>
      </Paper>

      {/* Heatmap grid by environment */}
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([env, envNodes]) => (
        <Card withBorder shadow="sm" padding="lg" key={env}>
          <Group mb="sm" gap="sm">
            <Title order={4}>{env}</Title>
            <Badge variant="light">{envNodes.length} nodes</Badge>
          </Group>
          <ScrollArea>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}>
              {envNodes
                .sort((a, b) => a.certname.localeCompare(b.certname))
                .map((node) => {
                  const status = node.status || 'unreported';
                  const color = STATUS_COLORS[status] || STATUS_COLORS.unreported;
                  const timeAgo = node.report_timestamp
                    ? new Date(node.report_timestamp).toLocaleString()
                    : 'No report';

                  return (
                    <Tooltip
                      key={node.certname}
                      label={
                        <div>
                          <Text size="xs" fw={700}>{node.certname}</Text>
                          <Text size="xs">Status: {STATUS_LABELS[status] || status}</Text>
                          <Text size="xs">Last report: {timeAgo}</Text>
                          {node.corrective && (
                            <Text size="xs" c="orange">Corrective change</Text>
                          )}
                        </div>
                      }
                      withArrow
                      multiline
                      w={250}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          backgroundColor: color,
                          cursor: 'pointer',
                          border: node.corrective ? '2px solid #fd7e14' : '1px solid rgba(0,0,0,0.1)',
                          transition: 'transform 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.3)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                        }}
                      />
                    </Tooltip>
                  );
                })}
            </div>
          </ScrollArea>
        </Card>
      ))}

      {filteredNodes.length === 0 && (
        <Center h={200}>
          <Text c="dimmed" size="lg">No nodes found</Text>
        </Center>
      )}
    </Stack>
  );
}
