/**
 * OpenVox GUI - Nodes.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useMemo } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useNavigate } from 'react-router';
import {
  Title, Table, Card, TextInput, Stack, Group, Text, Alert,
  ActionIcon, Tooltip, Collapse, ScrollArea, Box,
} from '@mantine/core';
import { IconSearch, IconEye, IconChevronDown, IconChevronRight, IconPlayerPlay, IconLink, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useApi } from '../hooks/useApi';
import { nodes, bolt } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState, ErrorState } from '../components/StateComponents';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpsTable, OpsColumn } from '../components/OpsTable';
import { ExportActions } from '../components/ExportActions';
import { FilterBar } from '../components/FilterBar';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useActivity } from '../hooks/ActivityContext';
import { useSkipAdhocConfirm } from '../hooks/useSkipAdhocConfirm';
import { useAppTheme } from '../hooks/ThemeContext';
import type { NodeSummary } from '../types';
import { timeAgo } from '../utils/timeAgo';
import { isNeedsAttention } from '../utils/needsAttention';
import { PageHeader } from '../components/PageHeader';
import { isPuppetAgentSuccess } from '../utils/puppetAgentExit';
import { CACHE_NODES } from '../utils/cacheKeys';
import { isImplausibleFleetShrink } from '../utils/fleetGuard';
import { readSessionCache } from '../utils/sessionCache';

/** Columns for All Nodes export (CSV / JSON / text) — mirrors Inventory ExportActions. */
const NODES_EXPORT_COLS = [
  'certname',
  'latest_report_status',
  'report_environment',
  'report_timestamp',
];

/* ═══════════════════════════════════════════════════════════════════════════════
   NODE-O-VISION 6000 — the server rack X-ray machine
   ═══════════════════════════════════════════════════════════════════════════════ */
function NodeOVision() {
  return (
    <svg viewBox="0 0 520 220" width="100%" style={{ maxHeight: 240 }}>
      <defs>
        <linearGradient id="nv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="220" fill="url(#nv-sky)" rx="8" />

      {/* Stars */}
      <circle cx="30" cy="15" r="1" fill="#fff" opacity="0.5" />
      <circle cx="170" cy="22" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="350" cy="12" r="1.1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="20" r="0.7" fill="#fff" opacity="0.5" />

      {/* Ground */}
      <rect x="0" y="185" width="520" height="35" fill="#1a1a2e" />
      <rect x="0" y="185" width="520" height="2" fill="#333355" />

      {/* Server rack 1 */}
      <rect x="40" y="70" width="50" height="110" fill="#3d4d5d" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="45" y="76" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="82" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="85" fill="#44ff88" fontSize="5" fontFamily="monospace">web01</text>
      <rect x="45" y="92" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="98" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <text x="60" y="101" fill="#44ff88" fontSize="5" fontFamily="monospace">web02</text>
      <rect x="45" y="108" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="114" r="2.5" fill="#ffaa22" />
      <text x="60" y="117" fill="#ffaa44" fontSize="5" fontFamily="monospace">web03</text>
      <rect x="45" y="124" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="130" r="2.5" fill="#ff4444">
        <animate attributeName="fill" values="#ff4444;#cc2222;#ff4444" dur="1s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="133" fill="#ff6666" fontSize="5" fontFamily="monospace">web04</text>
      <rect x="45" y="140" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="146" r="2.5" fill="#44ff44" />
      <text x="60" y="149" fill="#44ff88" fontSize="5" fontFamily="monospace">web05</text>

      {/* Server rack 2 */}
      <rect x="110" y="85" width="50" height="95" fill="#3d4d5d" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="115" y="91" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="97" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <text x="130" y="100" fill="#44ff88" fontSize="5" fontFamily="monospace">db01</text>
      <rect x="115" y="107" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="113" r="2.5" fill="#44ff44" />
      <text x="130" y="116" fill="#44ff88" fontSize="5" fontFamily="monospace">db02</text>
      <rect x="115" y="123" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="129" r="2.5" fill="#44aaff" />
      <text x="130" y="132" fill="#44aaff" fontSize="5" fontFamily="monospace">db03</text>

      {/* Scanning beam across the racks */}
      <rect x="35" y="75" width="130" height="2" fill="#44aaff" opacity="0.6">
        <animate attributeName="y" values="75;175;75" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Central monitor */}
      <rect x="200" y="50" width="120" height="90" fill="#223344" rx="5" stroke="#445566" strokeWidth="1.5" />
      <rect x="208" y="58" width="104" height="65" fill="#0a1628" rx="3" />
      {/* Monitor content */}
      <text x="260" y="72" textAnchor="middle" fill="#44aaff" fontSize="6" fontFamily="monospace">FLEET OVERVIEW</text>
      <line x1="215" y1="76" x2="305" y2="76" stroke="#334455" strokeWidth="0.5" />
      <text x="218" y="86" fill="#44ff44" fontSize="5" fontFamily="monospace">{"\u25CF"} 7 online</text>
      <text x="218" y="95" fill="#ffaa22" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 changed</text>
      <text x="218" y="104" fill="#ff4444" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 failed</text>
      <text x="218" y="113" fill="#44aaff" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 noop</text>
      {/* Blinking cursor */}
      <rect x="218" y="117" width="4" height="1" fill="#44ff88">
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
      </rect>
      {/* Monitor stand */}
      <rect x="250" y="140" width="20" height="10" fill="#445566" />
      <rect x="240" y="148" width="40" height="4" fill="#556677" rx="2" />

      {/* Label */}
      <rect x="210" y="155" width="100" height="14" fill="#334455" rx="2" />
      <text x="260" y="165" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">NODE-O-VISION 6000</text>

      {/* Network connections (right side) */}
      <rect x="370" y="60" width="120" height="75" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="430" y="75" textAnchor="middle" fill="#888" fontSize="6" fontFamily="monospace">CONNECTIONS</text>
      <line x1="377" y1="79" x2="483" y2="79" stroke="#334455" strokeWidth="0.5" />
      {/* Network lines with data flowing */}
      <line x1="385" y1="90" x2="470" y2="90" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="90" r="2" fill="#44ff44">
        <animate attributeName="cx" values="385;470;385" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="475" y="93" fill="#667788" fontSize="5" fontFamily="monospace">SSH</text>

      <line x1="385" y1="103" x2="470" y2="103" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="103" r="2" fill="#44aaff">
        <animate attributeName="cx" values="385;470;385" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <text x="475" y="106" fill="#667788" fontSize="5" fontFamily="monospace">PDB</text>

      <line x1="385" y1="116" x2="470" y2="116" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="116" r="2" fill="#ffaa22">
        <animate attributeName="cx" values="385;470;385" dur="3s" repeatCount="indefinite" begin="1s" />
      </circle>
      <text x="475" y="119" fill="#667788" fontSize="5" fontFamily="monospace">API</text>

      {/* Caption */}
      <text x="260" y="198" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Fleet Scanner</text>
      <text x="260" y="212" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">watching your servers so you don't have to</text>
    </svg>
  );
}

// Grouped nodes interface
interface GroupedNodes {
  [groupName: string]: {
    nodes: NodeSummary[];
  };
}

export function NodesPage() {
  const { isRobots } = useAppTheme();
  const { values, setFilter, copyLink } = useUrlFilters(['q', 'status']);
  const search = values.q;
  const setSearch = (v: string) => setFilter('q', v);
  const statusFilter = values.status || null;
  const setStatusFilter = (v: string | null) => setFilter('status', v || '');

  /**
   * Advanced client-side search supporting boolean-style exclusion.
   *
   * Syntax (space-separated):
   *   foo bar         → certname or env contains "foo" OR "bar"
   *   -atlc -pdxc     → exclude nodes containing "atlc" OR "pdxc" (i.e. everything except those)
   *   web prod -test  → (web OR prod) AND not "test"
   *   !foo            → also supported as negation
   *
   * This runs entirely client-side on the already-loaded fleet list so you
   * can create arbitrary filtered views (e.g. "all production nodes except
   * the ones in the atlc/pdxc labs").
   */
  const matchesNodeFilters = (n: NodeSummary) => {
    const cert = (n.certname || '').toLowerCase();
    // Prefer ENC environment (classification source of truth) over reported one
    const env = ((n as any).enc_environment || n.report_environment || '').toLowerCase();
    const fields = [cert, env].filter(Boolean);

    if (statusFilter) {
      const raw = (n.latest_report_status || '').toLowerCase();
      const st = raw || 'unreported';
      const want = statusFilter.toLowerCase();
      if (want === 'attention') {
        if (!isNeedsAttention(n)) return false;
      } else if (st !== want) {
        return false;
      }
    }

    if (!search) return true;

    const tokens = search.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;

    const positives: string[] = [];
    const negatives: string[] = [];

    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (lower.startsWith('-') || lower.startsWith('!')) {
        negatives.push(lower.replace(/^[-!]+/, ''));
      } else {
        positives.push(lower);
      }
    }

    // Any negative match → exclude this node
    for (const neg of negatives) {
      if (fields.some(f => f.includes(neg))) {
        return false;
      }
    }

    // Positives: match ANY (OR). This feels natural for certname fragments.
    // Negatives always act as "exclude if it matches any of these".
    if (positives.length > 0) {
      const matchesAnyPositive = positives.some(pos =>
        fields.some(f => f.includes(pos))
      );
      if (!matchesAnyPositive) return false;
    }

    return true;
  };
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [runningCert, setRunningCert] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const { data: nodeList, loading: nodesLoading, error: nodesError, refetch, refreshing } = useApi<NodeSummary[]>(
    nodes.list,
    [],
    {
      cacheKey: CACHE_NODES,
      cacheValidate: (rows) => {
        if (!Array.isArray(rows) || rows.length === 0) return false;
        const prev = readSessionCache<NodeSummary[]>(CACHE_NODES);
        if (prev && isImplausibleFleetShrink(rows, prev)) return false;
        return true;
      },
      pollIntervalMs: 20000,
    },
  );
  const navigate = useNavigate();
  const { user } = useAuth();
  const canPlay = !!user && (user.role === 'admin' || user.role === 'operator');
  const { begin, end } = useActivity();
  const skipConfirm = useSkipAdhocConfirm();

  const loading = nodesLoading;
  const error = nodesError;

  const runOpenVox = async (certname: string) => {
    setRunTarget(null);
    setRunningCert(certname);
    const actId = begin(`Run OpenVox: ${certname}`, { href: `/nodes/${certname}` });
    try {
      const r = await bolt.runCommand({
        command: '/opt/puppetlabs/bin/puppet agent -t',
        targets: certname,
        run_as: 'root',
        format: 'json',
      });
      const ok = isPuppetAgentSuccess(r.returncode);
      end(actId, ok ? 'done' : 'error', `exit ${r.returncode}`);
      // Prefer a short human summary — raw Bolt human text says "Failed on… exit 2" even on success
      const failDetail = (r.error || r.output || `Exit code ${r.returncode} on ${certname}`)
        .replace(/\x00/g, '')
        .replace(/CLI arguments[\s\S]*?\[ID: cli_overrides\]\s*/gi, '')
        .slice(0, 800);
      notifications.show({
        title: ok ? 'OpenVox Run Complete' : 'OpenVox Run Failed',
        message: ok
          ? (r.returncode === 2
            ? `Changes applied on ${certname} (Puppet exit 2 = success)`
            : `No changes on ${certname}`)
          : failDetail,
        color: ok ? 'green' : 'red',
        autoClose: ok ? 6000 : 12000,
      });
      // Newest-report overlay + live-run can take a beat to land
      refetch();
      window.setTimeout(() => refetch(), 2000);
      window.setTimeout(() => refetch(), 8000);
    } catch (e: any) {
      end(actId, 'error', e.message);
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setRunningCert(null);
  };

  // Build grouped nodes by node groups
  // Classification data (enc_groups, enc_environment) is attached server-side
  // from the single ENC source of truth. Overview | Nodes no longer has a
  // separate direct reference to /enc/hierarchy for the node list.
  const groupedNodes: GroupedNodes = useMemo(() => {
    if (!nodeList) return {};

    const groups: GroupedNodes = {};

    // Build group → nodes map from the enc_groups attached to nodes
    const groupNodes: Record<string, NodeSummary[]> = {};

    nodeList.forEach((node: NodeSummary) => {
      const nodeGroups: string[] = (node as any).enc_groups || [];
      if (nodeGroups.length > 0) {
        nodeGroups.forEach((g: string) => {
          if (!groupNodes[g]) groupNodes[g] = [];
          // Avoid duplicates
          if (!groupNodes[g].some((n) => n.certname === node.certname)) {
            groupNodes[g].push(node);
          }
        });
      } else {
        // Node without explicit group
        if (!groupNodes["Ungrouped"]) groupNodes["Ungrouped"] = [];
        if (!groupNodes["Ungrouped"].some((n) => n.certname === node.certname)) {
          groupNodes["Ungrouped"].push(node);
        }
      }
    });

    // If no groups at all, "All Nodes"
    if (Object.keys(groupNodes).length === 0 && nodeList.length > 0) {
      groupNodes["All Nodes"] = [...nodeList];
    }

    Object.entries(groupNodes).forEach(([groupName, nodeArr]) => {
      groups[groupName] = { nodes: nodeArr };
    });

    return groups;
  }, [nodeList]);

  // Unclassified = nodes in the live fleet that have no ENC classification attached
  const unclassifiedNodes = useMemo(() => {
    if (!nodeList) return [];
    return nodeList
      .filter((node) => !(node as any).enc_environment)
      .sort((a, b) => a.certname.localeCompare(b.certname));
  }, [nodeList]);

  // Filter groups and nodes by search + status chips (sruiux2 P1-1 FilterBar)
  const filteredGroups = useMemo(() => {
    if (!search && !statusFilter) return groupedNodes;
    const searchLower = (search || '').toLowerCase();
    const filtered: GroupedNodes = {};
    Object.entries(groupedNodes).forEach(([groupName, data]) => {
      const matchingNodes = data.nodes.filter(matchesNodeFilters);
      if (
        (searchLower && groupName.toLowerCase().includes(searchLower) && matchingNodes.length === data.nodes.length) ||
        matchingNodes.length > 0
      ) {
        filtered[groupName] = { nodes: matchingNodes };
      }
    });
    return filtered;
  }, [groupedNodes, search, statusFilter]);

  // Filter unclassified nodes
  const filteredUnclassified = useMemo(
    () => unclassifiedNodes.filter(matchesNodeFilters),
    [unclassifiedNodes, search, statusFilter]
  );

  // All nodes filtered (for the All Nodes section)
  const filtered = useMemo(() => {
    if (!nodeList) return [];
    return nodeList.filter(matchesNodeFilters);
  }, [nodeList, search, statusFilter]);

  // Plain rows for ExportActions (current search/status filters, same set as OpsTable)
  const allNodesExportRows = useMemo(
    () =>
      filtered.map((n) => ({
        certname: n.certname,
        latest_report_status: n.latest_report_status ?? '',
        report_environment: n.report_environment ?? '',
        report_timestamp: n.report_timestamp ?? '',
      })),
    [filtered]
  );

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  if (loading && !nodeList) return <LoadingState label="Loading nodes…" />;
  if (error && !nodeList) {
    return <ErrorState title="Failed to load nodes" message={error} onRetry={refetch} />;
  }

  const groupNames = Object.keys(filteredGroups);
  const classifiedCount = Object.values(filteredGroups).reduce((sum, g) => sum + g.nodes.length, 0);
  const totalNodes = classifiedCount + filteredUnclassified.length;

  const dismissGhost = async (certname: string) => {
    setDismissing(true);
    try {
      await nodes.dismiss(certname);
      notifications.show({
        title: 'Removed',
        message: `'${certname}' hidden from Unclassified and fleet lists.`,
        color: 'green',
      });
      setDismissTarget(null);
      refetch();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setDismissing(false);
  };

  const actionCell = (node: NodeSummary, opts?: { ghost?: boolean }) => (
    <Group gap={4} onClick={(e) => e.stopPropagation()}>
      {canPlay && (
      <Tooltip label="Run OpenVox (puppet agent -t as root)">
        <ActionIcon
          variant="subtle"
          color="green"
          loading={runningCert === node.certname}
          onClick={() => (skipConfirm ? runOpenVox(node.certname) : setRunTarget(node.certname))}
        >
          <IconPlayerPlay size={18} />
        </ActionIcon>
      </Tooltip>
      )}
      {opts?.ghost && canPlay && (
        <Tooltip label="Remove ghost (host gone)">
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={() => setDismissTarget(node.certname)}
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="View details">
        <ActionIcon variant="subtle" onClick={() => navigate(`/nodes/${node.certname}`)}>
          <IconEye size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  return (
    <Stack>
      <PageHeader
        title={`Nodes (${totalNodes})`}
        description="Fleet membership from OpenVoxDB ∩ signed CA. Status is the newest report per certname."
        live
        refreshing={refreshing}
      />
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search certname/env (-foo to exclude)…"
        status={statusFilter}
        onStatusChange={setStatusFilter}
        hint="Advanced search: space = OR match on certname or environment. Prefix with - or ! to exclude (e.g. -atlc -pdxc). Shareable via URL (?q=&status=)."
        rightSection={
          <Tooltip label="Copy link to this filtered view">
            <ActionIcon
              variant="light"
              onClick={async () => {
                try {
                  await copyLink();
                  notifications.show({ message: 'Link copied', color: 'green' });
                } catch {
                  notifications.show({ message: 'Copy failed', color: 'red' });
                }
              }}
            >
              <IconLink size={18} />
            </ActionIcon>
          </Tooltip>
        }
      />

      <ConfirmModal
        opened={!!runTarget && !skipConfirm}
        onClose={() => setRunTarget(null)}
        onConfirm={() => runTarget && runOpenVox(runTarget)}
        title="Run OpenVox agent?"
        body="Runs puppet agent -t as root via Bolt/sudo on this node."
        details={runTarget ? [runTarget] : undefined}
        confirmLabel="Run agent"
        confirmColor="green"
        loading={!!runningCert}
      />
      <ConfirmModal
        opened={!!dismissTarget}
        onClose={() => !dismissing && setDismissTarget(null)}
        onConfirm={() => dismissTarget && dismissGhost(dismissTarget)}
        title="Remove ghost node?"
        body={`Hide '${dismissTarget}' from Unclassified and the live fleet lists. Use this when the host no longer exists.`}
        details={dismissTarget ? [dismissTarget] : undefined}
        confirmLabel="Remove ghost"
        danger
        loading={dismissing}
      />

      {/* Casual illustration */}
      {isRobots && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <NodeOVision />
        </Card>
      )}

      {/* Classified nodes */}
      <Title order={4}>Classified Nodes ({classifiedCount})</Title>
      {groupNames.length === 0 ? (
        <Card withBorder shadow="sm">
          <Text c="dimmed" ta="center">No classified nodes found</Text>
        </Card>
      ) : (
        <Stack gap="md">
          {groupNames.map((groupName) => {
            const groupData = filteredGroups[groupName];
            const { nodes: groupNodes } = groupData;
            const isExpanded = expandedGroups[groupName] ?? false;

            return (
              <Card key={groupName} withBorder shadow="sm" style={{ overflow: 'hidden' }}>
                <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => toggleGroup(groupName)}>
                  <Group>
                    <ActionIcon variant="subtle" size="sm">
                      {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </ActionIcon>
                    <Text fw={700}>{groupName}</Text>
                    <Text c="dimmed" size="sm">({groupNodes.length} node{groupNodes.length !== 1 ? 's' : ''})</Text>
                  </Group>
                </Group>
                <Collapse expanded={isExpanded}>
                  <ScrollArea h={480} mt="sm" type="auto" offsetScrollbars scrollbarSize={6}>
                    <Table striped highlightOnHover withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Certname</Table.Th>
                              <Table.Th>Status</Table.Th>
                              <Table.Th>Environment</Table.Th>
                              <Table.Th>Last Report</Table.Th>
                              <Table.Th>Actions</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {groupNodes.length === 0 ? (
                              <Table.Tr>
                                <Table.Td colSpan={5}><Text c="dimmed" ta="center">No nodes for this group</Text></Table.Td>
                              </Table.Tr>
                            ) : (
                              groupNodes.map((node) => (
                                <Table.Tr
                                  key={node.certname}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => navigate(`/nodes/${node.certname}`)}
                                >
                                  <Table.Td><Text fw={500}>{node.certname}</Text></Table.Td>
                                  <Table.Td>
                                    <Tooltip
                                      multiline
                                      maw={420}
                                      label={
                                        [
                                          `Badge = newest report for this certname (receive_time).`,
                                          `shown: ${node.latest_report_status || 'unreported'}`,
                                          `source: ${node.status_source || 'node_index'}`,
                                          node.node_index_status
                                            ? `node index: ${node.node_index_status}`
                                            : null,
                                          node.report_producer
                                            ? `compiled by: ${node.report_producer}`
                                            : null,
                                          node.cached_catalog_status
                                            ? `cached catalog: ${node.cached_catalog_status}`
                                            : null,
                                          node.latest_report_hash
                                            ? `hash: ${node.latest_report_hash}`
                                            : null,
                                          node.report_timestamp
                                            ? `time: ${node.report_timestamp}`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join('\n')
                                      }
                                    >
                                      <span>
                                        <StatusBadge status={node.latest_report_status} />
                                      </span>
                                    </Tooltip>
                                  </Table.Td>
                                  <Table.Td>{(node as any).enc_environment || node.report_environment || '\u2014'}</Table.Td>
                                  <Table.Td>{timeAgo(node.report_timestamp)}</Table.Td>
                                  <Table.Td>{actionCell(node)}</Table.Td>
                                </Table.Tr>
                              ))
                            )}
                          </Table.Tbody>
                        </Table>
                  </ScrollArea>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* All nodes — OpsTable (sruiux2 P0-2: sort + paginate) + Inventory-style export */}
      <Group justify="space-between" align="center">
        <Title order={4}>All Nodes ({filtered.length})</Title>
        <ExportActions
          results={allNodesExportRows}
          filenameBase="nodes"
          variant="compact"
          showDownload
          columns={NODES_EXPORT_COLS}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Export uses the current search and status filters (same rows as the table below).
      </Text>
      {filtered.length > 200 && (
        <Alert color="yellow" variant="light">
          Large fleet ({filtered.length} nodes loaded client-side). Use search and OpsTable page size; further server-side paging is planned in later 3.10.04 slices.
        </Alert>
      )}
      <Card withBorder shadow="sm" padding="lg" style={{ overflow: 'hidden' }}>
        <OpsTable<NodeSummary>
          data={filtered}
          rowKey={(n) => n.certname}
          defaultPageSize={100}
          maxHeight="calc(100vh - 320px)"
          emptyTitle="No nodes found"
          emptyDescription={search ? 'No nodes match the current search.' : 'No nodes reported to PuppetDB yet.'}
          onRowClick={(n) => navigate(`/nodes/${n.certname}`)}
          columns={[
            {
              key: 'certname',
              header: 'Certname',
              sortValue: (n) => n.certname,
              render: (n) => <Text fw={500}>{n.certname}</Text>,
            },
            {
              key: 'latest_report_status',
              header: 'Status',
              sortValue: (n) => n.latest_report_status || '',
              render: (n) => (
                <Tooltip
                  multiline
                  maw={420}
                  label={[
                    `Badge = newest report for this certname (receive_time).`,
                    `shown: ${n.latest_report_status || 'unreported'}`,
                    `source: ${n.status_source || 'node_index'}`,
                    n.node_index_status ? `node index: ${n.node_index_status}` : null,
                    n.report_producer ? `compiled by: ${n.report_producer}` : null,
                    n.cached_catalog_status ? `cached catalog: ${n.cached_catalog_status}` : null,
                    n.report_timestamp ? `time: ${n.report_timestamp}` : null,
                  ].filter(Boolean).join('\n')}
                >
                  <span><StatusBadge status={n.latest_report_status} /></span>
                </Tooltip>
              ),
            },
            {
              key: 'report_environment',
              header: 'Environment',
              sortValue: (n) => (n as any).enc_environment || n.report_environment || '',
              render: (n) => (n as any).enc_environment || n.report_environment || '\u2014',
            },
            {
              key: 'report_timestamp',
              header: 'Last Report',
              sortType: 'date',
              sortValue: (n) => n.report_timestamp || '',
              render: (n) => timeAgo(n.report_timestamp),
            },
            {
              key: 'actions',
              header: 'Actions',
              sortable: false,
              render: (n) => actionCell(n),
            },
          ] as OpsColumn<NodeSummary>[]}
        />
      </Card>

      {/* Unclassified nodes — signed certs (from CA) that are not (yet) classified in the ENC.
         This now includes nodes that have a signed certificate but have never reported
         to PuppetDB (the previously "lost" nodes). PuppetDB + CA signed certs together
         form the complete fleet. */}
      <Title order={4}>Unclassified Nodes ({filteredUnclassified.length})</Title>
      <Card withBorder shadow="sm" padding="lg" style={{ overflow: 'hidden' }}>
        <OpsTable<NodeSummary>
          data={filteredUnclassified}
          rowKey={(n) => n.certname}
          defaultPageSize={50}
          maxHeight={480}
          emptyTitle="All known nodes are classified"
          emptyDescription={search || statusFilter ? 'No unclassified nodes match the current search/filters.' : 'Trash icon removes a ghost that no longer exists.'}
          onRowClick={(n) => navigate(`/nodes/${n.certname}`)}
          columns={[
            {
              key: 'certname',
              header: 'Certname',
              sortValue: (n) => n.certname,
              render: (n) => <Text fw={500}>{n.certname}</Text>,
            },
            {
              key: 'latest_report_status',
              header: 'Status',
              sortValue: (n) => n.latest_report_status || '',
              render: (n) => <StatusBadge status={n.latest_report_status} />,
            },
            {
              key: 'report_environment',
              header: 'Environment',
              sortValue: (n) => (n as any).enc_environment || n.report_environment || '',
              render: (n) => (n as any).enc_environment || n.report_environment || '\u2014',
            },
            {
              key: 'report_timestamp',
              header: 'Last Report',
              sortType: 'date',
              sortValue: (n) => n.report_timestamp || '',
              render: (n) => timeAgo(n.report_timestamp),
            },
            {
              key: 'actions',
              header: 'Actions',
              sortable: false,
              render: (n) => actionCell(n, { ghost: true }),
            },
          ] as OpsColumn<NodeSummary>[]}
        />
      </Card>
    </Stack>
  );
}
