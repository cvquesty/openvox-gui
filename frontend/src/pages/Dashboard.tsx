/**
 * OpenVox GUI - Dashboard.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Title, Grid, Card, Text, Group, RingProgress, Stack, Center,
  Alert, Badge, Tooltip, Table, ActionIcon, Select, Switch, Button,
} from '@mantine/core';
import { IconEye, IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { dashboard } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState, ErrorState } from '../components/StateComponents';
import { useAppTheme } from '../hooks/ThemeContext';
import type { NodeSummary } from '../types';
import { PageHeader } from '../components/PageHeader';
import { ExportActions } from '../components/ExportActions';
import { RowLink } from '../components/OpsTable';
import { STATUS_HEX, statusMantine } from '../utils/statusTheme';
import { isNeedsAttention } from '../utils/needsAttention';
import { MeasuredArea } from '../components/MeasuredChart';
import { isImplausibleFleetShrink } from '../utils/fleetGuard';
import { readSessionCache } from '../utils/sessionCache';
import { distinctNodeCount } from '../utils/fleetCounts';

const ATTENTION_EXPORT_COLS = [
  'certname',
  'status',
  'last_report',
  'report_timestamp',
];



/* ═══════════════════════════════════════════════════════════════
   COMMAND-CENTER-O-TRON 9000 — mission control cartoon
   ═══════════════════════════════════════════════════════════════ */
function CommandCenterOTron() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="cc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#cc-sky)" rx="8" />

      {/* Stars */}
      <circle cx="40" cy="15" r="1" fill="#fff" opacity="0.5" />
      <circle cx="120" cy="28" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="200" cy="10" r="1.1" fill="#fff" opacity="0.4" />
      <circle cx="320" cy="22" r="0.7" fill="#fff" opacity="0.6" />
      <circle cx="430" cy="12" r="1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="32" r="0.9" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Big mission control desk */}
      <rect x="60" y="130" width="400" height="80" fill="#3d4d5d" rx="6" stroke="#667788" strokeWidth="1.5" />

      {/* Monitor bank - left */}
      <rect x="80" y="55" width="90" height="72" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="85" y="60" width="80" height="55" fill="#0a1628" rx="2" />
      {/* Node status ring mock */}
      <circle cx="110" cy="82" r="16" fill="none" stroke="#44ff44" strokeWidth="4" strokeDasharray="30 70" strokeDashoffset="-10" />
      <circle cx="110" cy="82" r="16" fill="none" stroke="#ffaa22" strokeWidth="4" strokeDasharray="10 90" strokeDashoffset="-40" />
      <circle cx="110" cy="82" r="16" fill="none" stroke="#ff4444" strokeWidth="4" strokeDasharray="5 95" strokeDashoffset="-50" />
      <text x="110" y="86" textAnchor="middle" fill="#44ff88" fontSize="8" fontFamily="monospace" fontWeight="bold">5</text>
      <text x="148" y="72" fill="#888" fontSize="5" fontFamily="monospace">nodes</text>
      <text x="148" y="82" fill="#44ff44" fontSize="5" fontFamily="monospace">4 ok</text>
      <text x="148" y="92" fill="#ff4444" fontSize="5" fontFamily="monospace">1 fail</text>
      <text x="125" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">FLEET STATUS</text>

      {/* Monitor bank - center */}
      <rect x="185" y="42" width="150" height="85" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="190" y="47" width="140" height="68" fill="#0a1628" rx="2" />
      {/* Sparkline chart mock */}
      <polyline points="200,90 215,85 230,88 245,70 260,72 275,65 290,68 305,55 320,60"
        fill="none" stroke="#44ff88" strokeWidth="1.5" />
      <polyline points="200,95 215,92 230,96 245,88 260,90 275,85 290,92 305,80 320,82"
        fill="none" stroke="#ffaa22" strokeWidth="1" opacity="0.6" />
      <line x1="200" y1="100" x2="320" y2="100" stroke="#334455" strokeWidth="0.5" />
      <text x="260" y="62" textAnchor="middle" fill="#44aaff" fontSize="6" fontFamily="monospace">REPORT TRENDS</text>
      {/* Scanning line */}
      <line x1="200" y1="50" x2="200" y2="110" stroke="#44aaff" strokeWidth="0.5" opacity="0.5">
        <animate attributeName="x1" values="200;325;200" dur="4s" repeatCount="indefinite" />
        <animate attributeName="x2" values="200;325;200" dur="4s" repeatCount="indefinite" />
      </line>
      <text x="260" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">REPORT MONITOR</text>

      {/* Monitor bank - right */}
      <rect x="350" y="55" width="90" height="72" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <rect x="355" y="60" width="80" height="55" fill="#0a1628" rx="2" />
      {/* Server rack lines */}
      <rect x="362" y="65" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="69" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="380" y="72" fill="#44ff88" fontSize="5" fontFamily="monospace">puppetserver</text>
      <rect x="362" y="77" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="81" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <text x="380" y="84" fill="#44ff88" fontSize="5" fontFamily="monospace">puppetdb</text>
      <rect x="362" y="89" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="93" r="2" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.6s" />
      </circle>
      <text x="380" y="96" fill="#44ff88" fontSize="5" fontFamily="monospace">r10k</text>
      <rect x="362" y="101" width="66" height="8" fill="#334455" rx="1" />
      <circle cx="370" cy="105" r="2" fill="#44aaff" />
      <text x="380" y="108" fill="#44aaff" fontSize="5" fontFamily="monospace">bolt</text>
      <text x="395" y="122" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">SERVICES</text>

      {/* Console desk details */}
      <rect x="100" y="140" width="320" height="20" fill="#334455" rx="3" />
      <text x="260" y="154" textAnchor="middle" fill="#EC8622" fontSize="9" fontFamily="monospace" fontWeight="bold">COMMAND-CENTER-O-TRON 9000</text>

      {/* Status lights row */}
      <circle cx="120" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="135" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.15s" />
      </circle>
      <circle cx="150" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <circle cx="165" cy="175" r="4" fill="#44ff44">
        <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.45s" />
      </circle>
      <circle cx="180" cy="175" r="4" fill="#ffaa22" />
      <circle cx="195" cy="175" r="4" fill="#44aaff" />

      {/* Dial */}
      <circle cx="350" cy="180" r="15" fill="#334455" stroke="#667788" strokeWidth="1.5" />
      <line x1="350" y1="180" x2="350" y2="168" stroke="#EC8622" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" values="0 350 180;360 350 180" dur="6s" repeatCount="indefinite" />
      </line>
      <circle cx="350" cy="180" r="3" fill="#556677" />

      {/* Antenna with signal */}
      <line x1="260" y1="42" x2="260" y2="20" stroke="#667788" strokeWidth="2" />
      <circle cx="260" cy="16" r="4" fill="#EC8622" />
      <circle cx="260" cy="16" r="8" fill="none" stroke="#EC8622" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values="8;18;8" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Caption */}
      <text x="260" y="232" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">Mission Control</text>
      <text x="260" y="246" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">all systems nominal (probably)</text>
    </svg>
  );
}

function nodeTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const { isRobots } = useAppTheme();
  const navigate = useNavigate();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const pollMs = autoRefresh ? Math.max(10000, parseInt(refreshInterval, 10) * 1000) : undefined;
  const { data: dashData, loading, refreshing, error, refetch } = useApi<any>(
    dashboard.getData,
    [pollMs ?? 0],
    {
      cacheKey: 'openvox_dashboard_data_v3',
      cacheValidate: (d) => {
        if (d == null || (d as any).node_status == null) return false;
        const nodes = (d as any).nodes;
        const total = (d as any).node_status?.total;
        const hasNodes = (Array.isArray(nodes) && nodes.length > 0) || Number(total) > 0;
        const trends = (d as any).node_trends;
        if (hasNodes && Array.isArray(trends) && trends.length === 0) {
          return false;
        }
        if (!hasNodes) return false;
        const prev = readSessionCache<any>('openvox_dashboard_data_v3');
        if (prev && isImplausibleFleetShrink(d, prev)) return false;
        const prevTrends = Array.isArray(prev?.node_trends) ? prev.node_trends.length : 0;
        if (prevTrends >= 3 && Array.isArray(trends) && trends.length <= 1) return false;
        return true;
      },
      pollIntervalMs: pollMs,
    },
  );
  const [sortField, setSortField] = useState<string>('certname');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Defer the large casual SVG so ring + trends get the first paint slot
  const [showMascot, setShowMascot] = useState(false);

  useEffect(() => {
    if (!isRobots || !dashData) return;
    const t = window.setTimeout(() => setShowMascot(true), 0);
    return () => clearTimeout(t);
  }, [isRobots, dashData]);

  const nodeList: NodeSummary[] = dashData?.nodes || [];
  const ns = dashData?.node_status || { changed: 0, unchanged: 0, failed: 0, unreported: 0, noop: 0, total: 0 };

  const nodeTrends = useMemo(
    () =>
      (dashData?.node_trends || []).map((trend: any) => ({
        timestamp: trend.timestamp,
        unchanged: trend.unchanged || 0,
        changed: trend.changed || 0,
        failed: trend.failed || 0,
        noop: trend.noop || 0,
        unreported: trend.unreported || 0,
      })),
    [dashData?.node_trends],
  );

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Deduplicate by certname (case-insensitive) then sort.
  const dedupedNodes = useMemo(() => {
    const seen = new Set<string>();
    return nodeList.filter(n => {
      const key = n.certname.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [nodeList]);

  const sortedNodes = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...dedupedNodes].sort((a, b) => {
      const av = (a as any)[sortField] ?? '';
      const bv = (b as any)[sortField] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return dir * av.localeCompare(bv);
      }
      return dir * (av > bv ? 1 : av < bv ? -1 : 0);
    });
  }, [dedupedNodes, sortField, sortDir]);

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <IconSelector size={14} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };


  useEffect(() => {
    if (dashData) setLastRefresh(new Date());
  }, [dashData]);

  const attentionAll = useMemo(
    () => dedupedNodes.filter((n) => isNeedsAttention(n)),
    [dedupedNodes],
  );
  const attentionExportRows = useMemo(
    () =>
      attentionAll.map((n) => ({
        certname: n.certname,
        status: n.latest_report_status || 'unreported',
        last_report: nodeTimeAgo(n.report_timestamp),
        report_timestamp: n.report_timestamp || '',
      })),
    [attentionAll],
  );

  // Full-page spinner only on true cold start (no cache, no data yet)
  if (loading && !dashData) return <LoadingState label="Loading dashboard…" />;
  if (error && !dashData) {
    return <ErrorState title="Dashboard failed to load" message={error} onRetry={refetch} />;
  }
  if (!dashData) {
    return <ErrorState title="Dashboard has no data" message="Try again." onRetry={refetch} />;
  }

  // Center number is the node rows in this payload, not a stored total.
  // Status buckets are computed from that same deduped list on the server.
  const ringTotal = distinctNodeCount(dedupedNodes);
  const ringData = [
    { value: ringTotal ? (ns.unchanged / ringTotal) * 100 : 0, color: STATUS_HEX.unchanged, tooltip: `Unchanged: ${ns.unchanged}` },
    { value: ringTotal ? (ns.changed / ringTotal) * 100 : 0, color: STATUS_HEX.changed, tooltip: `Changed: ${ns.changed}` },
    { value: ringTotal ? (ns.failed / ringTotal) * 100 : 0, color: STATUS_HEX.failed, tooltip: `Failed: ${ns.failed}` },
    { value: ringTotal ? (ns.noop / ringTotal) * 100 : 0, color: STATUS_HEX.noop, tooltip: `Noop: ${ns.noop}` },
    { value: ringTotal ? (ns.unreported / ringTotal) * 100 : 0, color: STATUS_HEX.unreported, tooltip: `Unreported: ${ns.unreported}` },
  ].filter(d => d.value > 0);

  const attention = attentionAll.slice(0, 25);

  return (
    <Stack>
      <PageHeader
        title="Dashboard"
        description="Fleet at a glance. Charts and counts update in place — no full reload."
        live={autoRefresh}
        refreshing={refreshing}
        updatedAt={lastRefresh}
        extra={
          <Group gap="sm">
            <Select size="xs"
              data={[{value:'10',label:'10s'},{value:'30',label:'30s'},{value:'60',label:'1m'},{value:'300',label:'5m'}]}
              value={refreshInterval} onChange={(v) => setRefreshInterval(v || '30')}
              style={{ width: 78 }} />
            <Switch size="sm" label="Auto" checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)} />
          </Group>
        }
      />

      {dashData?.fleet_view?.source === 'last_good' && (
        <Alert color="yellow" variant="light" title="Showing last-good fleet">
          This console just probed {dashData.fleet_view.probe_count} node(s);
          keeping the last complete view ({dashData.fleet_view.shown_count} nodes)
          so a VIP flap cannot look like a one-node estate.
        </Alert>
      )}

      {/* Casual theme illustration — deferred one tick so ring/trends paint first */}
      {isRobots && showMascot && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <CommandCenterOTron />
        </Card>
      )}

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Node Status</Title>
            <Center>
              <RingProgress
                size={220}
                thickness={24}
                roundCaps
                label={
                  <Text ta="center" fw={700} size="xl">{ringTotal}</Text>
                }
                sections={ringData}
              />
            </Center>
            <Group justify="center" mt="md" gap="lg">
              {[
                { label: 'Unchanged', status: 'unchanged' },
                { label: 'Changed', status: 'changed' },
                { label: 'Failed', status: 'failed' },
                { label: 'Noop', status: 'noop' },
                { label: 'Unreported', status: 'unreported' },
              ].map((s) => (
                <Link
                  key={s.status}
                  to={`/nodes?status=${s.status}`}
                  className="ov-inline-link"
                  style={{ display: 'inline-flex' }}
                >
                  <Group gap={4}>
                    <Badge color={statusMantine(s.status)} size="xs" circle />
                    <Text size="xs" td="underline">{s.label}</Text>
                  </Group>
                </Link>
              ))}
            </Group>
            <Text size="xs" c="dimmed" ta="center" mt="xs">Click a status to open Nodes with that filter</Text>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Active Node Status Trends</Title>
            <Text size="xs" c="dimmed" mb="xs">Click a series in the legend or chart area → filtered Nodes list (sruiux2 P1-2 lite)</Text>
            {nodeTrends.length === 0 ? (
              <Center h={320}>
                <Text size="sm" c="dimmed">No report history in the last 48 hours yet.</Text>
              </Center>
            ) : (
            <MeasuredArea height={320}>
              {(width) => (
              <AreaChart
                width={width}
                height={320}
                data={nodeTrends}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gUnchanged" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ecc71" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2ecc71" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gChanged" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f39c12" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f39c12" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e74c3c" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#e74c3c" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gNoop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3498db" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3498db" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" strokeOpacity={0.5} />
                <XAxis dataKey="timestamp" tick={{ fontSize: 11, fill: '#8899aa' }}
                  tickFormatter={(v) => v?.includes('T') ? v.split('T')[1]?.substring(0, 5) : v?.slice(11) || v}
                  axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8899aa' }}
                  axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }} />
                <ReTooltip
                  contentStyle={{ backgroundColor: 'rgba(20,20,33,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', padding: '10px 14px', fontSize: 12, color: '#e0e0e0' }}
                  labelStyle={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8, cursor: 'pointer' }}
                  onClick={(e: any) => {
                    const key = String(e?.dataKey || '').toLowerCase();
                    if (key === 'failed' || key === 'changed' || key === 'unchanged' || key === 'noop') {
                      navigate(`/nodes?status=${key}`);
                    } else {
                      navigate('/nodes');
                    }
                  }}
                />
                <Area isAnimationActive={false} animationDuration={0} type="monotone" dataKey="unreported" stroke={STATUS_HEX.unreported} fill={STATUS_HEX.unreported} fillOpacity={0.1} strokeWidth={1} dot={false} style={{ cursor: 'pointer' }} onClick={() => navigate('/nodes?status=unreported')} />
                <Area isAnimationActive={false} animationDuration={0} type="monotone" dataKey="unchanged" stroke="#2ecc71" fill="url(#gUnchanged)" strokeWidth={1.5} dot={false} style={{ cursor: 'pointer' }} onClick={() => navigate('/nodes?status=unchanged')} />
                <Area isAnimationActive={false} animationDuration={0} type="monotone" dataKey="changed" stroke="#f39c12" fill="url(#gChanged)" strokeWidth={1.5} dot={false} style={{ cursor: 'pointer' }} onClick={() => navigate('/nodes?status=changed')} />
                <Area isAnimationActive={false} animationDuration={0} type="monotone" dataKey="failed" stroke="#e74c3c" fill="url(#gFailed)" strokeWidth={2} dot={false} style={{ cursor: 'pointer' }} onClick={() => navigate('/nodes?status=failed')} />
                <Area isAnimationActive={false} animationDuration={0} type="monotone" dataKey="noop" stroke="#3498db" fill="url(#gNoop)" strokeWidth={1.5} dot={false} style={{ cursor: 'pointer' }} onClick={() => navigate('/nodes?status=noop')} />
              </AreaChart>
              )}
            </MeasuredArea>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <Card withBorder shadow="sm" padding="lg" style={{ overflow: 'hidden' }}>
        <Group justify="space-between" mb="md">
          <div>
            <Title order={4}>Needs attention</Title>
            <Text size="xs" c="dimmed">
              Failed, unreported, or last report older than 24h
              {attentionAll.length > 25
                ? ` — table shows 25 of ${attentionAll.length}; CSV is the full list`
                : ''}
            </Text>
          </div>
          <Group gap="sm">
            <Badge variant="light" color="red" size="lg">{attentionAll.length}</Badge>
            <ExportActions
              results={attentionExportRows}
              columns={ATTENTION_EXPORT_COLS}
              filenameBase="needs-attention"
              variant="compact"
              showDownload
            />
            <Button size="xs" variant="subtle" onClick={() => navigate('/nodes?status=attention')}>
              All attention →
            </Button>
          </Group>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last report</Table.Th>
              <Table.Th style={{ width: 52 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {attention.map((node) => (
              <Table.Tr key={node.certname} className="ov-row-hit" style={{ cursor: 'pointer' }}>
                <Table.Td>
                  <RowLink to={`/nodes/${node.certname}`}>
                    <Text fw={500} size="sm">{node.certname}</Text>
                  </RowLink>
                </Table.Td>
                <Table.Td><StatusBadge status={node.latest_report_status} /></Table.Td>
                <Table.Td><Text size="sm">{nodeTimeAgo(node.report_timestamp)}</Text></Table.Td>
                <Table.Td>
                  <Tooltip label="View details">
                    <ActionIcon
                      variant="subtle"
                      aria-label={`View ${node.certname}`}
                      data-row-action
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/nodes/${node.certname}`);
                      }}
                    >
                      <IconEye size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {attention.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed" ta="center" py="md">Nothing on fire. Fleet looks clean.</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
