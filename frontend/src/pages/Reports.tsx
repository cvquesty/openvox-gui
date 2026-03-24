import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text, Grid, Box,
  Select, Badge, Collapse, ActionIcon,
} from '@mantine/core';
import { IconSearch, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports, enc, nodes as nodesApi } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';


/* ── REPORT-O-SCOPE 9000 — report analysis machine ──────── */
function ReportOScope() {
  return (
    <svg viewBox="0 0 500 300" style={{ maxHeight: 340, display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id="rpt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="rpt-machine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
        <linearGradient id="rpt-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1a2a" />
          <stop offset="100%" stopColor="#112233" />
        </linearGradient>
      </defs>

      <rect width="500" height="300" fill="url(#rpt-sky)" />

      {/* Stars */}
      <circle cx="12" cy="8" r="1" fill="#fff" opacity="0.5" />
      <circle cx="40" cy="20" r="1.2" fill="#fff" opacity="0.6" />
      <circle cx="70" cy="5" r="1" fill="#fff" opacity="0.4" />
      <circle cx="95" cy="35" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="120" cy="12" r="1" fill="#fff" opacity="0.7" />
      <circle cx="155" cy="42" r="1" fill="#fff" opacity="0.3" />
      <circle cx="175" cy="8" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="200" cy="28" r="1" fill="#fff" opacity="0.7" />
      <circle cx="230" cy="5" r="1" fill="#fff" opacity="0.4" />
      <circle cx="260" cy="38" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="285" cy="14" r="1" fill="#fff" opacity="0.5" />
      <circle cx="310" cy="32" r="1" fill="#fff" opacity="0.3" />
      <circle cx="335" cy="8" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="350" cy="45" r="1" fill="#fff" opacity="0.4" />
      <circle cx="380" cy="18" r="1" fill="#fff" opacity="0.7" />
      <circle cx="405" cy="40" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="420" cy="8" r="1" fill="#fff" opacity="0.6" />
      <circle cx="445" cy="30" r="1" fill="#fff" opacity="0.4" />
      <circle cx="460" cy="12" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="485" cy="25" r="1" fill="#fff" opacity="0.7" />
      <circle cx="15" cy="55" r="1" fill="#fff" opacity="0.3" />
      <circle cx="55" cy="60" r="1" fill="#fff" opacity="0.5" />
      <circle cx="130" cy="52" r="1.5" fill="#fff" opacity="0.4" />
      <circle cx="300" cy="50" r="1" fill="#fff" opacity="0.6" />
      <circle cx="470" cy="48" r="1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="5" r="1" fill="#fff" opacity="0.5" />
      <circle cx="5" cy="30" r="1" fill="#fff" opacity="0.6" />
      <circle cx="245" cy="18" r="1" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="245" width="500" height="55" fill="#1a1a2e" />
      <rect x="0" y="245" width="500" height="2" fill="#333355" />

      {/* ── THE MACHINE ── */}
      <rect x="140" y="90" width="220" height="150" fill="url(#rpt-machine)" rx="8" stroke="#7788aa" strokeWidth="1.5" />

      {/* Machine label */}
      <rect x="170" y="100" width="160" height="20" fill="#334455" rx="3" />
      <text x="250" y="114" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">
        REPORT-O-SCOPE 9000
      </text>

      {/* Screen */}
      <rect x="160" y="128" width="180" height="80" fill="url(#rpt-screen)" rx="4" stroke="#44aaff" strokeWidth="1" opacity="0.8" />

      {/* Scrolling report lines on screen */}
      <g>
        <rect x="168" y="135" width="80" height="6" fill="#335566" rx="1" opacity="0.6">
          <animate attributeName="x" values="168;168;168" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="260" y="135" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="140" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="146" width="65" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="146" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="151" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="157" width="90" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="157" width="16" height="6" fill="#ff4444" rx="1" opacity="0.9">
          <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <text x="268" y="162" textAnchor="middle" fill="#fff" fontSize="5">✗</text>
      </g>
      <g>
        <rect x="168" y="168" width="72" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="168" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="173" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>
      <g>
        <rect x="168" y="179" width="85" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="179" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="184" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="190" width="60" height="6" fill="#335566" rx="1" opacity="0.4" />
        <rect x="260" y="190" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="195" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>

      {/* Scan line */}
      <rect x="160" y="135" width="180" height="2" fill="#44aaff" opacity="0.3">
        <animate attributeName="y" values="128;206;128" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Screen reflection */}
      <rect x="160" y="128" width="180" height="20" fill="#ffffff" opacity="0.03" rx="4" />

      {/* Status lights */}
      <circle cx="170" cy="220" r="4" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="183" cy="220" r="4" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="196" cy="220" r="4" fill="#ff4444">
        <animate attributeName="fill" values="#ff4444;#cc2222;#ff4444" dur="2.5s" repeatCount="indefinite" />
      </circle>

      {/* Data readout panel */}
      <rect x="220" y="212" width="120" height="22" fill="#223344" rx="3" stroke="#445566" strokeWidth="0.5" />
      <text x="228" y="226" fill="#44ff44" fontSize="8" fontFamily="monospace">
        <animate attributeName="textContent" values="ANALYZING...;PROCESSING...;SCANNING..." dur="4s" repeatCount="indefinite" />
        ANALYZING...
      </text>

      {/* ── Magnifying glass / telescope arm ── */}
      {/* Arm extending left */}
      <rect x="60" y="148" width="84" height="10" fill="#667788" rx="3" />
      <circle cx="142" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Magnifying glass */}
      <circle cx="42" cy="140" r="28" fill="none" stroke="#88aacc" strokeWidth="4" />
      <circle cx="42" cy="140" r="24" fill="#112233" opacity="0.6" />
      {/* Lens glare */}
      <ellipse cx="34" cy="130" rx="8" ry="5" fill="#ffffff" opacity="0.1" transform="rotate(-20,34,130)" />

      {/* Report page being examined */}
      <rect x="28" y="126" width="28" height="28" fill="#ddeeff" rx="2" opacity="0.15" />
      <rect x="31" y="130" width="18" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="134" width="14" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="138" width="20" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="142" width="12" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="146" width="16" height="2" fill="#88aacc" opacity="0.3" />

      {/* Lens pulse */}
      <circle cx="42" cy="140" r="24" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.4">
        <animate attributeName="r" values="22;26;22" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* ── Printer arm extending right ── */}
      <rect x="358" y="148" width="60" height="10" fill="#667788" rx="3" />
      <circle cx="360" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Printed reports coming out */}
      <g>
        <rect x="415" y="120" width="30" height="38" fill="#ddeeff" rx="2" opacity="0.9">
          <animate attributeName="y" values="140;120;120" dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.9;0.9" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="128" width="18" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="148;128;128" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="133" width="14" height="2" fill="#667788" opacity="0.4">
          <animate attributeName="y" values="153;133;133" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="138" width="20" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="158;138;138" dur="4s" repeatCount="indefinite" />
        </rect>
        {/* Checkmark stamp */}
        <text x="430" y="150" textAnchor="middle" fill="#44cc44" fontSize="12" opacity="0.8">
          <animate attributeName="y" values="170;150;150" dur="4s" repeatCount="indefinite" />
          ✓
        </text>
      </g>

      {/* Stacked finished reports */}
      <rect x="440" y="210" width="30" height="35" fill="#ccddee" rx="2" opacity="0.3" />
      <rect x="443" y="213" width="24" height="29" fill="#ddeeff" rx="1" opacity="0.4" />
      <rect x="446" y="216" width="18" height="23" fill="#eef4ff" rx="1" opacity="0.5" />

      {/* ── Little robot operator ── */}
      {/* Body */}
      <rect x="380" y="210" width="20" height="28" fill="#667788" rx="3" />
      {/* Head */}
      <rect x="383" y="198" width="14" height="14" fill="#778899" rx="2" />
      {/* Eyes */}
      <rect x="386" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="391" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Antenna */}
      <line x1="390" y1="198" x2="390" y2="190" stroke="#8899bb" strokeWidth="1.5" />
      <circle cx="390" cy="188" r="2.5" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Arms */}
      <line x1="380" y1="218" x2="370" y2="225" stroke="#667788" strokeWidth="2" />
      <line x1="400" y1="218" x2="415" y2="215" stroke="#667788" strokeWidth="2" />
      {/* Legs */}
      <line x1="385" y1="238" x2="382" y2="247" stroke="#667788" strokeWidth="2" />
      <line x1="395" y1="238" x2="398" y2="247" stroke="#667788" strokeWidth="2" />

      {/* Clipboard in hand */}
      <rect x="365" y="222" width="10" height="14" fill="#bbccdd" rx="1" />
      <rect x="367" y="225" width="6" height="1.5" fill="#667788" opacity="0.6" />
      <rect x="367" y="228" width="4" height="1.5" fill="#667788" opacity="0.5" />
      <rect x="367" y="231" width="5" height="1.5" fill="#667788" opacity="0.6" />

      {/* ── Gears ── */}
      <circle cx="155" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="0 155 100;360 155 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="155" cy="100" r="3.5" fill="#445566" />
      <circle cx="345" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="360 345 100;0 345 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="345" cy="100" r="3.5" fill="#445566" />

      {/* Caption */}
      <text x="250" y="267" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">
        The Report-O-Scope 9000
      </text>
      <text x="250" y="283" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">
        cataloging openvox runs so you don&#39;t have to
      </text>
    </svg>
  );
}

// ─── Grouped Reports View ──────────────────────────────────
interface GroupedReports {
  [groupName: string]: {
    nodes: string[];
    reports: any[];
    status: 'unchanged' | 'changed' | 'failed';
  };
}

function getGroupStatus(reports: any[]): 'unchanged' | 'changed' | 'failed' {
  if (reports.length === 0) return 'unchanged';
  // Only consider the last 10 reports (most recent) for badge status
  const recentReports = reports.slice(0, 10);
  const hasFailed = recentReports.some(r => r.status === 'failed');
  if (hasFailed) return 'failed';
  const hasChanged = recentReports.some(r => r.status === 'changed');
  if (hasChanged) return 'changed';
  return 'unchanged';
}

function getStatusBadgeProps(status: 'unchanged' | 'changed' | 'failed') {
  switch (status) {
    case 'failed':
      return { color: 'red', label: 'Failed' };
    case 'changed':
      return { color: 'orange', label: 'Changed' };
    default:
      return { color: 'green', label: 'Unchanged' };
  }
}

export function ReportsPage() {
  const { isFormal } = useAppTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Fetch hierarchy (groups and nodes)
  const { data: hierarchy, loading: hierarchyLoading } = useApi(
    () => enc.getHierarchy(),
    []
  );

  // Fetch reports
  const { data: reportList, loading: reportsLoading, error } = useApi(
    () => reports.list({ status: statusFilter || undefined, limit: 100 }),
    [statusFilter]
  );

  const loading = hierarchyLoading || reportsLoading;

  // Build group → nodes mapping and group reports
  const groupedReports: GroupedReports = useMemo(() => {
    if (!hierarchy || !reportList) return {};

    const groups: GroupedReports = {};

    // Build group → nodes map from hierarchy
    const groupNodes: Record<string, string[]> = {};
    hierarchy.groups?.forEach((group: any) => {
      groupNodes[group.name] = [];
    });

    // Assign nodes to groups
    hierarchy.nodes?.forEach((node: any) => {
      // Nodes may have groups array (group names) or group_ids
      const nodeGroups = node.groups || [];
      if (nodeGroups.length > 0) {
        nodeGroups.forEach((g: string) => {
          if (!groupNodes[g]) groupNodes[g] = [];
          groupNodes[g].push(node.certname);
        });
      } else {
        // Node without explicit group - put in "Ungrouped"
        if (!groupNodes['Ungrouped']) groupNodes['Ungrouped'] = [];
        groupNodes['Ungrouped'].push(node.certname);
      }
    });

    // If no groups exist, create "All Nodes" group
    if (Object.keys(groupNodes).length === 0) {
      groupNodes['All Nodes'] = hierarchy.nodes?.map((n: any) => n.certname) || [];
    }

    // Group reports by node groups
    Object.entries(groupNodes).forEach(([groupName, nodeList]) => {
      const groupReports = reportList.filter((r: any) =>
        nodeList.includes(r.certname)
      );
      groups[groupName] = {
        nodes: nodeList,
        reports: groupReports,
        status: getGroupStatus(groupReports),
      };
    });

    return groups;
  }, [hierarchy, reportList]);

  // Filter groups and reports by search
  const filteredGroups = useMemo(() => {
    if (!search) return groupedReports;
    const searchLower = search.toLowerCase();
    const filtered: GroupedReports = {};
    Object.entries(groupedReports).forEach(([groupName, data]) => {
      const matchingReports = data.reports.filter((r: any) =>
        r.certname.toLowerCase().includes(searchLower)
      );
      if (groupName.toLowerCase().includes(searchLower) || matchingReports.length > 0) {
        filtered[groupName] = {
          ...data,
          reports: matchingReports,
        };
      }
    });
    return filtered;
  }, [groupedReports, search]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const groupNames = Object.keys(filteredGroups);
  const totalReports = Object.values(filteredGroups).reduce((sum, g) => sum + g.reports.length, 0);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Reports ({totalReports})</Title>
        <Group>
          <Select
            placeholder="Filter by status"
            data={[
              { value: '', label: 'All' },
              { value: 'changed', label: 'Changed' },
              { value: 'unchanged', label: 'Unchanged' },
              { value: 'failed', label: 'Failed' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            clearable
            style={{ width: 160 }}
          />
          <TextInput
            placeholder="Search by certname..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 250 }}
          />
        </Group>
      </Group>

      {/* Report-O-Scope illustration (casual only) */}
      {!isFormal && (
        <Card withBorder shadow="sm" padding={0} style={{ overflow: 'hidden', background: 'linear-gradient(to bottom, #1a1b2e, #252540)' }}>
          <ReportOScope />
        </Card>
      )}

      {/* Grouped reports */}
      {groupNames.length === 0 ? (
        <Card withBorder shadow="sm">
          <Text c="dimmed" ta="center">No reports found</Text>
        </Card>
      ) : (
        <Stack gap="md">
          {groupNames.map((groupName) => {
            const groupData = filteredGroups[groupName];
            const { status, reports: groupReports, nodes } = groupData;
            const badgeProps = getStatusBadgeProps(status);
            const isExpanded = expandedGroups[groupName] ?? false;

            return (
              <Card key={groupName} withBorder shadow="sm">
                <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => toggleGroup(groupName)}>
                  <Group>
                    <ActionIcon variant="subtle" size="sm">
                      {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </ActionIcon>
                    <Text fw={700}>{groupName}</Text>
                    <Text c="dimmed" size="sm">({nodes.length} node{nodes.length !== 1 ? 's' : ''})</Text>
                  </Group>
                  <Badge color={badgeProps.color} variant="filled" size="sm">
                    {badgeProps.label}
                  </Badge>
                </Group>
                <Collapse in={isExpanded}>
                  <Table striped highlightOnHover mt="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Certname</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Environment</Table.Th>
                        <Table.Th>Start Time</Table.Th>
                        <Table.Th>OpenVox Version</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {groupReports.length === 0 ? (
                        <Table.Tr>
                          <Table.Td colSpan={6}><Text c="dimmed" ta="center">No reports for this group</Text></Table.Td>
                        </Table.Tr>
                      ) : (
                        groupReports.map((report: any) => (
                          <Table.Tr
                            key={report.hash}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/reports/${report.hash}`)}
                          >
                            <Table.Td><Text fw={500}>{report.certname}</Text></Table.Td>
                            <Table.Td><StatusBadge status={report.status} /></Table.Td>
                            <Table.Td>
                              {report.corrective_change ? (
                                <Badge color="orange" variant="light" size="sm">Corrective</Badge>
                              ) : report.noop ? (
                                <Badge color="blue" variant="light" size="sm">Noop</Badge>
                              ) : (
                                <Badge color="gray" variant="light" size="sm">Intentional</Badge>
                              )}
                            </Table.Td>
                            <Table.Td>{report.environment || '—'}</Table.Td>
                            <Table.Td>{report.start_time ? new Date(report.start_time).toLocaleString() : '—'}</Table.Td>
                            <Table.Td>{report.puppet_version || '—'}</Table.Td>
                          </Table.Tr>
                        ))
                      )}
                    </Table.Tbody>
                  </Table>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
