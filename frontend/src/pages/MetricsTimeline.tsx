/**
 * OpenVox GUI - MetricsTimeline.tsx
 *
 * Resource Change Timeline — a scrollable event feed showing resource
 * changes across the fleet. Each event is displayed as a card with status
 * badges, resource info, timestamps, and corrective-change drift markers.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Select, ScrollArea,
} from '@mantine/core';
import { IconTimeline, IconAlertTriangle } from '@tabler/icons-react';
import { metrics } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  success: { color: 'green', label: 'Success' },
  failure: { color: 'red', label: 'Failure' },
  noop: { color: 'yellow', label: 'Noop' },
  skipped: { color: 'gray', label: 'Skipped' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
  { value: 'noop', label: 'Noop' },
  { value: 'skipped', label: 'Skipped' },
];

const LIMIT_OPTIONS = [
  { value: '50', label: '50 events' },
  { value: '100', label: '100 events' },
  { value: '200', label: '200 events' },
  { value: '500', label: '500 events' },
];

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function EventCard({ event }: { event: any }) {
  const badge = STATUS_BADGE[event.status] || { color: 'gray', label: event.status };

  return (
    <Card withBorder shadow="xs" padding="sm" radius="sm">
      <Group justify="space-between" mb={4}>
        <Group gap="xs">
          <Text size="sm" fw={700}>{event.certname}</Text>
          <Badge color={badge.color} variant="light" size="sm">{badge.label}</Badge>
          {event.corrective_change && (
            <Badge color="orange" variant="filled" size="sm" leftSection={<IconAlertTriangle size={10} />}>
              Drift
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">{formatTimestamp(event.timestamp)}</Text>
      </Group>

      <Text size="sm" fw={500} c="blue">
        {event.resource_type}[{event.resource_title}]
      </Text>

      {event.message && (
        <Text size="xs" c="dimmed" mt={4} lineClamp={3}>{event.message}</Text>
      )}

      {(event.old_value !== undefined || event.new_value !== undefined) && (
        <Group gap="xs" mt={4}>
          {event.old_value !== undefined && (
            <Text size="xs" c="red">
              <Text span fw={600}>old:</Text> {String(event.old_value)}
            </Text>
          )}
          {event.new_value !== undefined && (
            <Text size="xs" c="green">
              <Text span fw={600}>new:</Text> {String(event.new_value)}
            </Text>
          )}
        </Group>
      )}
    </Card>
  );
}

export function MetricsTimelinePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState('100');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { limit?: number; status?: string } = { limit: parseInt(limit) };
      if (status) params.status = status;
      const result = await metrics.events(params);
      setData(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load timeline events');
    }
    setLoading(false);
  }, [status, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const events = data.events || [];

  const statusCounts: Record<string, number> = {};
  let driftCount = 0;
  for (const ev of events) {
    statusCounts[ev.status] = (statusCounts[ev.status] || 0) + 1;
    if (ev.corrective_change) driftCount++;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconTimeline size={28} />
          <Title order={2}>Resource Change Timeline</Title>
        </Group>
        <Alert variant="light" color="blue" mb="xs">
          This page shows a real-time feed of every resource change across your entire fleet — what changed, when, on which node, and whether it was an intentional change or corrective drift. Use it to monitor fleet activity after a code deployment, investigate unexpected changes, or audit what Puppet modified during a specific time window.
        </Alert>
        <Group gap="sm">
          <Select
            size="sm"
            data={STATUS_OPTIONS}
            value={status}
            onChange={(v) => setStatus(v || '')}
            style={{ width: 150 }}
            placeholder="Filter status"
          />
          <Select
            size="sm"
            data={LIMIT_OPTIONS}
            value={limit}
            onChange={(v) => setLimit(v || '100')}
            style={{ width: 130 }}
          />
        </Group>
      </Group>

      {/* Summary badges */}
      <Group gap="xs">
        <Badge variant="light" color="blue" size="lg">{data.count ?? events.length} total</Badge>
        {Object.entries(statusCounts).map(([s, count]) => {
          const info = STATUS_BADGE[s] || { color: 'gray', label: s };
          return <Badge key={s} variant="light" color={info.color} size="lg">{count} {info.label}</Badge>;
        })}
        {driftCount > 0 && (
          <Badge variant="filled" color="orange" size="lg">{driftCount} Drift</Badge>
        )}
      </Group>

      {/* Event feed */}
      <ScrollArea h="calc(100vh - 260px)" mih={400}>
        <Stack gap="xs">
          {events.length === 0 ? (
            <Alert color="yellow">No events found for the selected filters.</Alert>
          ) : (
            events.map((event: any, idx: number) => (
              <EventCard key={idx} event={event} />
            ))
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
