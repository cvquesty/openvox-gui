/**
 * OpenVox GUI - Nodes.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, TextInput, Stack, Group, Text, Alert,
  ActionIcon, Tooltip, Collapse, ScrollArea, Box,
} from '@mantine/core';
import { IconSearch, IconEye, IconChevronDown, IconChevronRight, IconPlayerPlay, IconLink } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useApi } from '../hooks/useApi';
import { nodes, enc, bolt } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState, ErrorState } from '../components/StateComponents';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpsTable, OpsColumn } from '../components/OpsTable';
import { FilterBar } from '../components/FilterBar';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useActivity } from '../hooks/ActivityContext';
import { useSkipAdhocConfirm } from '../hooks/useSkipAdhocConfirm';
import { useAppTheme } from '../hooks/ThemeContext';
import type { NodeSummary } from '../types';

/* ═══════════════════════════════════════════════════════════════
   NODE-O-VISION 6000 — the server rack X-ray machine
   ═══════════════════════════════════════════════════════════════ */
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

function timeAgo(timestamp: string | null): string {
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

  const matchesNodeFilters = (n: NodeSummary) => {
    if (search && !n.certname.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter) {
      const st = (n.latest_report_status || '').toLowerCase();
      if (st !== statusFilter.toLowerCase()) return false;
    }
    return true;
  };
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [runningCert, setRunningCert] = useState<string | null>(null);
  const { data: nodeList, loading: nodesLoading, error: nodesError } = useApi<NodeSummary[]>(nodes.list);
  const { data: hierarchy, loading: hierarchyLoading, error: hierarchyError } = useApi<any>(() => enc.getHierarchy());
  const navigate = useNavigate();
  const { begin, end } = useActivity();
  const skipConfirm = useSkipAdhocConfirm();

  const loading = nodesLoading || hierarchyLoading;
  const error = nodesError || hierarchyError;

  const runOpenVox = async (certname: string) => {
    setRunTarget(null);
    setRunningCert(certname);
    const actId = begin(`Run OpenVox: ${certname}`, { href: `/nodes/${certname}` });
    try {
      const r = await bolt.runCommand({
        command: '/opt/puppetlabs/bin/puppet agent -t',
        targets: certname,
        run_as: 'root',
      });
      const ok = r.returncode === 0 || r.returncode === 2;
      end(actId, ok ? 'done' : 'error', `exit ${r.returncode}`);
      notifications.show({
        title: ok ? 'OpenVox Run Complete' : 'OpenVox Run Failed',
        message: ok
          ? (r.returncode === 2 ? `Changes applied on ${certname}` : `No changes on ${certname}`)
          : `Exit code ${r.returncode} on ${certname}`,
        color: ok ? 'green' : 'red',
      });
    } catch (e: any) {
      end(actId, 'error', e.message);
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setRunningCert(null);
  };

  // Build grouped nodes by node groups
  // Use hierarchy.nodes (has groups) merged with nodeList (has full details)
  const groupedNodes: GroupedNodes = useMemo(() => {
    if (!nodeList) return {};

    const groups: GroupedNodes = {};

    // Build certname → node lookup from nodeList for full details
    const nodeByCertname: Record<string, NodeSummary> = {};
    nodeList.forEach((node: NodeSummary) => {
      nodeByCertname[node.certname] = node;
    });

    // Build group → nodes map from hierarchy
    const groupNodes: Record<string, NodeSummary[]> = {};
    hierarchy?.groups?.forEach((group: any) => {
      groupNodes[group.name] = [];
    });

    // Assign nodes to groups using hierarchy.nodes, but ONLY if
    // the node actually exists in PuppetDB. ENC entries for nodes
    // that have been removed from puppetserver are skipped.
    const hierarchyNodes = hierarchy?.nodes || [];
    if (hierarchyNodes.length > 0) {
      hierarchyNodes.forEach((hNode: any) => {
        const nodeGroups = hNode.groups || [];
        const fullNode: NodeSummary | undefined = nodeByCertname[hNode.certname];
        if (!fullNode) return; // Not in PuppetDB — skip ghost
        
        if (nodeGroups.length > 0) {
          nodeGroups.forEach((g: string) => {
            if (!groupNodes[g]) groupNodes[g] = [];
            // Avoid duplicates
            if (!groupNodes[g].find((n: NodeSummary) => n.certname === fullNode.certname)) {
              groupNodes[g].push(fullNode);
            }
          });
        } else {
          // Node without explicit group - put in "Ungrouped"
          if (!groupNodes['Ungrouped']) groupNodes['Ungrouped'] = [];
          if (!groupNodes['Ungrouped'].find((n: NodeSummary) => n.certname === fullNode.certname)) {
            groupNodes['Ungrouped'].push(fullNode);
          }
        }
      });
    } else {
      // Fallback: all nodes ungrouped
      nodeList.forEach((node: NodeSummary) => {
        if (!groupNodes['Ungrouped']) groupNodes['Ungrouped'] = [];
        if (!groupNodes['Ungrouped'].find((n: NodeSummary) => n.certname === node.certname)) {
          groupNodes['Ungrouped'].push(node);
        }
      });
    }

    // If no groups exist, create "All Nodes" group (dedup defensively)
    if (Object.keys(groupNodes).length === 0) {
      const seen = new Set<string>();
      groupNodes['All Nodes'] = nodeList.filter((n: NodeSummary) => {
        const k = n.certname.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    // Build grouped nodes
    Object.entries(groupNodes).forEach(([groupName, nodeArr]) => {
      groups[groupName] = { nodes: nodeArr };
    });

    return groups;
  }, [nodeList, hierarchy]);

  // Build unclassified nodes list: nodes in the full fleet (CA signed certs, now the
  // source of truth) that are not present in the ENC hierarchy.
  // The fleet = all signed certs (92) unioned with their PDB status where available.
  // Nodes that only exist as signed certs (never reported) appear here until classified
  // (note: classification currently requires a PDB entry).
  const unclassifiedNodes = useMemo(() => {
    if (!nodeList) return [];

    const classifiedCertnames = new Set<string>();
    (hierarchy?.nodes || []).forEach((hNode: any) => {
      classifiedCertnames.add(hNode.certname.toLowerCase());
    });

    return nodeList
      .filter((node) => !classifiedCertnames.has(node.certname.toLowerCase()))
      .sort((a, b) => a.certname.localeCompare(b.certname));
  }, [nodeList, hierarchy]);

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

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  if (loading) return <LoadingState label="Loading nodes…" />;
  if (error) return <ErrorState title="Failed to load nodes" message={error} />;

  const groupNames = Object.keys(filteredGroups);
  const classifiedCount = Object.values(filteredGroups).reduce((sum, g) => sum + g.nodes.length, 0);
  const totalNodes = classifiedCount + filteredUnclassified.length;

  const actionCell = (node: NodeSummary) => (
    <Group gap={4} onClick={(e) => e.stopPropagation()}>
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
      <Tooltip label="View details">
        <ActionIcon variant="subtle" onClick={() => navigate(`/nodes/${node.certname}`)}>
          <IconEye size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  return (
    <Stack>
      <Title order={2}>Nodes ({totalNodes})</Title>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search nodes by certname…"
        status={statusFilter}
        onStatusChange={setStatusFilter}
        hint="Status chips filter All Nodes / groups / unclassified. Shareable via URL (?q=&status=)."
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
                <Collapse in={isExpanded}>
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
                                  <Table.Td><StatusBadge status={node.latest_report_status} /></Table.Td>
                                  <Table.Td>{node.report_environment || '\u2014'}</Table.Td>
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

      {/* All nodes — OpsTable (sruiux2 P0-2: sort + paginate) */}
      <Title order={4}>All Nodes ({totalNodes})</Title>
      {totalNodes > 200 && (
        <Alert color="yellow" variant="light">
          Large fleet ({totalNodes} nodes loaded client-side). Use search and OpsTable page size; further server-side paging is planned in later 3.10.04 slices.
        </Alert>
      )}
      <Card withBorder shadow="sm" padding="lg" style={{ overflow: 'hidden' }}>
        <OpsTable<NodeSummary>
          data={filtered}
          rowKey={(n) => n.certname}
          defaultPageSize={100}
          maxHeight="calc(100vh - 320px)"
          emptyTitle="No nodes found"
          emptyDescription={search ? 'Try a different search.' : 'No nodes reported to PuppetDB yet.'}
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
              sortValue: (n) => n.report_environment || '',
              render: (n) => n.report_environment || '\u2014',
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
          emptyDescription={search || statusFilter ? 'No unclassified nodes match filters.' : undefined}
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
              sortValue: (n) => n.report_environment || '',
              render: (n) => n.report_environment || '\u2014',
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
    </Stack>
  );
}
