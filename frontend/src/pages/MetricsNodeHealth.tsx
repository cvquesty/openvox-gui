/**
 * OpenVox GUI - MetricsNodeHealth.tsx
 *
 * Node Health page under Metrics.
 * Shows Puppet agent enabled/disabled status.
 *
 * Sources:
 *   - Custom fact `puppet_agent_disabled` (and optional message) from last successful run.
 *   - Report/fact timestamps for staleness inference.
 *   - Live Bolt checks (recommended for currently disabled nodes, since disabled
 *     agents do not run and therefore do not send updated facts/reports).
 *
 * The fact alone cannot perfectly reflect "current" disabled state (see docs).
 * Live checks via Bolt work over SSH and are independent of the agent.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Table, Button, TextInput, ScrollArea, Paper,
} from '@mantine/core';
import { IconHeartbeat, IconRefresh, IconSearch, IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-react';
import { metrics } from '../services/api';

interface NodeHealthEntry {
  certname: string;
  agent_disabled: boolean | null;
  disable_message?: string | null;
  facts_timestamp?: string;
  report_timestamp?: string;
  latest_report_status?: string;
  is_stale?: boolean;
  environment?: string;
}

interface LiveResult {
  disabled: boolean | null;
  message?: string;
  checked_at?: string;
  raw?: string | null;
  stderr?: string | null;
  exit_code?: number | null;
}

export function MetricsNodeHealthPage() {
  const [data, setData] = useState<any>(null);
  const [liveResults, setLiveResults] = useState<Record<string, LiveResult>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const result = await metrics.nodeHealth();
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load node health');
    }
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runLiveCheck = async () => {
    setChecking(true);
    try {
      // Use 'all' to check everything (Bolt will expand).
      // In production you may want to limit or do in batches for large fleets.
      const res = await metrics.nodeHealthCheck({ targets: 'all' });
      const newResults: Record<string, LiveResult> = {};
      const results = res.results || {};
      Object.keys(results).forEach((cn) => {
        const r = results[cn];
        if (cn === '_raw') return;
        newResults[cn] = {
          disabled: r.disabled,
          message: r.message,
          checked_at: r.checked_at,
          raw: r.raw,
          stderr: r.stderr,
          exit_code: r.exit_code,
        };
      });
      setLiveResults(newResults);
    } catch (e: any) {
      setError('Live check failed: ' + (e.message || e));
    }
    setChecking(false);
  };

  const clearLive = () => setLiveResults({});

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error">{error}</Alert>;
  if (!data) return null;

  const nodes: NodeHealthEntry[] = data.nodes || [];
  const summary = data.summary || {};

  const filtered = nodes
    .filter(n =>
      !search ||
      n.certname.toLowerCase().includes(search.toLowerCase()) ||
      (n.environment || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.certname.localeCompare(b.certname));

  const disabledNow = nodes.filter(n => n.agent_disabled === true).length;
  const withLiveDisabled = Object.keys(liveResults).filter(cn => liveResults[cn].disabled === true).length;

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <IconHeartbeat size={28} />
          <Title order={2}>Node Health</Title>
          <Badge color={disabledNow > 0 ? 'red' : 'green'} variant="filled" size="lg">
            {disabledNow} disabled (last known)
          </Badge>
          {withLiveDisabled > 0 && (
            <Badge color="orange" variant="filled" size="lg">
              {withLiveDisabled} disabled (live)
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={fetchData}
            loading={loading}
          >
            Refresh facts
          </Button>
          <Button
            size="xs"
            variant="filled"
            color="blue"
            leftSection={<IconAlertTriangle size={14} />}
            onClick={runLiveCheck}
            loading={checking}
          >
            Check Current Status (live via Bolt)
          </Button>
          {Object.keys(liveResults).length > 0 && (
            <Button size="xs" variant="subtle" color="gray" onClick={clearLive}>
              Clear live results
            </Button>
          )}
          <Text size="xs" c="dimmed">Updated {lastRefresh.toLocaleTimeString()}</Text>
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        Agent disabled status is primarily detected via the custom fact <code>puppet_agent_disabled</code>.
        Disabled agents do not run, so facts become stale (the "last known" column reflects the state from the most recent successful Puppet run). Use the live Bolt check (above) for current reality — it works over SSH even when the Puppet agent is disabled.
      </Text>

      {/* Summary */}
      <Group grow>
        <Paper withBorder p="sm" ta="center">
          <Text size="xs" c="dimmed">Total Nodes</Text>
          <Text size="xl" fw={700}>{summary.total ?? nodes.length}</Text>
        </Paper>
        <Paper withBorder p="sm" ta="center">
          <Text size="xs" c="dimmed">Disabled (fact)</Text>
          <Text size="xl" fw={700} c={disabledNow > 0 ? 'red' : 'green'}>{disabledNow}</Text>
        </Paper>
        <Paper withBorder p="sm" ta="center">
          <Text size="xs" c="dimmed">Stale reports</Text>
          <Text size="xl" fw={700}>{summary.stale ?? 0}</Text>
        </Paper>
        <Paper withBorder p="sm" ta="center">
          <Text size="xs" c="dimmed">Fact deployed?</Text>
          <Text size="xl" fw={700}>{summary.fact_deployed ? 'Yes' : 'No'}</Text>
        </Paper>
      </Group>

      {/* Search */}
      <TextInput
        placeholder="Filter nodes (name or env)..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="md"
      />

      {/* Table */}
      <Card withBorder shadow="sm" padding="0">
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Node</Table.Th>
                <Table.Th>Agent Status (last known)</Table.Th>
                <Table.Th>Disable Message</Table.Th>
                <Table.Th>Last Fact</Table.Th>
                <Table.Th>Last Report</Table.Th>
                <Table.Th>Live Status</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center">No matching nodes.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {filtered.map((n) => {
                // Robust live result lookup: exact, then case-insensitive, then base name match
                let live = liveResults[n.certname];
                if (!live) {
                  const lower = n.certname.toLowerCase();
                  live = Object.keys(liveResults).find(k => k.toLowerCase() === lower) 
                    ? liveResults[Object.keys(liveResults).find(k => k.toLowerCase() === lower)!]
                    : undefined;
                }
                if (!live) {
                  // try matching without domain (e.g. "agent2" vs "agent2.questy.org")
                  const base = n.certname.split('.')[0].toLowerCase();
                  const matchKey = Object.keys(liveResults).find(k => k.toLowerCase().startsWith(base + '.') || k.toLowerCase() === base);
                  if (matchKey) live = liveResults[matchKey];
                }

                let statusBadge;
                if (n.agent_disabled === true) {
                  statusBadge = <Badge color="red">Disabled</Badge>;
                } else if (n.agent_disabled === false) {
                  statusBadge = <Badge color="green">Enabled</Badge>;
                } else {
                  statusBadge = <Badge color="gray">Unknown (no fact)</Badge>;
                }

                let liveBadge: React.ReactNode = <Text size="xs" c="dimmed">—</Text>;
                if (live) {
                  if (live.disabled === true) {
                    liveBadge = <Badge color="red" variant="light">Disabled (live)</Badge>;
                  } else if (live.disabled === false) {
                    liveBadge = <Badge color="green" variant="light">Enabled (live)</Badge>;
                  } else {
                    // Show diagnostics when we couldn't get a clean DISABLED/ENABLED
                    const detail = (live.raw || live.stderr || 'no output').toString().slice(0, 80);
                    const title = [
                      live.raw ? `raw: ${live.raw}` : '',
                      live.stderr ? `stderr: ${live.stderr}` : '',
                      live.exit_code != null ? `exit=${live.exit_code}` : '',
                    ].filter(Boolean).join('\n') || undefined;
                    liveBadge = (
                      <Text size="xs" c="orange" style={{ cursor: title ? 'help' : 'default' }} title={title}>
                        {detail || 'check failed'}
                      </Text>
                    );
                  }
                }

                const note = n.is_stale ? 'Stale (no recent activity)' : '';

                return (
                  <Table.Tr key={n.certname}>
                    <Table.Td>{n.certname}</Table.Td>
                    <Table.Td>{statusBadge}</Table.Td>
                    <Table.Td>
                      {n.disable_message ? (
                        <Text size="xs" c="dimmed" style={{ maxWidth: 200, whiteSpace: 'pre-wrap' }}>
                          {n.disable_message}
                        </Text>
                      ) : (live && live.message) ? (
                        <Text size="xs" c="dimmed" style={{ maxWidth: 200, whiteSpace: 'pre-wrap' }} title="from live check">
                          {live.message}
                        </Text>
                      ) : '—'}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{n.facts_timestamp ? new Date(n.facts_timestamp).toLocaleString() : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{n.report_timestamp ? new Date(n.report_timestamp).toLocaleString() : '—'}</Text>
                      {n.latest_report_status && (
                        <Badge size="xs" variant="light" ml={4}>{n.latest_report_status}</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{liveBadge}</Table.Td>
                    <Table.Td>
                      {note && <Badge color="yellow" size="xs">{note}</Badge>}
                      {n.environment && <Text size="xs" c="dimmed">{n.environment}</Text>}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      {/* Help */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">Deploying the supporting fact</Title>
        <Text size="sm" c="dimmed">
          The openvox-gui installer and update scripts stage the fact at <code>/opt/openvox-gui/share/facts.d/puppet_agent_disabled</code>
          (executable bash, filename exactly <code>puppet_agent_disabled</code>).
          Copy it to your Puppet module's <code>facts.d/</code> (e.g. <code>site/profiles/facts.d/puppet_agent_disabled</code> or <code>site/profile/facts.d/</code>).
          The scripts detect the fact in common control-repo locations and suppress copy reminders when it is already present
          (for autoloading + pluginsync).
          Ensure mode 0755 in source and include via module autoload or a <code>file {}</code> resource in your base profile.
          See <code>docs/puppet-agent-disabled-fact.md</code> for full details. The fact (and at least one agent run) is required
          for the "last known" disabled status to appear.
        </Text>
        <Text size="sm" mt="xs">
          <strong>Why live checks?</strong> A disabled agent will not run Puppet, will not pluginsync, and will not send facts or reports.
          The live check uses Bolt over your configured transport (usually SSH) and does not depend on the Puppet agent process.
        </Text>
      </Card>
    </Stack>
  );
}
